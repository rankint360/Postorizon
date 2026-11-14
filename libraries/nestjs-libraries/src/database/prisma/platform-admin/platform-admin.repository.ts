import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { INTEGRATION_TOKEN_ENCRYPTION_PREFIX } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.token.crypto';

// Providers whose stored token is already ciphertext by construction
// (Phase 5: PRE_ENCRYPTED_TOKEN_PROVIDERS in integration.token.crypto.ts
// — Skool's value is fixedEncryption output, never a usable credential,
// and carries no enc:v1: marker). Excluded from the "plaintext" count
// and reported separately so the migration numbers stay honest.
export const TOKEN_PRE_ENCRYPTED_PROVIDERS = ['skool'];

export interface PageParams {
  page?: number;
  limit?: number;
  search?: string;
}

const clampPage = (page?: number) => Math.max(0, page || 0);
const clampLimit = (limit?: number) =>
  Math.min(Math.max(1, limit || 20), 100);

const userListSelect = {
  id: true,
  email: true,
  name: true,
  lastName: true,
  providerName: true,
  activated: true,
  isPlatformAdmin: true,
  suspendedAt: true,
  sessionEpoch: true,
  lastOnline: true,
  createdAt: true,
  _count: { select: { organizations: true } },
} as const;

const subscriptionSelect = {
  subscriptionTier: true,
  provider: true,
  period: true,
  totalChannels: true,
  isLifetime: true,
  cancelAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PlatformAdminRepository {
  constructor(
    private _user: PrismaRepository<'user'>,
    private _organization: PrismaRepository<'organization'>,
    private _subscription: PrismaRepository<'subscription'>,
    private _integration: PrismaRepository<'integration'>,
    private _post: PrismaRepository<'post'>,
    private _snapshot: PrismaRepository<'postEngagementSnapshot'>,
    private _auditLog: PrismaRepository<'adminAuditLog'>
  ) {}

  // ------------------------------------------------------------- users

  async listUsers(params: PageParams) {
    const page = clampPage(params.page);
    const limit = clampLimit(params.limit);
    const skip = page * limit;
    const search = params.search?.trim();
    const where: any = { deletedAt: null };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this._user.model.user.findMany({
        where,
        select: userListSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this._user.model.user.count({ where }),
    ]);
    return { items, total, page, limit, hasMore: skip + items.length < total };
  }

  /** Target view for action guards — minimal, credential-free. */
  getUserTarget(id: string) {
    return this._user.model.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        activated: true,
        isPlatformAdmin: true,
        suspendedAt: true,
        sessionEpoch: true,
      },
    });
  }

  async getUserDetail(id: string) {
    return this._user.model.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...userListSelect,
        providerId: true,
        timezoneName: true,
        organizations: {
          select: {
            role: true,
            disabled: true,
            organization: {
              select: {
                id: true,
                name: true,
                createdAt: true,
                suspendedAt: true,
              },
            },
          },
        },
      },
    });
  }

  countActivePlatformAdmins() {
    return this._user.model.user.count({
      where: { isPlatformAdmin: true, deletedAt: null, suspendedAt: null },
    });
  }

  setUserSuspended(id: string, suspended: boolean) {
    return this._user.model.user.update({
      where: { id },
      data: { suspendedAt: suspended ? new Date() : null },
      select: { id: true, suspendedAt: true },
    });
  }

  setUserPlatformAdmin(id: string, value: boolean) {
    return this._user.model.user.update({
      where: { id },
      data: { isPlatformAdmin: value },
      select: { id: true, isPlatformAdmin: true },
    });
  }

  // ------------------------------------------------------ organizations

  async listOrganizations(params: PageParams) {
    const page = clampPage(params.page);
    const limit = clampLimit(params.limit);
    const skip = page * limit;
    const search = params.search?.trim();
    const where: any = { deletedAt: null };
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    const [items, total] = await Promise.all([
      this._organization.model.organization.findMany({
        where,
        select: {
          id: true,
          name: true,
          createdAt: true,
          suspendedAt: true,
          _count: { select: { users: true, Integration: true } },
          subscription: { select: subscriptionSelect },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this._organization.model.organization.count({ where }),
    ]);
    return { items, total, page, limit, hasMore: skip + items.length < total };
  }

  getOrganizationTarget(id: string) {
    return this._organization.model.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, suspendedAt: true },
    });
  }

  async getOrganizationDetail(id: string) {
    return this._organization.model.organization.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        suspendedAt: true,
        allowTrial: true,
        isTrailing: true,
        subscription: { select: subscriptionSelect },
        users: {
          select: {
            role: true,
            disabled: true,
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                lastName: true,
                isPlatformAdmin: true,
                suspendedAt: true,
              },
            },
          },
        },
        Integration: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            customName: true,
            providerIdentifier: true,
            type: true,
            disabled: true,
            tokenExpiration: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  setOrganizationSuspended(id: string, suspended: boolean) {
    return this._organization.model.organization.update({
      where: { id },
      data: { suspendedAt: suspended ? new Date() : null },
      select: { id: true, suspendedAt: true },
    });
  }

  getActiveSubscription(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: { organizationId, deletedAt: null },
    });
  }

  softDeleteSubscription(organizationId: string) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  listOrganizationIds() {
    return this._organization.model.organization.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
  }

  // --------------------------------------------------------- audit log

  createAuditEntry(data: {
    adminUserId: string;
    action: string;
    targetType: string;
    targetId?: string;
    // Prisma.InputJsonValue, not Record<string, unknown>: the latter is
    // not assignable to the generated Json field type (its index values
    // are `unknown`, which InputJsonObject does not accept).
    metadata?: Prisma.InputJsonValue;
  }) {
    return this._auditLog.model.adminAuditLog.create({
      data: {
        adminUserId: data.adminUserId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId ?? null,
        metadata: data.metadata ?? undefined,
      },
    });
  }

  async listAuditEntries(params: PageParams) {
    const page = clampPage(params.page);
    const limit = clampLimit(params.limit);
    const skip = page * limit;
    const [items, total] = await Promise.all([
      this._auditLog.model.adminAuditLog.findMany({
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          createdAt: true,
          adminUser: {
            select: { id: true, email: true, name: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this._auditLog.model.adminAuditLog.count(),
    ]);
    return { items, total, page, limit, hasMore: skip + items.length < total };
  }

  // ------------------------------------------------------------ stats

  async overviewCounts() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [users, organizations, integrations, postsLast30Days, snapshots] =
      await Promise.all([
        this._user.model.user.count({ where: { deletedAt: null } }),
        this._organization.model.organization.count({
          where: { deletedAt: null },
        }),
        this._integration.model.integration.count({
          where: { deletedAt: null },
        }),
        this._post.model.post.count({
          where: { deletedAt: null, createdAt: { gte: since } },
        }),
        this._snapshot.model.postEngagementSnapshot.count(),
      ]);
    return { users, organizations, integrations, postsLast30Days, snapshots };
  }

  async providerConnectedCounts() {
    const rows = await this._integration.model.integration.groupBy({
      by: ['providerIdentifier'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      providerIdentifier: row.providerIdentifier,
      connected: row._count._all,
    }));
  }

  /**
   * Phase 5 migration state, counted on the access-token field (the
   * refresh token carries the same marker — both are written by the
   * same repository funnel). Skool is reported separately: its stored
   * value is provider ciphertext without the marker, by design.
   */
  async tokenEncryptionCounts() {
    const prefix = INTEGRATION_TOKEN_ENCRYPTION_PREFIX;
    const [total, encrypted, preEncrypted, plaintext] = await Promise.all([
      this._integration.model.integration.count({
        where: { deletedAt: null },
      }),
      this._integration.model.integration.count({
        where: { deletedAt: null, token: { startsWith: prefix } },
      }),
      this._integration.model.integration.count({
        where: {
          deletedAt: null,
          providerIdentifier: { in: TOKEN_PRE_ENCRYPTED_PROVIDERS },
        },
      }),
      this._integration.model.integration.count({
        where: {
          deletedAt: null,
          providerIdentifier: { notIn: TOKEN_PRE_ENCRYPTED_PROVIDERS },
          NOT: { token: { startsWith: prefix } },
        },
      }),
    ]);
    return { total, encrypted, plaintext, preEncrypted };
  }

  async engagementActivity() {
    const [totalSnapshots, latest] = await Promise.all([
      this._snapshot.model.postEngagementSnapshot.count(),
      this._snapshot.model.postEngagementSnapshot.findFirst({
        orderBy: { capturedAt: 'desc' },
        select: { capturedAt: true },
      }),
    ]);
    return {
      totalSnapshots,
      latestCapturedAt: latest?.capturedAt ?? null,
    };
  }
}
