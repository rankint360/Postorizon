import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PostApprovalsService } from '@gitroom/nestjs-libraries/database/prisma/posts/post.approvals.service';
import { BrandingService } from '@gitroom/nestjs-libraries/database/prisma/branding/branding.service';
import { PostApprovalActionDto } from '@gitroom/nestjs-libraries/dtos/posts/post.approval.dto';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';

/**
 * Postorizon Phase 2 — public (no-login) client approval link endpoints.
 *
 * The unguessable per-post approvalToken is the credential: whoever holds
 * the link can view the post and approve it or request changes while it is
 * PENDING. Every action lands in the PostApproval audit trail with
 * viaLink = true (see PostApprovalsService). Registered outside the
 * authenticated controller list in ApiModule, like
 * NoAuthIntegrationsController, so AuthMiddleware never runs for it.
 */
@ApiTags('Post Approvals (public link)')
@Controller('/public/approvals')
@UseGuards(ThrottlerRealIpGuard)
@Throttle({ default: { limit: 60, ttl: 3600000 } })
export class PublicPostApprovalsController {
  constructor(
    private _postApprovalsService: PostApprovalsService,
    private _brandingService: BrandingService
  ) {}

  @Get('/:token')
  async getLinkPost(@Param('token') token: string) {
    const post = await this._postApprovalsService.getLinkPost(token);
    // Phase 3 white-label: the branding of the post's organization
    // (safe display fields only — never the org id itself).
    const branding = await this._brandingService.getBranding(
      post.organizationId
    );
    // only the fields the client approval page renders — never the org id
    // or anything beyond the post itself
    return {
      id: post.id,
      content: post.content,
      state: post.state,
      publishDate: post.publishDate,
      approvalState: post.approvalState,
      branding,
      integration: post.integration
        ? {
            name: post.integration.name,
            providerIdentifier: post.integration.providerIdentifier,
            picture: post.integration.picture,
            profile: post.integration.profile,
          }
        : null,
    };
  }

  @Post('/:token/approve')
  async approve(
    @Param('token') token: string,
    @Body() body: PostApprovalActionDto
  ) {
    const updated = await this._postApprovalsService.approveViaLink(
      token,
      body?.comment
    );
    return { id: updated.id, approvalState: updated.approvalState };
  }

  @Post('/:token/request-changes')
  async requestChanges(
    @Param('token') token: string,
    @Body() body: PostApprovalActionDto
  ) {
    const updated = await this._postApprovalsService.requestChangesViaLink(
      token,
      body?.comment
    );
    return { id: updated.id, approvalState: updated.approvalState };
  }
}
