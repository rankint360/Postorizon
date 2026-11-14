import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

/**
 * Postorizon Phase 2 — data access for the closed-loop agent v1
 * (MVP_SPEC §3.2.2): the customer group's channels, its published-post
 * history, and per-day posting load.
 *
 * Note on history: engagement metrics are NOT persisted in this codebase
 * (Phase 1 finding — providers are queried live for analytics), so the
 * agent's "what worked" input is the published content itself, not
 * performance numbers. The feedback loop closes only once an engagement
 * persistence layer exists.
 */
@Injectable()
export class WeeklyPlanRepository {
  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _post: PrismaRepository<'post'>
  ) {}

  getGroupIntegrations(organizationId: string, customerId: string) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId,
        customerId,
        disabled: false,
        deletedAt: null,
      },
      select: { id: true, providerIdentifier: true, name: true },
    });
  }

  getPublishedHistory(organizationId: string, customerId: string, take = 20) {
    return this._post.model.post.findMany({
      where: {
        organizationId,
        state: 'PUBLISHED',
        deletedAt: null,
        integration: { customerId },
      },
      orderBy: { publishDate: 'desc' },
      take,
      select: {
        content: true,
        publishDate: true,
        integration: { select: { providerIdentifier: true } },
      },
    });
  }

  /** Posts already occupying a calendar day (the daily-cap denominator). */
  countPostsOnDay(organizationId: string, dayStart: Date, dayEnd: Date) {
    return this._post.model.post.count({
      where: {
        organizationId,
        deletedAt: null,
        state: { in: ['DRAFT', 'QUEUE', 'PUBLISHED'] },
        publishDate: { gte: dayStart, lt: dayEnd },
      },
    });
  }
}
