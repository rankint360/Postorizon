import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import {
  InboxReplyDto,
  UpdateInboxItemStateDto,
} from '@gitroom/nestjs-libraries/dtos/inbox/inbox.dto';
import { RealIP } from 'nestjs-real-ip';

/**
 * Postorizon Phase 2 — unified inbox v1 (MVP_SPEC §3.2.5), API-only.
 * Queue over unresolved post comments + actionable approval requests,
 * with persisted read state / assignment, thread replies via the
 * existing comments service, and BYOK-aware AI suggested replies.
 */
@Controller('/inbox')
export class InboxController {
  constructor(private _inboxService: InboxService) {}

  @Get('/')
  getQueue(
    @GetOrgFromRequest() org: Organization,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('assigneeId') assigneeId?: string
  ) {
    return this._inboxService.getQueue(org.id, {
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
      cursor,
      unreadOnly: unreadOnly === 'true',
      assigneeId,
    });
  }

  @Patch('/:sourceType/:sourceId/state')
  updateState(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
    @Body() body: UpdateInboxItemStateDto
  ) {
    return this._inboxService.updateState(
      org.id,
      user.id,
      sourceType,
      sourceId,
      body
    );
  }

  @Post('/comments/:commentId/reply')
  reply(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('commentId') commentId: string,
    @Body() body: InboxReplyDto,
    @RealIP() ip: string
  ) {
    return this._inboxService.replyToComment(
      org.id,
      user.id,
      commentId,
      body.content,
      ip
    );
  }

  @Post('/comments/:commentId/suggest-reply')
  suggestReply(
    @GetOrgFromRequest() org: Organization,
    @Param('commentId') commentId: string
  ) {
    return this._inboxService.suggestReply(org.id, commentId);
  }
}
