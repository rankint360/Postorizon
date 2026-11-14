import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

const queuePostSelect = {
  id: true,
  content: true,
  state: true,
  approvalState: true,
  publishDate: true,
  integration: {
    select: { id: true, name: true, providerIdentifier: true, picture: true },
  },
} as const;

/**
 * Postorizon Phase 2 — unified inbox persistence (MVP_SPEC §3.2.5).
 *
 * What exists in this codebase to aggregate (verified in Phase 2 recon):
 * providers expose NO read API for external comments/DMs — the only
 * provider surface is post() and comment() (posting a comment onto a
 * published post through the publish workflow). The real, persisted,
 * org-scoped work items are therefore:
 *  - internal draft-collaboration comments (Comments model), including
 *    comments left by clients through public preview links, and
 *  - approval requests awaiting a decision (PostApproval audit rows whose
 *    post is currently PENDING or CHANGES_REQUESTED).
 * Read state / assignment for those items lives in InboxItemState.
 */
@Injectable()
export class InboxRepository {
  constructor(
    private _comments: PrismaRepository<'comments'>,
    private _postApproval: PrismaRepository<'postApproval'>,
    private _inboxState: PrismaRepository<'inboxItemState'>,
    private _userOrganization: PrismaRepository<'userOrganization'>,
    private _user: PrismaRepository<'user'>
  ) {}

  listOpenComments(organizationId: string, take: number, before?: Date) {
    return this._comments.model.comments.findMany({
      where: {
        organizationId,
        resolvedAt: null,
        deletedAt: null,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: {
        user: { select: { name: true, lastName: true } },
        post: { select: queuePostSelect },
      },
    });
  }

  /** Recent approval events for the org; the service keeps the latest per post. */
  listRecentApprovals(organizationId: string, take: number, before?: Date) {
    return this._postApproval.model.postApproval.findMany({
      where: {
        post: { organizationId },
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: {
        // NOTE: PostApproval has no `user` relation in the schema (userId
        // is a bare scalar), so the author is resolved separately via
        // getUsersByIds — including `user` here fails the backend build.
        post: { select: queuePostSelect },
      },
    });
  }

  /** Authors of approval rows, by user id (PostApproval has no user relation). */
  getUsersByIds(userIds: string[]) {
    if (!userIds.length) {
      return Promise.resolve([]);
    }
    return this._user.model.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, lastName: true },
    });
  }

  getComment(organizationId: string, commentId: string) {
    return this._comments.model.comments.findFirst({
      where: { id: commentId, organizationId, deletedAt: null },
      include: {
        user: { select: { name: true, lastName: true } },
        post: { select: queuePostSelect },
      },
    });
  }

  getStates(
    organizationId: string,
    keys: { sourceType: string; sourceId: string }[]
  ) {
    if (!keys.length) {
      return Promise.resolve([]);
    }
    return this._inboxState.model.inboxItemState.findMany({
      where: {
        organizationId,
        OR: keys.map((k) => ({
          sourceType: k.sourceType,
          sourceId: k.sourceId,
        })),
      },
    });
  }

  upsertState(
    organizationId: string,
    sourceType: string,
    sourceId: string,
    data: { readAt?: Date | null; readById?: string | null; assigneeId?: string | null }
  ) {
    return this._inboxState.model.inboxItemState.upsert({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId,
          sourceType,
          sourceId,
        },
      },
      create: { organizationId, sourceType, sourceId, ...data },
      update: data,
    });
  }

  listOrgMembers(organizationId: string) {
    return this._userOrganization.model.userOrganization.findMany({
      where: { organizationId, disabled: false },
      select: {
        user: { select: { id: true, name: true, lastName: true, email: true } },
      },
    });
  }

  isOrgMember(organizationId: string, userId: string) {
    return this._userOrganization.model.userOrganization.findFirst({
      where: { organizationId, userId, disabled: false },
      select: { id: true },
    });
  }
}
