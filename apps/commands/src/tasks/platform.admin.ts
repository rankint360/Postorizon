import { Command, Positional } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { PlatformAdminService } from '@gitroom/nestjs-libraries/database/prisma/platform-admin/platform-admin.service';

/**
 * Postorizon Phase 6 — platform admin bootstrap.
 *
 * The /admin console requires an isPlatformAdmin user, and the flag
 * can only be granted from outside the API (chicken-and-egg), so the
 * first admin is created from the shell:
 *
 *   node ./dist/apps/command/src/main.js admin:grant you@example.com
 *
 * Revoke applies the same last-admin safeguard as the API: the final
 * active platform admin cannot be demoted through any path.
 */
@Injectable()
export class AdminGrant {
  constructor(private _platformAdminService: PlatformAdminService) {}

  @Command({
    command: 'admin:grant <email>',
    describe:
      'Grant platform admin (Phase 6 /admin console) to the user with this email',
  })
  async grant(
    @Positional({
      name: 'email',
      describe: 'Email of the local account to promote',
      type: 'string',
    })
    email: string
  ) {
    const result = await this._platformAdminService.grantAdminByEmail(email);
    console.log(
      result.changed
        ? `Platform admin granted to ${result.email} (${result.id})`
        : `${result.email} (${result.id}) is already a platform admin`
    );
    return true;
  }
}

@Injectable()
export class AdminRevoke {
  constructor(private _platformAdminService: PlatformAdminService) {}

  @Command({
    command: 'admin:revoke <email>',
    describe:
      'Revoke platform admin from the user with this email (last-admin safeguard applies)',
  })
  async revoke(
    @Positional({
      name: 'email',
      describe: 'Email of the local account to demote',
      type: 'string',
    })
    email: string
  ) {
    const result = await this._platformAdminService.revokeAdminByEmail(email);
    console.log(
      result.changed
        ? `Platform admin revoked from ${result.email} (${result.id})`
        : `${result.email} (${result.id}) is not a platform admin`
    );
    return true;
  }
}
