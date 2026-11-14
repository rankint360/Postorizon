import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

@Injectable()
export class EncryptTokens {
  constructor(private _integrationService: IntegrationService) {}
  @Command({
    command: 'integrations:encrypt-tokens',
    describe:
      'Encrypt integration tokens still stored as plaintext (Phase 5 backfill, idempotent)',
  })
  async encryptTokens() {
    const { scanned, updated } =
      await this._integrationService.encryptStoredIntegrationTokens();
    console.log(
      `Scanned ${scanned} integrations, encrypted tokens on ${updated}`
    );
    return true;
  }
}
