import { Body, Controller, Post } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { WeeklyPlanService } from '@gitroom/nestjs-libraries/database/prisma/agent/weekly.plan.service';
import { WeeklyPlanDto } from '@gitroom/nestjs-libraries/dtos/agent/weekly.plan.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

/**
 * Postorizon Phase 2 — closed-loop agent v1 (MVP_SPEC §3.2.2).
 * Generates one week of draft posts for a customer group and places
 * them in the approval queue (approvalState PENDING). Drafts can only
 * publish after a human approves them.
 */
@Controller('/agent')
export class AgentPlanController {
  constructor(private _weeklyPlanService: WeeklyPlanService) {}

  @Post('/weekly-plan')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  generateWeeklyPlan(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: WeeklyPlanDto
  ) {
    return this._weeklyPlanService.generateWeeklyPlan(org.id, user.id, body);
  }
}
