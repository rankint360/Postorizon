import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { ApprovalState } from '@prisma/client';

/**
 * Postorizon Phase 1 — approval workflow persistence.
 *
 * The current state lives on Post (approvalState + approvalToken); every
 * transition also appends a PostApproval audit row.
 */
@Injectable()
export class PostApprovalsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _postApproval: PrismaRepository<'postApproval'>
  ) {}

  getPostForApproval(organizationId: string, postId: string) {
    return this._post.model.post.findFirst({
      where: { id: postId, organizationId, deletedAt: null },
      select: {
        id: true,
        state: true,
        approvalState: true,
        approvalToken: true,
        organizationId: true,
        integration: {
          select: { providerIdentifier: true },
        },
      },
    });
  }

  getPostByApprovalToken(token: string) {
    return this._post.model.post.findFirst({
      where: { approvalToken: token, deletedAt: null },
      select: {
        id: true,
        content: true,
        state: true,
        publishDate: true,
        approvalState: true,
        organizationId: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            profile: true,
          },
        },
      },
    });
  }

  async transition(
    postId: string,
    organizationId: string,
    state: ApprovalState,
    event: { userId?: string; comment?: string; viaLink?: boolean },
    approvalToken?: string
  ) {
    const post = await this._post.model.post.update({
      where: { id: postId },
      data: {
        approvalState: state,
        ...(approvalToken !== undefined ? { approvalToken } : {}),
      },
      select: { id: true, approvalState: true, approvalToken: true },
    });

    await this._postApproval.model.postApproval.create({
      data: {
        postId,
        organizationId,
        state,
        comment: event.comment,
        userId: event.userId,
        viaLink: !!event.viaLink,
      },
    });

    return post;
  }

  listApprovals(organizationId: string, postId: string) {
    return this._postApproval.model.postApproval.findMany({
      where: { postId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
