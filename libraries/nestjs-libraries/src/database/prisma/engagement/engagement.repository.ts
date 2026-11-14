import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

/**
 * Postorizon Phase 3 — engagement persistence (foundation for MVP_SPEC
 * §3.2.6 best-time, §3.2.2 agent feedback loop, prescriptive analytics).
 *
 * Providers are only ever queried live in this codebase
 * (PostsService.checkPostAnalytics); this repository is the storage side:
 * one PostEngagementSnapshot row per sampling of one published post.
 * Aggregates always read the LATEST snapshot per post (see the service),
 * because provider post metrics are cumulative lifetime totals.
 */
@Injectable()
export class EngagementRepository {
  constructor(
    private _snapshot: PrismaRepository<'postEngagementSnapshot'>,
    private _post: PrismaRepository<'post'>
  ) {}

  /** Published posts eligible for sampling: released, recent, org-scoped. */
  listSampleCandidates(organizationId: string, since: Date, take: number) {
    return this._post.model.post.findMany({
      where: {
        organizationId,
        state: 'PUBLISHED',
        deletedAt: null,
        releaseId: { not: null },
        publishDate: { gte: since },
      },
      orderBy: { publishDate: 'desc' },
      take,
      select: { id: true },
    });
  }

  /** The post fields a snapshot denormalizes (publish time + channel). */
  getPostForSnapshot(organizationId: string, postId: string) {
    return this._post.model.post.findFirst({
      where: { id: postId, organizationId, deletedAt: null },
      select: {
        id: true,
        publishDate: true,
        integrationId: true,
        integration: { select: { providerIdentifier: true } },
      },
    });
  }

  createSnapshot(data: {
    organizationId: string;
    postId: string;
    integrationId: string;
    providerIdentifier: string;
    publishDate: Date;
    views: number | null;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    clicks: number | null;
    quotes: number | null;
    engagement: number;
    metrics: Record<string, number | null>;
    raw: unknown;
  }) {
    return this._snapshot.model.postEngagementSnapshot.create({
      data: {
        organizationId: data.organizationId,
        postId: data.postId,
        integrationId: data.integrationId,
        providerIdentifier: data.providerIdentifier,
        publishDate: data.publishDate,
        views: data.views,
        reach: data.reach,
        likes: data.likes,
        comments: data.comments,
        shares: data.shares,
        saves: data.saves,
        clicks: data.clicks,
        quotes: data.quotes,
        engagement: data.engagement,
        metrics: data.metrics as any,
        raw: data.raw as any,
      },
    });
  }

  /** Time series for one post, newest first. */
  listByPost(organizationId: string, postId: string, take = 100) {
    return this._snapshot.model.postEngagementSnapshot.findMany({
      where: { organizationId, postId },
      orderBy: { capturedAt: 'desc' },
      take,
    });
  }

  /** Snapshots across one channel's posts, newest first. */
  listByIntegration(organizationId: string, integrationId: string, take = 200) {
    return this._snapshot.model.postEngagementSnapshot.findMany({
      where: { organizationId, integrationId },
      orderBy: { capturedAt: 'desc' },
      take,
      include: {
        post: {
          select: { id: true, content: true, publishDate: true, state: true },
        },
      },
    });
  }

  /**
   * Raw material for aggregates: snapshots newest-first (the service
   * dedupes to the latest per post). `customerId` filters through the
   * post's channel (Post has no customer field of its own; the channel
   * carries it), using relation filters only — no invented relations.
   */
  listForAggregation(
    organizationId: string,
    filters: { integrationId?: string; customerId?: string },
    take = 2000
  ) {
    return this._snapshot.model.postEngagementSnapshot.findMany({
      where: {
        organizationId,
        ...(filters.integrationId
          ? { integrationId: filters.integrationId }
          : {}),
        ...(filters.customerId
          ? { post: { integration: { customerId: filters.customerId } } }
          : {}),
      },
      orderBy: { capturedAt: 'desc' },
      take,
      include: {
        post: {
          select: {
            id: true,
            content: true,
            image: true,
            publishDate: true,
            integrationId: true,
            integration: {
              select: { providerIdentifier: true, name: true, customerId: true },
            },
          },
        },
      },
    });
  }

  /** Publish dates of the org's published posts since a date (cadence). */
  listPublishedDates(organizationId: string, since: Date) {
    return this._post.model.post.findMany({
      where: {
        organizationId,
        state: 'PUBLISHED',
        deletedAt: null,
        publishDate: { gte: since },
      },
      orderBy: { publishDate: 'asc' },
      select: { publishDate: true },
    });
  }
}
