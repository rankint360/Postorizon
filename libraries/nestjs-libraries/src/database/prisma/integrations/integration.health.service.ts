import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/** Tokens expiring within this many days are flagged "expiring soon". */
export const TOKEN_EXPIRING_SOON_DAYS = 7;
/** Publish errors are counted over this trailing window. */
export const HEALTH_ERROR_WINDOW_DAYS = 30;

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
    private _errors: PrismaRepository<'errors'>
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
}
