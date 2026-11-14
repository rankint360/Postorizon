import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BrandingService } from '@gitroom/nestjs-libraries/database/prisma/branding/branding.service';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';

/**
 * Postorizon Phase 3 — public (no-login) client report link.
 *
 * The per-customer reportToken is the credential, exactly like the
 * approval link: whoever holds it sees that client's published posts
 * for a period plus engagement aggregates from persisted snapshots.
 * Read-only — there are no mutating endpoints here. Registered outside
 * the authenticated controller list in ApiModule, like
 * PublicPostApprovalsController, so AuthMiddleware never runs for it.
 */
@ApiTags('Client Reports (public link)')
@Controller('/public/reports')
@UseGuards(ThrottlerRealIpGuard)
@Throttle({ default: { limit: 60, ttl: 3600000 } })
export class PublicClientReportController {
  constructor(private _brandingService: BrandingService) {}

  @Get('/:token')
  getReport(
    @Param('token') token: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this._brandingService.getClientReport(
      token,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined
    );
  }
}
