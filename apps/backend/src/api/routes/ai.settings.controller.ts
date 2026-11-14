import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Put,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { AiKeyProvider, Organization } from '@prisma/client';
import { AiKeysService } from '@gitroom/nestjs-libraries/database/prisma/ai/ai.keys.service';
import { BrandVoiceService } from '@gitroom/nestjs-libraries/database/prisma/ai/brand.voice.service';
import { SaveAiKeyDto } from '@gitroom/nestjs-libraries/dtos/settings/ai.key.dto';
import { BrandVoiceDto } from '@gitroom/nestjs-libraries/dtos/settings/brand.voice.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

/**
 * Postorizon Phase 2 — BYOK AI keys + brand-voice memory settings
 * (MVP_SPEC §3.2.7). Keys are write-only over this API: responses carry
 * provider + last-4 mask + timestamps, never the key itself.
 */
@Controller('/settings')
export class AiSettingsController {
  constructor(
    private _aiKeysService: AiKeysService,
    private _brandVoiceService: BrandVoiceService
  ) {}

  @Get('/ai-keys')
  @CheckPolicies([AuthorizationActions.Update, Sections.ADMIN])
  listAiKeys(@GetOrgFromRequest() org: Organization) {
    return this._aiKeysService.listKeys(org.id);
  }

  @Put('/ai-keys')
  @CheckPolicies([AuthorizationActions.Update, Sections.ADMIN])
  saveAiKey(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveAiKeyDto
  ) {
    return this._aiKeysService.saveKey(org.id, body.provider, body.apiKey);
  }

  @Delete('/ai-keys/:provider')
  @CheckPolicies([AuthorizationActions.Update, Sections.ADMIN])
  deleteAiKey(
    @GetOrgFromRequest() org: Organization,
    @Param('provider') provider: string
  ) {
    if (
      !Object.values(AiKeyProvider).includes(provider as AiKeyProvider)
    ) {
      throw new HttpException('Unknown AI provider', 400);
    }
    return this._aiKeysService.deleteKey(
      org.id,
      provider as AiKeyProvider
    );
  }

  @Get('/brand-voice/:customerId')
  @CheckPolicies([AuthorizationActions.Read, Sections.ADMIN])
  getBrandVoice(
    @GetOrgFromRequest() org: Organization,
    @Param('customerId') customerId: string
  ) {
    return this._brandVoiceService.getProfile(org.id, customerId);
  }

  @Put('/brand-voice/:customerId')
  @CheckPolicies([AuthorizationActions.Update, Sections.ADMIN])
  saveBrandVoice(
    @GetOrgFromRequest() org: Organization,
    @Param('customerId') customerId: string,
    @Body() body: BrandVoiceDto
  ) {
    return this._brandVoiceService.upsertProfile(org.id, customerId, body);
  }
}
