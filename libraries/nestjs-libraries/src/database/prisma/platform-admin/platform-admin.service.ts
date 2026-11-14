import { HttpException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import {
  PlatformAdminRepository,
  PageParams,
} from '@gitroom/nestjs-libraries/database/prisma/platform-admin/platform-admin.repository';
import {
  aggregateProviderHealth,
  deriveEmailConfigStatus,
  deriveProviderCredentialStatus,
  deriveStorageConfigStatus,
  guardUserAction,
  PROVIDER_ENV_KEYS,
} from '@gitroom/nestjs-libraries/database/prisma/platform-admin/platform-admin.rules';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import {
  IntegrationHealth,
  IntegrationHealthService,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.health.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { STRIPE_PROVIDER } from '@gitroom/nestjs-libraries/services/payment/payment.providers';
import { ResendProvider } from '@gitroom/nestjs-libraries/emails/resend.provider';
import { NodeMailerProvider } from '@gitroom/nestjs-libraries/emails/node.mailer.provider';
import { SesProvider } from '@gitroom/nestjs-libraries/emails/ses.provider';
import { EmptyProvider } from '@gitroom/nestjs-libraries/emails/empty.provider';

export const ADMIN_TIERS = [
  'FREE',
  'STANDARD',
  'PRO',
  'TEAM',
  'ULTIMATE',
] as const;
export type AdminTier = (typeof ADMIN_TIERS)[number];

/**
 * Postorizon Phase 6 — business logic for the platform admin console.
 * Every mutating method writes exactly one AdminAuditLog row through
 * `record()` after the mutation succeeds. Guard rules live in
 * platform-admin.rules.ts (pure, unit-executed).
 */
@Injectable()
export class PlatformAdminService {
  constructor(
    private _repository: PlatformAdminRepository,
    private _usersService: UsersService,
    private _integrationHealthService: IntegrationHealthService,
    private _subscriptionService: SubscriptionService
  ) {}

  private record(
    admin: Pick<User, 'id'>,
    action: string,
    targetType: 'user' | 'organization',
    targetId: string,
    metadata?: Record<string, unknown>
  ) {
    return this._repository.createAuditEntry({
      adminUserId: admin.id,
      action,
      targetType,
      targetId,
      metadata,
    });
  }

  // ------------------------------------------------------------ overview

  getOverview() {
    return this._repository.overviewCounts();
  }

  listAuditEntries(params: PageParams) {
    return this._repository.listAuditEntries(params);
  }

  // --------------------------------------------------------------- users

  listUsers(params: PageParams) {
    return this._repository.listUsers(params);
  }

  async getUserDetail(id: string) {
    const user = await this._repository.getUserDetail(id);
    if (!user) {
      throw new HttpException('User not found', 404);
    }
    return user;
  }

  private async loadTargetOr404(id: string) {
    const target = await this._repository.getUserTarget(id);
    if (!target) {
      throw new HttpException('User not found', 404);
    }
    return target;
  }

  async suspendUser(admin: User, targetId: string) {
    const target = await this.loadTargetOr404(targetId);
    if (target.suspendedAt) {
      return { id: target.id, suspendedAt: target.suspendedAt, changed: false };
    }
    const activeAdmins = await this._repository.countActivePlatformAdmins();
    const refusal = guardUserAction({
      actorId: admin.id,
      action: 'suspend',
      target: {
        id: target.id,
        isPlatformAdmin: target.isPlatformAdmin,
        suspendedAt: target.suspendedAt,
      },
      activePlatformAdminCount: activeAdmins,
    });
    if (refusal) {
      throw new HttpException(refusal, 400);
    }
    const updated = await this._repository.setUserSuspended(targetId, true);
    // Belt and braces on top of the AuthMiddleware suspension gate:
    // bumping the epoch guarantees pre-suspension session tokens can
    // never revive if the account is later reactivated.
    await this._usersService.incrementSessionEpoch(targetId);
    await this.record(admin, 'user.suspend', 'user', targetId);
    return { ...updated, changed: true };
  }

  async reactivateUser(admin: User, targetId: string) {
    const target = await this.loadTargetOr404(targetId);
    if (!target.suspendedAt) {
      return { id: target.id, suspendedAt: null, changed: false };
    }
    const updated = await this._repository.setUserSuspended(targetId, false);
    await this.record(admin, 'user.reactivate', 'user', targetId);
    return { ...updated, changed: true };
  }

  async forceSignOutUser(admin: User, targetId: string) {
    const target = await this.loadTargetOr404(targetId);
    // The Phase 5 seam — identical effect to POST /user/logout-all,
    // applied to the target user.
    await this._usersService.incrementSessionEpoch(targetId);
    await this.record(admin, 'user.force_sign_out', 'user', targetId);
    return { id: target.id, sessionEpoch: target.sessionEpoch + 1 };
  }

  async grantAdmin(admin: User, targetId: string) {
    const target = await this.loadTargetOr404(targetId);
    if (target.isPlatformAdmin) {
      return { id: target.id, isPlatformAdmin: true, changed: false };
    }
    const updated = await this._repository.setUserPlatformAdmin(targetId, true);
    await this.record(admin, 'user.grant_admin', 'user', targetId);
    return { ...updated, changed: true };
  }

  async revokeAdmin(admin: User, targetId: string) {
    const target = await this.loadTargetOr404(targetId);
    if (!target.isPlatformAdmin) {
      return { id: target.id, isPlatformAdmin: false, changed: false };
    }
    const activeAdmins = await this._repository.countActivePlatformAdmins();
    const refusal = guardUserAction({
      actorId: admin.id,
      action: 'revokeAdmin',
      target: {
        id: target.id,
        isPlatformAdmin: target.isPlatformAdmin,
        suspendedAt: target.suspendedAt,
      },
      activePlatformAdminCount: activeAdmins,
    });
    if (refusal) {
      throw new HttpException(refusal, 400);
    }
    const updated = await this._repository.setUserPlatformAdmin(targetId, false);
    await this.record(admin, 'user.revoke_admin', 'user', targetId);
    return { ...updated, changed: true };
  }

  async recordResendActivation(admin: User, targetId: string) {
    await this.record(admin, 'user.resend_activation', 'user', targetId);
    return { id: targetId };
  }

  // ------------------------------------------- CLI bootstrap (no actor)

  /**
   * Used by the `admin:grant` / `admin:revoke` CLI commands. There is
   * no acting admin in a shell, so no audit row is written — the
   * command output is the record (documented in DEPLOYMENT.md §10.4).
   * The last-admin safeguard still applies to revoke.
   */
  async grantAdminByEmail(email: string) {
    const user = await this._usersService.getUserByEmail(email);
    if (!user) {
      throw new Error(`No local account found for ${email}`);
    }
    if (user.isPlatformAdmin) {
      return { id: user.id, email: user.email, changed: false };
    }
    await this._repository.setUserPlatformAdmin(user.id, true);
    return { id: user.id, email: user.email, changed: true };
  }

  async revokeAdminByEmail(email: string) {
    const user = await this._usersService.getUserByEmail(email);
    if (!user) {
      throw new Error(`No local account found for ${email}`);
    }
    if (!user.isPlatformAdmin) {
      return { id: user.id, email: user.email, changed: false };
    }
    const activeAdmins = await this._repository.countActivePlatformAdmins();
    const refusal = guardUserAction({
      actorId: user.id,
      action: 'revokeAdmin',
      target: {
        id: user.id,
        isPlatformAdmin: true,
        suspendedAt: user.suspendedAt,
      },
      activePlatformAdminCount: activeAdmins,
    });
    if (refusal) {
      throw new Error(refusal);
    }
    await this._repository.setUserPlatformAdmin(user.id, false);
    return { id: user.id, email: user.email, changed: true };
  }

  // -------------------------------------------------------- organizations

  async listOrganizations(params: PageParams) {
    const result = await this._repository.listOrganizations(params);
    return {
      ...result,
      items: result.items.map((org) => ({
        ...org,
        subscription:
          org.subscription && !org.subscription.deletedAt
            ? org.subscription
            : null,
      })),
    };
  }

  async getOrganizationDetail(id: string) {
    const org = await this._repository.getOrganizationDetail(id);
    if (!org) {
      throw new HttpException('Organization not found', 404);
    }
    const health = await this._integrationHealthService.getOrgHealth(id);
    const healthById = new Map(health.map((row) => [row.id, row]));
    return {
      ...org,
      subscription:
        org.subscription && !org.subscription.deletedAt
          ? org.subscription
          : null,
      integrations: org.Integration.map((integration) => ({
        ...integration,
        health: healthById.get(integration.id) ?? null,
      })),
      Integration: undefined,
    };
  }

  async suspendOrganization(admin: User, targetId: string) {
    const target = await this._repository.getOrganizationTarget(targetId);
    if (!target) {
      throw new HttpException('Organization not found', 404);
    }
    if (target.suspendedAt) {
      return { id: target.id, suspendedAt: target.suspendedAt, changed: false };
    }
    const updated = await this._repository.setOrganizationSuspended(
      targetId,
      true
    );
    await this.record(admin, 'organization.suspend', 'organization', targetId);
    return { ...updated, changed: true };
  }

  async reactivateOrganization(admin: User, targetId: string) {
    const target = await this._repository.getOrganizationTarget(targetId);
    if (!target) {
      throw new HttpException('Organization not found', 404);
    }
    if (!target.suspendedAt) {
      return { id: target.id, suspendedAt: null, changed: false };
    }
    const updated = await this._repository.setOrganizationSuspended(
      targetId,
      false
    );
    await this.record(
      admin,
      'organization.reactivate',
      'organization',
      targetId
    );
    return { ...updated, changed: true };
  }

  /**
   * Tier override — tier ONLY, never amounts (pricing.ts is untouched).
   * Paid tiers go through the existing createOrUpdateSubscriptionByOrg
   * write path (side effects + row upsert), keeping the row's current
   * billing provider so a later Stripe/RevenueCat sync still manages
   * it. FREE is a virtual tier: the row is soft-deleted after running
   * the standard downgrade side effects. Lifetime grants are refused —
   * an override must not silently destroy a lifetime deal.
   */
  async overrideTier(admin: User, organizationId: string, tier: string) {
    if (!ADMIN_TIERS.includes(tier as AdminTier)) {
      throw new HttpException(
        `Invalid tier. Expected one of ${ADMIN_TIERS.join(', ')}`,
        400
      );
    }
    const org = await this._repository.getOrganizationTarget(organizationId);
    if (!org) {
      throw new HttpException('Organization not found', 404);
    }
    const current =
      await this._repository.getActiveSubscription(organizationId);
    if (current?.isLifetime) {
      throw new HttpException(
        'This organization has a lifetime subscription; tier override is refused.',
        400
      );
    }
    const from = current?.subscriptionTier ?? 'FREE';
    if (tier === 'FREE') {
      if (current) {
        await this._subscriptionService.modifySubscriptionByOrg(
          organizationId,
          pricing.FREE.channel || 0,
          'FREE'
        );
        await this._repository.softDeleteSubscription(organizationId);
      }
    } else {
      const result = await this._subscriptionService.createOrUpdateSubscriptionByOrg(
        false,
        organizationId,
        current?.provider ?? STRIPE_PROVIDER,
        current?.identifier ?? 'admin-override',
        pricing[tier].channel!,
        tier as 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
        'MONTHLY',
        null
      );
      if (!result || !Object.keys(result).length) {
        throw new HttpException(
          'Tier override was refused by the subscription service.',
          400
        );
      }
    }
    await this.record(admin, 'organization.tier_override', 'organization', organizationId, {
      from,
      to: tier,
    });
    const updated =
      await this._repository.getActiveSubscription(organizationId);
    return {
      organizationId,
      tier: updated?.subscriptionTier ?? 'FREE',
      subscription: updated,
    };
  }

  // --------------------------------------------------------- integrations

  async getIntegrationsRollup() {
    const [orgIds, connected, tokenEncryption] = await Promise.all([
      this._repository.listOrganizationIds(),
      this._repository.providerConnectedCounts(),
      this._repository.tokenEncryptionCounts(),
    ]);
    const healthRows: IntegrationHealth[] = [];
    for (const org of orgIds) {
      healthRows.push(
        ...(await this._integrationHealthService.getOrgHealth(org.id))
      );
    }
    const healthByProvider = new Map(
      aggregateProviderHealth(healthRows).map((row) => [
        row.providerIdentifier,
        row,
      ])
    );
    const providerIds = new Set<string>([
      ...connected.map((row) => row.providerIdentifier),
      ...healthByProvider.keys(),
      ...Object.keys(PROVIDER_ENV_KEYS),
    ]);
    const providers = [...providerIds]
      .sort()
      .map((providerIdentifier) => {
        const health = healthByProvider.get(providerIdentifier);
        const connectedRow = connected.find(
          (row) => row.providerIdentifier === providerIdentifier
        );
        return {
          providerIdentifier,
          connected: connectedRow?.connected ?? health?.connected ?? 0,
          errors30d: health?.errors30d ?? 0,
          tokenStates: health?.tokenStates ?? {
            ok: 0,
            expiring_soon: 0,
            expired: 0,
            unknown: 0,
          },
          credentials: deriveProviderCredentialStatus(
            providerIdentifier,
            process.env
          ),
        };
      });
    return { providers, tokenEncryption };
  }

  // --------------------------------------------------------------- system

  async getSystemStatus() {
    const emailProvider = this.selectEmailProvider();
    const email = deriveEmailConfigStatus({
      providerName: emailProvider.name,
      validateEnvKeys: emailProvider.validateEnvKeys,
      env: process.env,
    });
    const storage = deriveStorageConfigStatus(process.env);
    const [engagement, tokenEncryption] = await Promise.all([
      this._repository.engagementActivity(),
      this._repository.tokenEncryptionCounts(),
    ]);
    return {
      email,
      storage,
      engagement,
      tokenBackfill: {
        remainingPlaintext: tokenEncryption.plaintext,
        encrypted: tokenEncryption.encrypted,
        preEncrypted: tokenEncryption.preEncrypted,
        total: tokenEncryption.total,
      },
    };
  }

  /** Mirrors EmailService.selectProvider (services/email.service.ts). */
  private selectEmailProvider() {
    switch (process.env.EMAIL_PROVIDER) {
      case 'resend':
        return new ResendProvider();
      case 'nodemailer':
        return new NodeMailerProvider();
      case 'ses':
        return new SesProvider();
      default:
        return new EmptyProvider();
    }
  }
}
