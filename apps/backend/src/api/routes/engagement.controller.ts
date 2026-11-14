import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { EngagementService } from '@gitroom/nestjs-libraries/database/prisma/engagement/engagement.service';
import { SampleEngagementDto } from '@gitroom/nestjs-libraries/dtos/engagement/sample.engagement.dto';

/**
 * Postorizon Phase 3 — engagement persistence API.
 *
 * POST /engagement/sample is the sampling trigger (the service docblock
 * in EngagementService explains why there is no recurring schedule yet).
 * The read endpoints serve the persisted snapshots plus the aggregates
 * built on them: best-time slots (MVP_SPEC §3.2.6) and rule-based
 * recommendations ("what to post next"). All org-scoped via the
 * authenticated middleware, like every controller in this list.
 */
@ApiTags('Engagement')
@Controller('/engagement')
export class EngagementController {
  constructor(private _engagementService: EngagementService) {}

  @Post('/sample')
  sample(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SampleEngagementDto
  ) {
    return this._engagementService.sampleOrganization(org.id, {
      days: body?.days,
      limit: body?.limit,
    });
  }

  @Get('/posts/:postId')
  postSnapshots(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string
  ) {
    return this._engagementService.getPostSnapshots(org.id, postId);
  }

  @Get('/integrations/:integrationId')
  integrationSnapshots(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Query('limit') limit?: string
  ) {
    return this._engagementService.getIntegrationSnapshots(
      org.id,
      integrationId,
      limit ? parseInt(limit, 10) || undefined : undefined
    );
  }

  @Get('/best-times')
  bestTimes(
    @GetOrgFromRequest() org: Organization,
    @Query('integrationId') integrationId?: string,
    @Query('tzOffset') tzOffset?: string
  ) {
    return this._engagementService.getBestTimes(org.id, {
      integrationId: integrationId || undefined,
      utcOffsetMinutes: tzOffset ? parseInt(tzOffset, 10) || 0 : 0,
    });
  }

  @Get('/recommendations')
  recommendations(
    @GetOrgFromRequest() org: Organization,
    @Query('tzOffset') tzOffset?: string
  ) {
    return this._engagementService.getRecommendations(
      org.id,
      tzOffset ? parseInt(tzOffset, 10) || 0 : 0
    );
  }
}
