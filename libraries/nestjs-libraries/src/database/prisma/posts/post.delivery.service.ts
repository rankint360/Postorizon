import { HttpException, Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type DeliveryEvent = {
  kind: 'created' | 'approval' | 'scheduled' | 'error' | 'published';
  /** ISO timestamp, or null when no persisted field records the time. */
  at: string | null;
  message?: string;
  platform?: string;
  state?: string;
  viaLink?: boolean;
  releaseURL?: string;
};

export type PostDeliveryTimeline = {
  post: {
    id: string;
    state: string;
    approvalState: string;
    publishDate: Date;
    releaseId: string | null;
    releaseURL: string | null;
    /** The post row's own last-error string, when one is recorded. */
    error: string | null;
    integration: {
      id: string;
      name: string;
      providerIdentifier: string;
      picture: string | null;
    } | null;
  };
  /** Number of recorded publish failures (one Errors row per failure). */
  errorCount: number;
  /** True when the post is PUBLISHED and no failure was ever recorded. */
  deliveredFirstTry: boolean | null;
  events: DeliveryEvent[];
};

/**
 * Postorizon Phase 4 — per-post delivery timeline (MVP_SPEC §3.2.4
 * completion). Phase 3 surfaced reliability per channel (error counts,
 * token state); this is the per-post publish-status view that was
 * missing.
 *
 * The timeline is built ONLY from persisted fields:
 * - Post.createdAt                       → "created"
 * - PostApproval rows (the audit trail)  → one event per approval action
 * - Post.publishDate                     → "scheduled for" (planned time)
 * - Errors rows (one per publish failure recorded by the publish
 *   workflow)                            → one event per failure, with
 *                                          the provider's error message
 * - Post.state = PUBLISHED + releaseURL  → "published"
 *
 * There is deliberately no timestamp on the "published" event: no
 * persisted field records when publishing completed (Post.updatedAt
 * moves on any later edit, so using it would fabricate a time).
 * Likewise, attempts are never synthesised — the failure count is
 * exactly the number of Errors rows for the post.
 */
@Injectable()
export class PostDeliveryService {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _errors: PrismaRepository<'errors'>,
    private _postApproval: PrismaRepository<'postApproval'>
  ) {}

  async getDeliveryTimeline(
    organizationId: string,
    postId: string
  ): Promise<PostDeliveryTimeline> {
    const post = await this._post.model.post.findFirst({
      where: { id: postId, organizationId, deletedAt: null },
      select: {
        id: true,
        state: true,
        approvalState: true,
        publishDate: true,
        releaseId: true,
        releaseURL: true,
        error: true,
        createdAt: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
          },
        },
      },
    });

    if (!post) {
      throw new HttpException('Post not found', 404);
    }

    const [errors, approvals] = await Promise.all([
      this._errors.model.errors.findMany({
        where: { postId, organizationId },
        select: { message: true, platform: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this._postApproval.model.postApproval.findMany({
        where: { postId, organizationId },
        select: {
          state: true,
          comment: true,
          viaLink: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const events: DeliveryEvent[] = [
      { kind: 'created', at: post.createdAt.toISOString() },
      ...approvals.map(
        (a): DeliveryEvent => ({
          kind: 'approval',
          at: a.createdAt.toISOString(),
          state: a.state,
          viaLink: a.viaLink,
          ...(a.comment ? { message: a.comment } : {}),
        })
      ),
      { kind: 'scheduled', at: post.publishDate.toISOString() },
      ...errors.map(
        (e): DeliveryEvent => ({
          kind: 'error',
          at: e.createdAt.toISOString(),
          message: e.message,
          platform: e.platform,
        })
      ),
    ];

    if (post.state === 'PUBLISHED') {
      events.push({
        kind: 'published',
        at: null,
        ...(post.releaseURL ? { releaseURL: post.releaseURL } : {}),
      });
    }

    events.sort((a, b) => {
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return a.at.localeCompare(b.at);
    });

    return {
      post: {
        id: post.id,
        state: post.state,
        approvalState: post.approvalState,
        publishDate: post.publishDate,
        releaseId: post.releaseId,
        releaseURL: post.releaseURL,
        error: post.error,
        integration: post.integration,
      },
      errorCount: errors.length,
      deliveredFirstTry:
        post.state === 'PUBLISHED' ? errors.length === 0 : null,
      events,
    };
  }
}
