import { HttpException, Injectable } from '@nestjs/common';
import { InboxRepository } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AiChatService } from '@gitroom/nestjs-libraries/database/prisma/ai/ai.chat.service';

export type InboxItem = {
  /** `${sourceType}:${sourceId}` — stable key for clients. */
  key: string;
  sourceType: 'comment' | 'approval';
  sourceId: string;
  body: string | null;
  authorName: string | null;
  viaLink: boolean;
  createdAt: Date;
  post: {
    id: string;
    content: string;
    state: string;
    approvalState: string;
    publishDate: Date;
    integration: {
      id: string;
      name: string;
      providerIdentifier: string;
      picture: string | null;
    } | null;
  };
  approvalState?: string;
  read: boolean;
  readAt: Date | null;
  assigneeId: string | null;
};

type Cursor = { createdAt: string; key: string };

/**
 * Postorizon Phase 2 — unified inbox v1 (MVP_SPEC §3.2.5), API-only.
 *
 * One paginated queue over the org's actionable items (see
 * InboxRepository for what exists to aggregate and why external platform
 * comments/DMs are not in v1: no provider in this codebase exposes a read
 * API for them). Triage state (read / assignee) is persisted in
 * InboxItemState. Replies to comment items go through the existing
 * comment-thread service; AI suggested replies use the BYOK-aware
 * AiChatService. Nothing is ever auto-sent.
 */
@Injectable()
export class InboxService {
  constructor(
    private _inboxRepository: InboxRepository,
    private _postsService: PostsService,
    private _aiChatService: AiChatService
  ) {}

  async getQueue(
    organizationId: string,
    options?: {
      limit?: number;
      cursor?: string;
      unreadOnly?: boolean;
      assigneeId?: string;
    }
  ): Promise<{ items: InboxItem[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(options?.limit || 30, 1), 100);
    const cursor = this.decodeCursor(options?.cursor);
    const before = cursor ? new Date(cursor.createdAt) : undefined;
    // Over-fetch each source, then merge. Approval rows need a wider
    // window because only the latest row per post counts as an item.
    const fetchSize = limit * 3;

    const [comments, approvals] = await Promise.all([
      this._inboxRepository.listOpenComments(organizationId, fetchSize, before),
      this._inboxRepository.listRecentApprovals(
        organizationId,
        fetchSize * 3,
        before
      ),
    ]);

    const items: InboxItem[] = [];

    // Approval rows carry only a bare userId (no `user` relation in the
    // schema), so resolve their authors in one batched lookup.
    const authorById = new Map(
      (
        await this._inboxRepository.getUsersByIds([
          ...new Set(
            approvals.map((a) => a.userId).filter((id): id is string => !!id)
          ),
        ])
      ).map((u) => [u.id, u] as const)
    );

    for (const comment of comments) {
      items.push({
        key: `comment:${comment.id}`,
        sourceType: 'comment',
        sourceId: comment.id,
        body: comment.content,
        authorName: comment.user
          ? [comment.user.name, comment.user.lastName]
              .filter(Boolean)
              .join(' ') || null
          : comment.displayName,
        viaLink: !comment.userId,
        createdAt: comment.createdAt,
        post: comment.post as InboxItem['post'],
        read: false,
        readAt: null,
        assigneeId: null,
      });
    }

    const seenPosts = new Set<string>();
    for (const approval of approvals) {
      if (seenPosts.has(approval.postId)) {
        continue;
      }
      seenPosts.add(approval.postId);
      const currentState = (approval.post as any)?.approvalState;
      if (currentState !== 'PENDING' && currentState !== 'CHANGES_REQUESTED') {
        continue;
      }
      const author = approval.userId
        ? authorById.get(approval.userId)
        : undefined;
      items.push({
        key: `approval:${approval.id}`,
        sourceType: 'approval',
        sourceId: approval.id,
        body: approval.comment,
        authorName: author
          ? [author.name, author.lastName].filter(Boolean).join(' ') || null
          : null,
        viaLink: approval.viaLink,
        createdAt: approval.createdAt,
        post: approval.post as InboxItem['post'],
        approvalState: currentState,
        read: false,
        readAt: null,
        assigneeId: null,
      });
    }

    items.sort((a, b) => {
      const byDate = b.createdAt.getTime() - a.createdAt.getTime();
      return byDate !== 0 ? byDate : b.key.localeCompare(a.key);
    });

    const afterCursor = cursor
      ? items.filter(
          (item) =>
            item.createdAt.getTime() < new Date(cursor.createdAt).getTime() ||
            (item.createdAt.getTime() ===
              new Date(cursor.createdAt).getTime() &&
              item.key < cursor.key)
        )
      : items;

    // Overlay persisted triage state.
    const states = await this._inboxRepository.getStates(
      organizationId,
      afterCursor
        .slice(0, limit * 2)
        .map((i) => ({ sourceType: i.sourceType, sourceId: i.sourceId }))
    );
    const stateByKey = new Map(
      states.map((s) => [`${s.sourceType}:${s.sourceId}`, s])
    );
    for (const item of afterCursor) {
      const state = stateByKey.get(item.key);
      if (state) {
        item.read = !!state.readAt;
        item.readAt = state.readAt;
        item.assigneeId = state.assigneeId;
      }
    }

    const filtered = afterCursor.filter((item) => {
      if (options?.unreadOnly && item.read) {
        return false;
      }
      if (options?.assigneeId === 'unassigned' && item.assigneeId) {
        return false;
      }
      if (
        options?.assigneeId &&
        options.assigneeId !== 'unassigned' &&
        item.assigneeId !== options.assigneeId
      ) {
        return false;
      }
      return true;
    });

    const page = filtered.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        filtered.length > limit && last
          ? this.encodeCursor({
              createdAt: last.createdAt.toISOString(),
              key: last.key,
            })
          : null,
    };
  }

  async updateState(
    organizationId: string,
    userId: string,
    sourceType: string,
    sourceId: string,
    body: { read?: boolean; assigneeId?: string | null }
  ) {
    if (sourceType !== 'comment' && sourceType !== 'approval') {
      throw new HttpException('Unknown inbox item type', 400);
    }
    const data: {
      readAt?: Date | null;
      readById?: string | null;
      assigneeId?: string | null;
    } = {};
    if (body.read !== undefined) {
      data.readAt = body.read ? new Date() : null;
      data.readById = body.read ? userId : null;
    }
    if (body.assigneeId !== undefined) {
      if (body.assigneeId !== null) {
        const member = await this._inboxRepository.isOrgMember(
          organizationId,
          body.assigneeId
        );
        if (!member) {
          throw new HttpException(
            'Assignee is not a member of this organization',
            400
          );
        }
      }
      data.assigneeId = body.assigneeId;
    }
    const state = await this._inboxRepository.upsertState(
      organizationId,
      sourceType,
      sourceId,
      data
    );
    return {
      key: `${sourceType}:${sourceId}`,
      read: !!state.readAt,
      readAt: state.readAt,
      assigneeId: state.assigneeId,
    };
  }

  /**
   * Reply to a comment item through the existing comment-thread service
   * (the same validated path the post UI uses). Replies attach to the
   * thread root, per the thread rules of that service.
   */
  async replyToComment(
    organizationId: string,
    userId: string,
    commentId: string,
    content: string,
    ip: string
  ) {
    const comment = await this._inboxRepository.getComment(
      organizationId,
      commentId
    );
    if (!comment) {
      throw new HttpException('Inbox comment not found', 404);
    }
    return this._postsService.createPublicComment(
      comment.postId,
      { content, parentId: comment.parentId || comment.id },
      userId,
      ip
    );
  }

  /** AI suggested reply for a comment item — a draft for a human, never sent. */
  async suggestReply(organizationId: string, commentId: string) {
    const comment = await this._inboxRepository.getComment(
      organizationId,
      commentId
    );
    if (!comment) {
      throw new HttpException('Inbox comment not found', 404);
    }
    const author =
      (comment.user
        ? [comment.user.name, comment.user.lastName].filter(Boolean).join(' ')
        : comment.displayName) || 'a reviewer';
    const { text, provider } = await this._aiChatService.chatCompletion(
      organizationId,
      [
        {
          role: 'system',
          content:
            'You help a social media team reply to feedback on a draft post. Write one short, friendly reply the team could post. Return only the reply text, no quotes, no preamble.',
        },
        {
          role: 'user',
          content: `Post draft:\n${comment.post?.content || ''}\n\nComment from ${author}:\n${comment.content}\n\nWrite the reply.`,
        },
      ],
      { maxTokens: 300 }
    );
    return { suggestion: text.trim(), provider };
  }

  private encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(raw?: string): Cursor | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, 'base64url').toString('utf8')
      );
      if (parsed?.createdAt && parsed?.key) {
        return parsed as Cursor;
      }
    } catch (err) {}
    return null;
  }
}
