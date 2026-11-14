import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { PostApprovalsService } from '@gitroom/nestjs-libraries/database/prisma/posts/post.approvals.service';
import { PostApprovalActionDto } from '@gitroom/nestjs-libraries/dtos/posts/post.approval.dto';

/**
 * Postorizon Phase 1 — approval workflow endpoints (org-authenticated).
 *
 * The client-facing shareable-link endpoints are backed by
 * PostApprovalsService.getLinkPost / approveViaLink / requestChangesViaLink;
 * binding them to a no-auth controller (plus the matching auth-middleware
 * exclusion) is tracked in PHASE1_REPORT.md.
 */
@ApiTags('Post Approvals')
@Controller('/posts')
export class PostApprovalsController {
  constructor(private _postApprovalsService: PostApprovalsService) {}

  @Get('/:id/approvals')
  async getApproval(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postApprovalsService.getApproval(org.id, id);
  }

  @Post('/:id/approvals/request')
  async requestApproval(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: PostApprovalActionDto
  ) {
    return this._postApprovalsService.requestApproval(
      org.id,
      user.id,
      id,
      body?.comment
    );
  }

  @Post('/:id/approvals/approve')
  async approve(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: PostApprovalActionDto
  ) {
    return this._postApprovalsService.approve(org.id, user.id, id, body?.comment);
  }

  @Post('/:id/approvals/request-changes')
  async requestChanges(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: PostApprovalActionDto
  ) {
    return this._postApprovalsService.requestChanges(
      org.id,
      user.id,
      id,
      body?.comment
    );
  }

  @Post('/:id/approvals/reset')
  async reset(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    return this._postApprovalsService.resetApproval(org.id, user.id, id);
  }
}
