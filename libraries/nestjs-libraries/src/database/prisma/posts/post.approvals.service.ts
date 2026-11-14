import { HttpException, Injectable } from '@nestjs/common';
import { PostApprovalsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/post.approvals.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { ApprovalState, State } from '@prisma/client';

/**
 * Postorizon Phase 1 — native approval workflow (MVP_SPEC §3.2.1 core).
 * Postorizon Phase 2 — publish-path gating completed:
 *
 * Flow: a team member requests approval for a draft/queued post, which puts
 * it in PENDING and issues a shareable approval token. Approvers — either
 * logged-in org members or a client opening the shareable link (no login) —
 * approve or request changes, optionally leaving a comment. Every transition
 * is written to the PostApproval audit trail.
 *
 * Gating: PostsService.startWorkflow refuses to schedule a PENDING /
 * CHANGES_REQUESTED post (and terminates any workflow already running), this
 * service terminates the running workflow when approval is requested, and
 * restarts scheduling when a QUEUE post becomes APPROVED — so an unapproved
 * post can neither be scheduled nor fire.
 */
@Injectable()
export class PostApprovalsService {
  constructor(
    private _postApprovalsRepository: PostApprovalsRepository,
    private _postsService: PostsService
  ) {}

  /** After an approval, a queued post may (re)enter the publish pipeline. */
  private restartSchedulingIfQueued(
    post: {
      id: string;
      state: State;
      organizationId: string;
      integration?: { providerIdentifier: string } | null;
    }
  ) {
    if (post.state !== State.QUEUE || !post.integration) {
      return;
    }
    this._postsService
      .startWorkflow(
        post.integration.providerIdentifier.split('-')[0].toLowerCase(),
        post.id,
        post.organizationId,
        State.QUEUE
      )
      .catch(() => {});
  }

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
    const token = post.approvalToken || makeSecureId(32);
    const updated = await this._postApprovalsRepository.transition(
      postId,
      organizationId,
      ApprovalState.PENDING,
      { userId, comment },
      token
    );
    // a workflow started before this request must not fire while pending
    this._postsService.terminatePostWorkflows(postId).catch(() => {});
    return updated;
  }

  async approve(
    organizationId: string,
    userId: string,
    postId: string,
    comment?: string
  ) {
    const post = await this.requirePost(organizationId, postId);
    const updated = await this._postApprovalsRepository.transition(
      postId,
      organizationId,
      ApprovalState.APPROVED,
      { userId, comment }
    );
    this.restartSchedulingIfQueued(post);
    return updated;
  }

  async requestChanges(
    organizationId: string,
    userId: string,
    postId: string,
    comment?: string
  ) {
    await this.requirePost(organizationId, postId);
    const updated = await this._postApprovalsRepository.transition(
      postId,
      organizationId,
      ApprovalState.CHANGES_REQUESTED,
      { userId, comment }
    );
    this._postsService.terminatePostWorkflows(postId).catch(() => {});
    return updated;
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

  private async requirePendingLinkPost(token: string) {
    const post = await this.requireLinkPost(token);
    if (post.approvalState !== ApprovalState.PENDING) {
      throw new HttpException(
        'This post is not waiting for approval anymore',
        400
      );
    }
    return post;
  }

  async approveViaLink(token: string, comment?: string) {
    const post = await this.requirePendingLinkPost(token);
    const updated = await this._postApprovalsRepository.transition(
      post.id,
      post.organizationId,
      ApprovalState.APPROVED,
      { comment, viaLink: true }
    );
    this.restartSchedulingIfQueued(post);
    return updated;
  }

  async requestChangesViaLink(token: string, comment?: string) {
    const post = await this.requirePendingLinkPost(token);
    const updated = await this._postApprovalsRepository.transition(
      post.id,
      post.organizationId,
      ApprovalState.CHANGES_REQUESTED,
      { comment, viaLink: true }
    );
    // nothing may fire while changes are outstanding
    this._postsService.terminatePostWorkflows(post.id).catch(() => {});
    return updated;
  }
}
