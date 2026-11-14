import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { PlatformAdminService } from '@gitroom/nestjs-libraries/database/prisma/platform-admin/platform-admin.service';
import { PlatformAdminGuard } from '@gitroom/backend/services/auth/platform.admin.guard';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';

/**
 * Postorizon Phase 6 — platform admin console API.
 *
 * Distinct from the upstream AdminController (also @Controller('/admin'),
 * gated on isSuperAdmin, serving /errors + /stats): these routes are
 * gated on the Phase 6 `isPlatformAdmin` flag by PlatformAdminGuard and
 * cover users, organizations, integrations, system status and the
 * admin audit log. Route paths were chosen to not collide with the
 * upstream controller's /errors, /errors/platforms and /stats.
 *
 * No response from this controller ever contains a credential value:
 * user selects exclude password/tokens, and provider configuration is
 * reported as set/unset booleans only.
 */
@ApiTags('Platform Admin')
@Controller('/admin')
@UseGuards(PlatformAdminGuard)
export class PlatformAdminController {
  constructor(
    private _platformAdminService: PlatformAdminService,
    private _authService: AuthService
  ) {}

  // ------------------------------------------------------------ overview

  @Get('/overview')
  async overview() {
    return this._platformAdminService.getOverview();
  }

  @Get('/audit-log')
  async auditLog(
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this._platformAdminService.listAuditEntries({
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  // --------------------------------------------------------------- users

  @Get('/users')
  async listUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string
  ) {
    return this._platformAdminService.listUsers({
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || undefined,
    });
  }

  @Get('/users/:id')
  async getUser(@Param('id') id: string) {
    return this._platformAdminService.getUserDetail(id);
  }

  @Post('/users/:id/suspend')
  async suspendUser(@GetUserFromRequest() admin: User, @Param('id') id: string) {
    return this._platformAdminService.suspendUser(admin, id);
  }

  @Post('/users/:id/reactivate')
  async reactivateUser(
    @GetUserFromRequest() admin: User,
    @Param('id') id: string
  ) {
    return this._platformAdminService.reactivateUser(admin, id);
  }

  @Post('/users/:id/force-sign-out')
  async forceSignOutUser(
    @GetUserFromRequest() admin: User,
    @Param('id') id: string
  ) {
    return this._platformAdminService.forceSignOutUser(admin, id);
  }

  @Post('/users/:id/grant-admin')
  async grantAdmin(@GetUserFromRequest() admin: User, @Param('id') id: string) {
    return this._platformAdminService.grantAdmin(admin, id);
  }

  @Post('/users/:id/revoke-admin')
  async revokeAdmin(
    @GetUserFromRequest() admin: User,
    @Param('id') id: string
  ) {
    return this._platformAdminService.revokeAdmin(admin, id);
  }

  @Post('/users/:id/resend-activation')
  async resendActivation(
    @GetUserFromRequest() admin: User,
    @Param('id') id: string
  ) {
    const target = await this._platformAdminService.getUserDetail(id);
    if (target.activated) {
      throw new HttpException('Account is already activated', 400);
    }
    try {
      // The existing AuthService flow (same one behind
      // POST /auth/resend-activation) — mints the one-shot token and
      // sends through the configured email provider.
      await this._authService.resendActivationEmail(target.email);
    } catch (e) {
      throw new HttpException(
        e instanceof Error ? e.message : 'Failed to resend activation email',
        400
      );
    }
    return this._platformAdminService.recordResendActivation(admin, id);
  }

  // -------------------------------------------------------- organizations

  @Get('/organizations')
  async listOrganizations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string
  ) {
    return this._platformAdminService.listOrganizations({
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || undefined,
    });
  }

  @Get('/organizations/:id')
  async getOrganization(@Param('id') id: string) {
    return this._platformAdminService.getOrganizationDetail(id);
  }

  @Post('/organizations/:id/suspend')
  async suspendOrganization(
    @GetUserFromRequest() admin: User,
    @Param('id') id: string
  ) {
    return this._platformAdminService.suspendOrganization(admin, id);
  }

  @Post('/organizations/:id/reactivate')
  async reactivateOrganization(
    @GetUserFromRequest() admin: User,
    @Param('id') id: string
  ) {
    return this._platformAdminService.reactivateOrganization(admin, id);
  }

  @Post('/organizations/:id/tier')
  async overrideTier(
    @GetUserFromRequest() admin: User,
    @Param('id') id: string,
    @Body() body: { tier: string }
  ) {
    return this._platformAdminService.overrideTier(admin, id, body?.tier);
  }

  // --------------------------------------------------------- integrations

  @Get('/integrations')
  async integrations() {
    return this._platformAdminService.getIntegrationsRollup();
  }

  // --------------------------------------------------------------- system

  @Get('/system')
  async system() {
    return this._platformAdminService.getSystemStatus();
  }
}
