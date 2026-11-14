import { Injectable } from '@nestjs/common';
import { EngagementRepository } from '@gitroom/nestjs-libraries/database/prisma/engagement/engagement.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

/** Canonical metric buckets every provider label is normalized into. */
export type NormalizedMetrics = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  quotes: number | null;
  engagement: number;
};

export type LatestPostEngagement = {
  postId: string;
  integrationId: string;
  providerIdentifier: string;
  integrationName: string | null;
  customerId: string | null;
  publishDate: Date;
  content: string;
  hasMedia: boolean;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  engagement: number;
  capturedAt: Date;
};

export type BestTimeSlot = {
  weekday: number; // 0 = Sunday … 6 = Saturday, in the requested offset
  hour: number; // 0–23, in the requested offset
  avgEngagement: number;
  posts: number;
};

/** Minimum distinct sampled posts before any aggregate is called signal. */
export const MIN_POSTS_FOR_BEST_TIME = 8;
/** A weekday/hour bucket needs at least this many posts to be ranked. */
export const MIN_POSTS_PER_SLOT = 2;

/**
 * Provider label → canonical bucket. Labels were collected from the
 * providers' postAnalytics implementations (X, Instagram, Facebook,
 * YouTube, LinkedIn, TikTok, Pinterest, …). When two synonymous labels
 * map to one bucket, the LARGEST reported value wins — summing synonyms
 * (e.g. a provider reporting both "Views" and "Impressions" for the same
 * underlying count) would double-count.
 */
const LABEL_TO_BUCKET: Record<string, keyof NormalizedMetrics | 'providerEngagement'> = {
  views: 'views',
  impressions: 'views',
  plays: 'views',
  'video views': 'views',
  reach: 'reach',
  likes: 'likes',
  reactions: 'likes',
  comments: 'comments',
  replies: 'comments',
  shares: 'shares',
  retweets: 'shares',
  reposts: 'shares',
  saves: 'saves',
  saved: 'saves',
  bookmarks: 'saves',
  clicks: 'clicks',
  'link clicks': 'clicks',
  'profile clicks': 'clicks',
  'url clicks': 'clicks',
  quotes: 'quotes',
  engagement: 'providerEngagement',
  engagements: 'providerEngagement',
};

/**
 * Postorizon Phase 3 — engagement persistence + aggregates.
 *
 * Sampling calls the exact path the analytics UI uses
 * (PostsService.checkPostAnalytics, which handles token refresh and the
 * provider's postAnalytics) and persists a normalized snapshot. Provider
 * post metrics are cumulative lifetime totals, so aggregates always use
 * the LATEST snapshot per post, never a sum across snapshots.
 *
 * Scheduling: sampling is triggered through POST /engagement/sample
 * (on-demand) and, since the Phase 3 remediation, recurringly by the
 * orchestrator's engagementSamplingWorkflow, which calls
 * sampleAllOrganizations() on a fixed cadence. (This codebase has no
 * Temporal Schedule registrations; the workflow is an infinite
 * sleep + continueAsNew loop started at orchestrator boot — the same
 * pattern as missingPostWorkflow. See REMEDIATION_REPORT.md.)
 */
@Injectable()
export class EngagementService {
  constructor(
    private _engagementRepository: EngagementRepository,
    private _postsService: PostsService
  ) {}

  /** AnalyticsData[] → canonical buckets (see LABEL_TO_BUCKET rules). */
  normalize(analytics: AnalyticsData[]): NormalizedMetrics {
    const buckets = new Map<string, number>();
    let providerEngagement: number | null = null;

    for (const entry of analytics || []) {
      const bucket = LABEL_TO_BUCKET[String(entry.label || '').toLowerCase().trim()];
      if (!bucket) {
        continue;
      }
      // One entry's total: its data points summed (post analytics
      // normally return a single cumulative point dated today).
      const total = (entry.data || []).reduce((sum, point) => {
        const value = parseFloat(String(point.total));
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
      if (bucket === 'providerEngagement') {
        providerEngagement =
          providerEngagement === null ? total : Math.max(providerEngagement, total);
        continue;
      }
      const current = buckets.get(bucket);
      buckets.set(bucket, current === undefined ? total : Math.max(current, total));
    }

    const get = (key: keyof NormalizedMetrics) =>
      buckets.has(key) ? (buckets.get(key) as number) : null;

    const likes = get('likes');
    const comments = get('comments');
    const shares = get('shares');
    const saves = get('saves');
    const clicks = get('clicks');
    const quotes = get('quotes');
    const components = [likes, comments, shares, saves, clicks, quotes].filter(
      (v): v is number => v !== null
    );
    const engagement = components.length
      ? components.reduce((a, b) => a + b, 0)
      : providerEngagement ?? 0;

    return {
      views: get('views'),
      reach: get('reach'),
      likes,
      comments,
      shares,
      saves,
      clicks,
      quotes,
      engagement,
    };
  }

  /**
   * Sample one published post now. Returns sampled=false (with a reason)
   * instead of throwing when the provider has nothing for the post, so
   * batch runs can proceed.
   */
  async samplePost(
    organizationId: string,
    postId: string
  ): Promise<{ sampled: boolean; reason?: string; snapshotId?: string }> {
    const post = await this._engagementRepository.getPostForSnapshot(
      organizationId,
      postId
    );
    if (!post) {
      return { sampled: false, reason: 'post not found in this organization' };
    }

    const analytics = await this._postsService.checkPostAnalytics(
      organizationId,
      postId,
      7
    );
    if (!Array.isArray(analytics) || !analytics.length) {
      return {
        sampled: false,
        reason: 'provider returned no analytics for this post',
      };
    }

    const normalized = this.normalize(analytics);
    const snapshot = await this._engagementRepository.createSnapshot({
      organizationId,
      postId: post.id,
      integrationId: post.integrationId,
      providerIdentifier: post.integration?.providerIdentifier || 'unknown',
      publishDate: post.publishDate,
      views: normalized.views,
      reach: normalized.reach,
      likes: normalized.likes,
      comments: normalized.comments,
      shares: normalized.shares,
      saves: normalized.saves,
      clicks: normalized.clicks,
      quotes: normalized.quotes,
      engagement: normalized.engagement,
      metrics: { ...normalized },
      raw: analytics,
    });
    return { sampled: true, snapshotId: snapshot.id };
  }

  /**
   * Sample the org's recently published posts (newest first). Each post
   * is isolated: one provider failure never aborts the batch.
   */
  async sampleOrganization(
    organizationId: string,
    options?: { days?: number; limit?: number }
  ) {
    const days = Math.min(Math.max(options?.days || 30, 1), 365);
    const limit = Math.min(Math.max(options?.limit || 50, 1), 200);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const candidates = await this._engagementRepository.listSampleCandidates(
      organizationId,
      since,
      limit
    );

    let sampled = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const result = await this.samplePost(organizationId, candidate.id);
        if (result.sampled) {
          sampled++;
        } else {
          skipped++;
        }
      } catch (err) {
        failed++;
      }
    }
    return { candidates: candidates.length, sampled, skipped, failed };
  }

  /**
   * One recurring-sweep pass over every organization (used by the
   * orchestrator's engagementSamplingWorkflow). Each organization is
   * sampled with sampleOrganization's own bounds (default 30-day
   * window, 50-post cap), sequentially — provider rate limits make
   * naive parallelism unsafe — and a failure in one organization
   * never aborts the rest of the sweep.
   */
  async sampleAllOrganizations(options?: { days?: number; limit?: number }) {
    const organizations =
      await this._engagementRepository.listOrganizationIds();

    let sampled = 0;
    let skipped = 0;
    let failed = 0;
    let organizationsFailed = 0;
    for (const organization of organizations) {
      try {
        const result = await this.sampleOrganization(
          organization.id,
          options
        );
        sampled += result.sampled;
        skipped += result.skipped;
        failed += result.failed;
      } catch (err) {
        organizationsFailed++;
      }
    }

    return {
      organizations: organizations.length,
      organizationsFailed,
      sampled,
      skipped,
      failed,
    };
  }

  getPostSnapshots(organizationId: string, postId: string) {
    return this._engagementRepository.listByPost(organizationId, postId);
  }

  getIntegrationSnapshots(
    organizationId: string,
    integrationId: string,
    limit?: number
  ) {
    return this._engagementRepository.listByIntegration(
      organizationId,
      integrationId,
      Math.min(Math.max(limit || 200, 1), 500)
    );
  }

  /** Latest snapshot per post, deduped from the newest-first raw list. */
  async latestPerPost(
    organizationId: string,
    filters: { integrationId?: string; customerId?: string } = {}
  ): Promise<LatestPostEngagement[]> {
    const rows = await this._engagementRepository.listForAggregation(
      organizationId,
      filters
    );
    const seen = new Set<string>();
    const latest: LatestPostEngagement[] = [];
    for (const row of rows) {
      if (seen.has(row.postId)) {
        continue;
      }
      seen.add(row.postId);
      latest.push({
        postId: row.postId,
        integrationId: row.integrationId,
        providerIdentifier: row.providerIdentifier,
        integrationName: row.post?.integration?.name || null,
        customerId: row.post?.integration?.customerId || null,
        publishDate: row.publishDate,
        content: row.post?.content || '',
        hasMedia: !!row.post?.image && row.post.image !== '[]',
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        saves: row.saves,
        clicks: row.clicks,
        engagement: row.engagement,
        capturedAt: row.capturedAt,
      });
    }
    return latest;
  }

  /**
   * Weekday/hour buckets in the requested UTC offset (minutes east of
   * UTC; default 0 = UTC). Publish timestamps are stored in UTC and the
   * Organization model carries no timezone, so the offset is a client
   * input — the frontend passes the viewer's browser offset. This
   * assumption is returned in the payload (`utcOffsetMinutes`) rather
   * than hidden.
   */
  bucketByWeekdayHour(
    posts: LatestPostEngagement[],
    utcOffsetMinutes = 0
  ): BestTimeSlot[] {
    const buckets = new Map<
      string,
      { weekday: number; hour: number; sum: number; posts: number }
    >();
    for (const post of posts) {
      const shifted = new Date(
        post.publishDate.getTime() + utcOffsetMinutes * 60 * 1000
      );
      const weekday = shifted.getUTCDay();
      const hour = shifted.getUTCHours();
      const key = `${weekday}-${hour}`;
      const bucket = buckets.get(key) || { weekday, hour, sum: 0, posts: 0 };
      bucket.sum += post.engagement;
      bucket.posts++;
      buckets.set(key, bucket);
    }
    return [...buckets.values()]
      .filter((b) => b.posts >= MIN_POSTS_PER_SLOT)
      .map((b) => ({
        weekday: b.weekday,
        hour: b.hour,
        avgEngagement: Math.round((b.sum / b.posts) * 100) / 100,
        posts: b.posts,
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);
  }

  /** §3.2.6 best-time: ranked slots, or an honest "not enough data" state. */
  async getBestTimes(
    organizationId: string,
    options?: { integrationId?: string; utcOffsetMinutes?: number }
  ) {
    const posts = await this.latestPerPost(organizationId, {
      integrationId: options?.integrationId,
    });
    const utcOffsetMinutes = options?.utcOffsetMinutes || 0;
    if (posts.length < MIN_POSTS_FOR_BEST_TIME) {
      return {
        insufficientData: true,
        postsSampled: posts.length,
        minimumRequired: MIN_POSTS_FOR_BEST_TIME,
        utcOffsetMinutes,
        slots: [] as BestTimeSlot[],
      };
    }
    return {
      insufficientData: false,
      postsSampled: posts.length,
      minimumRequired: MIN_POSTS_FOR_BEST_TIME,
      utcOffsetMinutes,
      slots: this.bucketByWeekdayHour(posts, utcOffsetMinutes).slice(0, 5),
    };
  }

  /**
   * Prescriptive analytics v1 — "what to post next" (Phase 3 Item 4).
   *
   * Every recommendation is a rule over real aggregates of the org's own
   * persisted snapshots / publish history, and carries the numbers it
   * was derived from in `data`. Nothing is generated by an AI model and
   * no number is invented: a pattern is only reported when both sides
   * of the comparison have >= 3 sampled posts and the stronger side's
   * average engagement is at least 1.25x the weaker side's.
   */
  async getRecommendations(organizationId: string, utcOffsetMinutes = 0) {
    const posts = await this.latestPerPost(organizationId);
    const insufficientEngagementData = posts.length < MIN_POSTS_FOR_BEST_TIME;
    const recommendations: {
      type: 'best_time' | 'content_pattern' | 'top_post' | 'cadence';
      title: string;
      detail: string;
      data: Record<string, unknown>;
    }[] = [];

    if (!insufficientEngagementData) {
      const slots = this.bucketByWeekdayHour(posts, utcOffsetMinutes);
      if (slots.length) {
        const top = slots[0];
        const dayName = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ][top.weekday];
        recommendations.push({
          type: 'best_time',
          title: `Post on ${dayName} around ${String(top.hour).padStart(2, '0')}:00`,
          detail: `That slot averages ${top.avgEngagement} engagement across ${top.posts} of your sampled posts — the strongest weekday/hour in your own data.`,
          data: { slots: slots.slice(0, 3), utcOffsetMinutes },
        });
      }

      const compare = (
        label: string,
        predicate: (p: LatestPostEngagement) => boolean,
        describe: (winner: string, winnerAvg: number, loserAvg: number) => string
      ) => {
        const yes = posts.filter(predicate);
        const no = posts.filter((p) => !predicate(p));
        if (yes.length < 3 || no.length < 3) {
          return;
        }
        const avg = (list: LatestPostEngagement[]) =>
          Math.round(
            (list.reduce((s, p) => s + p.engagement, 0) / list.length) * 100
          ) / 100;
        const yesAvg = avg(yes);
        const noAvg = avg(no);
        if (yesAvg >= noAvg * 1.25 && yesAvg > noAvg) {
          recommendations.push({
            type: 'content_pattern',
            title: label,
            detail: describe('with', yesAvg, noAvg),
            data: { withPattern: yesAvg, withoutPattern: noAvg, postsWith: yes.length, postsWithout: no.length },
          });
        } else if (noAvg >= yesAvg * 1.25 && noAvg > yesAvg) {
          recommendations.push({
            type: 'content_pattern',
            title: label,
            detail: describe('without', noAvg, yesAvg),
            data: { withPattern: yesAvg, withoutPattern: noAvg, postsWith: yes.length, postsWithout: no.length },
          });
        }
      };

      compare(
        'Media attachments',
        (p) => p.hasMedia,
        (winner, winnerAvg, loserAvg) =>
          `Posts ${winner} media average ${winnerAvg} engagement vs ${loserAvg} without — keep the stronger format in rotation.`
      );
      compare(
        'Asking a question',
        (p) => p.content.includes('?'),
        (winner, winnerAvg, loserAvg) =>
          `Posts ${winner === 'with' ? 'that ask' : 'that do not ask'} a question average ${winnerAvg} engagement vs ${loserAvg} for the other style.`
      );
      compare(
        'Short vs long copy',
        (p) => p.content.replace(/<[^>]+>/g, ' ').trim().length < 100,
        (winner, winnerAvg, loserAvg) =>
          winner === 'with'
            ? `Short posts (under 100 characters) average ${winnerAvg} engagement vs ${loserAvg} for longer ones.`
            : `Longer posts average ${winnerAvg} engagement vs ${loserAvg} for short ones (under 100 characters).`
      );

      const topPost = [...posts].sort((a, b) => b.engagement - a.engagement)[0];
      if (topPost && topPost.engagement > 0) {
        recommendations.push({
          type: 'top_post',
          title: 'Your strongest recent post',
          detail: `"${String(topPost.content || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160)}" reached ${topPost.engagement} engagement on ${topPost.providerIdentifier}. Its format is a proven template for the next posts.`,
          data: {
            postId: topPost.postId,
            providerIdentifier: topPost.providerIdentifier,
            engagement: topPost.engagement,
            views: topPost.views,
          },
        });
      }
    }

    // Posting cadence over the last 4 x 7 days, from publish history
    // (independent of engagement sampling).
    const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const published = await this._engagementRepository.listPublishedDates(
      organizationId,
      since
    );
    const weekCounts = [0, 0, 0, 0];
    for (const row of published) {
      const ageDays = Math.floor(
        (Date.now() - row.publishDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      const weekIndex = Math.min(3, Math.floor(ageDays / 7));
      weekCounts[3 - weekIndex]++;
    }
    const [w1, w2, w3, w4] = weekCounts;
    if (published.length === 0) {
      recommendations.push({
        type: 'cadence',
        title: 'Nothing published in the last 4 weeks',
        detail:
          'Your channels have been silent for 28 days. Publishing consistently is the precondition for every other recommendation here.',
        data: { weekCounts },
      });
    } else if (w4 === 0) {
      recommendations.push({
        type: 'cadence',
        title: 'Nothing published in the last 7 days',
        detail: `You published ${w1 + w2 + w3} posts in the three weeks before that. A silent week breaks the cadence your audience was seeing.`,
        data: { weekCounts },
      });
    } else {
      const priorAvg = (w1 + w2 + w3) / 3;
      if (priorAvg > 0 && w4 < priorAvg / 2) {
        recommendations.push({
          type: 'cadence',
          title: 'Posting has slowed down',
          detail: `The last 7 days saw ${w4} posts vs a ${Math.round(priorAvg * 100) / 100}-per-week pace over the previous three weeks.`,
          data: { weekCounts },
        });
      }
    }

    return {
      postsSampled: posts.length,
      minimumRequired: MIN_POSTS_FOR_BEST_TIME,
      insufficientEngagementData,
      recommendations,
    };
  }

  /**
   * Performance summary over one customer group's channels — the signal
   * source for the agent feedback loop (Item 3) and recommendations
   * (Item 4). Returns null when the group has no snapshots at all, so
   * callers can fall back to their no-data behaviour exactly.
   */
  async getPerformanceSummary(
    organizationId: string,
    customerId: string,
    utcOffsetMinutes = 0
  ) {
    const posts = await this.latestPerPost(organizationId, { customerId });
    if (!posts.length) {
      return null;
    }
    const topPosts = [...posts]
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 5)
      .map((p) => ({
        postId: p.postId,
        providerIdentifier: p.providerIdentifier,
        publishDate: p.publishDate,
        excerpt: String(p.content || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200),
        engagement: p.engagement,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
      }));
    const avgEngagement =
      Math.round(
        (posts.reduce((sum, p) => sum + p.engagement, 0) / posts.length) * 100
      ) / 100;
    return {
      postsSampled: posts.length,
      avgEngagement,
      topPosts,
      bestSlots: this.bucketByWeekdayHour(posts, utcOffsetMinutes).slice(0, 3),
      posts,
    };
  }
}
