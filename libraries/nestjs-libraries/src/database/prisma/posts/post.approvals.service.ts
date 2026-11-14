import { HttpException, Injectable } from '@nestjs/common';
import { PostApprovalsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/post.approvals.repository';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ApprovalState } from '@prisma/client';

/**
 * Postorizon Phase 1 — native approval workflow (MVP_SPEC §3.2.1 core).
 *
 * Flow: a team member requests approval for a draft/queued post, which puts
 * it in PENDING and issues a shareable approval token. Approvers — either
 * logged-in org members or a client opening the shareable link (no login) —
 * approve or request changes, optionally leaving a comment. Every transition
 * is written to the PostApproval audit trail.
 *
 * Publishing is intentionally NOT blocked by this service yet: gating the
 * Temporal publish path on approvalState is a follow-up (see PHASE1_REPORT).
 */
@Injectable()
export class PostApprovalsService {
  constructor(private _postApprovalsRepository: PostApprovalsRepository) {}

  private async requirePost(organizationId: string, postId: string) {
    const post =
      await this._postApprovalsRepository.getPostForApproval(
        organizationId,
        postId
      );
    if (!post) {
      throw new HttpException('Post not found', 404);
    }
    return post;
  }

  private async requireLinkPost(token: string) {
    const post =
      await this._postApprovalsRepository.getPostByApprovalToken(token);
    if (!post) {
      throw new HttpException('Approval link not found', 404);
    }
    return post;
  }

  /** Org member asks for approval; creates the shareable token if needed. */
  async requestApproval(
    organizationId: string,
    userId: string,
    postId: string,
    comment?: string
  ) {
    const post = await this.requirePost(organizationId, postId);
    const token = post.approvalToken || makeId(32);
    return this._postApprovalsRepository.transition(
      postId,
      organizationId,
      ApprovalState.PENDING,
      { userId, comment },
      token
    );
  }

  async approve(
    organizationId: string,
    userId: string,
    postId: string,
    comment?: string
  ) {
    await this.requirePost(organizationId, postId);
    return this._postApprovalsRepository.transition(
      postId,
      organizationId,
      ApprovalState.APPROVED,
      { userId, comment }
    );
  }

  async requestChanges(
    organizationId: string,
    userId: string,
    postId: string,
    comment?: string
  ) {
    await this.requirePost(organizationId, postId);
    return this._postApprovalsRepository.transition(
      postId,
      organizationId,
      ApprovalState.CHANGES_REQUESTED,
      { userId, comment }
    );
  }

  async resetApproval(organizationId: string, userId: string, postId: string) {
    await this.requirePost(organizationId, postId);
    return this._postApprovalsRepository.transition(
      postId,
      organizationId,
      ApprovalState.NOT_REQUIRED,
      { userId }
    );
  }

  async getApproval(organizationId: string, postId: string) {
    const post = await this.requirePost(organizationId, postId);
    const history = await this._postApprovalsRepository.listApprovals(
      organizationId,
      postId
    );
    return {
      postId: post.id,
      approvalState: post.approvalState,
      approvalToken: post.approvalToken,
      history,
    };
  }

  /** Client (no-login) view behind the shareable approval link. */
  async getLinkPost(token: string) {
    return this.requireLinkPost(token);
  }

  async approveViaLink(token: string, comment?: string) {
    const post = await this.requireLinkPost(token);
    return this._postApprovalsRepository.transition(
      post.id,
      post.organizationId,
      ApprovalState.APPROVED,
      { comment, viaLink: true }
    );
  }

  async requestChangesViaLink(token: string, comment?: string) {
    const post = await this.requireLinkPost(token);
    return this._postApprovalsRepository.transition(
      post.id,
      post.organizationId,
      ApprovalState.CHANGES_REQUESTED,
      { comment, viaLink: true }
    );
  }
}
