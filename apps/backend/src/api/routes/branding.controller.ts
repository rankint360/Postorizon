import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { BrandingService } from '@gitroom/nestjs-libraries/database/prisma/branding/branding.service';
import { BrandingDto } from '@gitroom/nestjs-libraries/dtos/settings/branding.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

/**
 * Postorizon Phase 3 — white-label agency v1 settings: organization
 * branding (applied to the public approval page and client reports)
 * and per-client report-link tokens. Admin-gated like the other
 * organization settings (same policy as /settings/ai-keys).
 */
@ApiTags('Settings')
@Controller('/settings')
export class BrandingController {
  constructor(private _brandingService: BrandingService) {}

  @Get('/branding')
  @CheckPolicies([AuthorizationActions.Read, Sections.ADMIN])
  getBranding(@GetOrgFromRequest() org: Organization) {
    return this._brandingService.getBranding(org.id);
  }

  @Put('/branding')
  @CheckPolicies([AuthorizationActions.Update, Sections.ADMIN])
  updateBranding(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BrandingDto
  ) {
    return this._brandingService.updateBranding(org.id, body);
  }

  @Get('/customers/:customerId/report-token')
  @CheckPolicies([AuthorizationActions.Read, Sections.ADMIN])
  getReportToken(
    @GetOrgFromRequest() org: Organization,
    @Param('customerId') customerId: string
  ) {
    return this._brandingService.getReportToken(org.id, customerId);
  }

  @Post('/customers/:customerId/report-token')
  @CheckPolicies([AuthorizationActions.Update, Sections.ADMIN])
  ensureReportToken(
    @GetOrgFromRequest() org: Organization,
    @Param('customerId') customerId: string
  ) {
    return this._brandingService.ensureReportToken(org.id, customerId);
  }

  @Post('/customers/:customerId/report-token/rotate')
  @CheckPolicies([AuthorizationActions.Update, Sections.ADMIN])
  rotateReportToken(
    @GetOrgFromRequest() org: Organization,
    @Param('customerId') customerId: string
  ) {
    return this._brandingService.rotateReportToken(org.id, customerId);
  }
}
