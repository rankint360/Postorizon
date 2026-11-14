import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';

/** Tokens expiring within this many days are flagged "expiring soon". */
export const TOKEN_EXPIRING_SOON_DAYS = 7;
/** Publish errors are counted over this trailing window. */
export const HEALTH_ERROR_WINDOW_DAYS = 30;
/**
 * Token-expiry notification dedupe window: at most one notification
 * per integration per token state per this many days (Phase 3
 * remediation, Item 6).
 */
export const TOKEN_EXPIRY_NOTIFICATION_DEDUPE_DAYS = 7;

/**
 * Dedupe marker embedded at the end of a token-expiry notification's
 * content. The notifications model stores free-text content only (no
 * type/source columns), so the sweep finds its own previous
 * notifications by this stable per-integration, per-state marker.
 */
export const tokenExpiryNotificationMarker = (
  integrationId: string,
  tokenState: 'expiring_soon' | 'expired'
) => `[token-health:${integrationId}:${tokenState}]`;

export type IntegrationHealth = {
  id: string;
  name: string;
  providerIdentifier: string;
  disabled: boolean;
  refreshNeeded: boolean;
  tokenExpiration: Date | null;
  tokenState: 'ok' | 'expiring_soon' | 'expired' | 'unknown';
  daysUntilExpiration: number | null;
  recentErrorCount: number;
  lastErrorAt: Date | null;
};

/**
 * Postorizon Phase 3 — reliability surfacing (MVP_SPEC §3.2.4 display
 * layer). The substrate already exists (Integration.tokenExpiration +
 * the Temporal refresh workflow + per-post Errors rows from publish
 * failures); this service only summarizes it per channel. No new retry
 * or refresh machinery is added — the refresh workflow keeps owning
 * token renewal; this is the user-facing health view it never had.
 */
@Injectable()
export class IntegrationHealthService {
  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _errors: PrismaRepository<'errors'>,
    private _organization: PrismaRepository<'organization'>,
    private _notificationService: NotificationService,
    private _notificationsRepository: NotificationsRepository
  ) {}

  async getOrgHealth(organizationId: string): Promise<IntegrationHealth[]> {
    const since = new Date(
      Date.now() - HEALTH_ERROR_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    const [integrations, errors] = await Promise.all([
      this._integration.model.integration.findMany({
        where: { organizationId, deletedAt: null },
        select: {
          id: true,
          name: true,
          customName: true,
          providerIdentifier: true,
          disabled: true,
          refreshNeeded: true,
          tokenExpiration: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this._errors.model.errors.findMany({
        where: { organizationId, createdAt: { gte: since } },
        select: {
          createdAt: true,
          post: { select: { integrationId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
    ]);

    const errorsByIntegration = new Map<
      string,
      { count: number; lastErrorAt: Date }
    >();
    for (const error of errors) {
      const integrationId = error.post?.integrationId;
      if (!integrationId) {
        continue;
      }
      const current = errorsByIntegration.get(integrationId);
      if (current) {
        current.count++;
      } else {
        // rows are newest-first, so the first sighting is the latest
        errorsByIntegration.set(integrationId, {
          count: 1,
          lastErrorAt: error.createdAt,
        });
      }
    }

    const now = Date.now();
    return integrations.map((integration) => {
      const expiration = integration.tokenExpiration;
      const daysUntilExpiration = expiration
        ? Math.floor((expiration.getTime() - now) / (24 * 60 * 60 * 1000))
        : null;
      const tokenState: IntegrationHealth['tokenState'] = !expiration
        ? 'unknown'
        : daysUntilExpiration! < 0
          ? 'expired'
          : daysUntilExpiration! <= TOKEN_EXPIRING_SOON_DAYS
            ? 'expiring_soon'
            : 'ok';
      const errorStats = errorsByIntegration.get(integration.id);
      return {
        id: integration.id,
        name: integration.customName || integration.name,
        providerIdentifier: integration.providerIdentifier,
        disabled: integration.disabled,
        refreshNeeded: integration.refreshNeeded,
        tokenExpiration: expiration,
        tokenState,
        daysUntilExpiration,
        recentErrorCount: errorStats?.count || 0,
        lastErrorAt: errorStats?.lastErrorAt || null,
      };
    });
  }

  /**
   * Phase 3 remediation (Item 6) — proactive token-expiry
   * notifications. Sweeps every organization; for each channel whose
   * tokenState is 'expiring_soon' (<= TOKEN_EXPIRING_SOON_DAYS days)
   * or 'expired', creates ONE in-app notification for the
   * organization (the notifications system is org-scoped — there is
   * no per-user targeting in the model — and every org member with
   * access to the notifications bell sees it; no email is sent).
   *
   * Dedupe rule: at most one notification per integration per state
   * per TOKEN_EXPIRY_NOTIFICATION_DEDUPE_DAYS (7) days, implemented
   * by scanning the org's notifications in that window for the
   * marker tokenExpiryNotificationMarker embeds in the content.
   *
   * Called by the orchestrator's engagementSamplingWorkflow on the
   * same cadence as engagement sampling. A failure for one
   * organization never aborts the rest of the sweep.
   */
  async notifyTokenExpiryForAllOrganizations() {
    const organizations = await this._organization.model.organization.findMany(
      {
        where: { deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }
    );
    const dedupeSince = new Date(
      Date.now() -
        TOKEN_EXPIRY_NOTIFICATION_DEDUPE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    let checked = 0;
    let notified = 0;
    let duplicates = 0;
    let organizationsFailed = 0;
    for (const organization of organizations) {
      try {
        const health = await this.getOrgHealth(organization.id);
        const expiring = health.filter(
          (channel) =>
            channel.tokenState === 'expiring_soon' ||
            channel.tokenState === 'expired'
        );
        if (!expiring.length) {
          continue;
        }

        const recent = await this._notificationsRepository.getNotificationsSince(
          organization.id,
          dedupeSince
        );

        for (const channel of expiring) {
          checked++;
          const state = channel.tokenState as 'expiring_soon' | 'expired';
          const marker = tokenExpiryNotificationMarker(channel.id, state);
          if (recent.some((n) => n.content.includes(marker))) {
            duplicates++;
            continue;
          }
          const message =
            state === 'expired'
              ? `Your ${channel.providerIdentifier} channel "${channel.name}" token has expired. Reconnect it to keep posting. ${marker}`
              : `Your ${channel.providerIdentifier} channel "${channel.name}" token expires in ${channel.daysUntilExpiration} day(s). Reconnect it soon to avoid interruptions. ${marker}`;
          await this._notificationService.inAppNotification(
            organization.id,
            state === 'expired'
              ? 'Channel token expired'
              : 'Channel token expiring soon',
            message,
            false,
            false,
            'info'
          );
          notified++;
        }
      } catch (err) {
        organizationsFailed++;
      }
    }

    return {
      organizations: organizations.length,
      organizationsFailed,
      checked,
      notified,
      duplicates,
    };
  }
}
