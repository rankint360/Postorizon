import { Injectable } from '@nestjs/common';
import { AiKeyProvider } from '@prisma/client';
import OpenAI from 'openai';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AiKeysRepository } from '@gitroom/nestjs-libraries/database/prisma/ai/ai.keys.repository';

/**
 * Postorizon Phase 2 — BYOK AI keys (MVP_SPEC §3.2.7).
 *
 * Keys are stored encrypted with AuthService.fixedEncryption — the exact
 * scheme the codebase already uses for integration custom instance details
 * (AES-256-CBC, key derived from JWT_SECRET) — and are never returned by
 * any API after save; listings expose only provider, a last-4 mask and
 * timestamps.
 */
@Injectable()
export class AiKeysService {
  constructor(private _aiKeysRepository: AiKeysRepository) {}

  async saveKey(
    organizationId: string,
    provider: AiKeyProvider,
    apiKey: string
  ) {
    const row = await this._aiKeysRepository.upsertKey(
      organizationId,
      provider,
      AuthService.fixedEncryption(apiKey)
    );
    return this.mask(row);
  }

  async deleteKey(organizationId: string, provider: AiKeyProvider) {
    await this._aiKeysRepository.deleteKey(organizationId, provider);
    return { deleted: true, provider };
  }

  async listKeys(organizationId: string) {
    const rows = await this._aiKeysRepository.listByOrganization(
      organizationId
    );
    return rows.map((row) => this.mask(row));
  }

  private mask(row: {
    provider: AiKeyProvider;
    encryptedKey: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    let lastFour = '';
    try {
      lastFour = AuthService.fixedDecryption(row.encryptedKey).slice(-4);
    } catch (err) {}
    return {
      provider: row.provider,
      lastFour,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** The decrypted key for one provider, or undefined when not stored. */
  async resolveKey(
    organizationId: string,
    provider: AiKeyProvider
  ): Promise<string | undefined> {
    const row = await this._aiKeysRepository.getByProvider(
      organizationId,
      provider
    );
    if (!row) {
      return undefined;
    }
    try {
      return AuthService.fixedDecryption(row.encryptedKey);
    } catch (err) {
      return undefined;
    }
  }

  /**
   * The org's preferred stored key for generation: the most recently saved
   * or rotated one, so "rotate" also means "use this provider now".
   */
  async resolvePreferredKey(
    organizationId: string
  ): Promise<{ provider: AiKeyProvider; apiKey: string } | undefined> {
    const rows = await this._aiKeysRepository.listByOrganization(
      organizationId
    );
    for (const row of rows) {
      try {
        const apiKey = AuthService.fixedDecryption(row.encryptedKey);
        if (apiKey) {
          return { provider: row.provider, apiKey };
        }
      } catch (err) {}
    }
    return undefined;
  }

  /**
   * An OpenAI-SDK client bound to the org's own key, for the seams that
   * speak the OpenAI API shape (the CopilotKit OpenAIAdapter): the org's
   * OpenAI key first, then OpenRouter (an OpenAI-compatible endpoint).
   * Anthropic keys are not used here — they drive AiChatService through
   * the native Messages API instead. Returns null when the org has no
   * usable key for this seam (callers fall back to the platform key).
   */
  async openAiClientForOrg(
    organizationId: string
  ): Promise<{ client: OpenAI; model: string; provider: AiKeyProvider } | null> {
    const openAiKey = await this.resolveKey(
      organizationId,
      AiKeyProvider.OPENAI
    );
    if (openAiKey) {
      return {
        client: new OpenAI({ apiKey: openAiKey }),
        model: 'gpt-4.1',
        provider: AiKeyProvider.OPENAI,
      };
    }

    const openRouterKey = await this.resolveKey(
      organizationId,
      AiKeyProvider.OPENROUTER
    );
    if (openRouterKey) {
      return {
        client: new OpenAI({
          apiKey: openRouterKey,
          baseURL: 'https://openrouter.ai/api/v1',
        }),
        model: 'openai/gpt-4.1',
        provider: AiKeyProvider.OPENROUTER,
      };
    }

    return null;
  }
}
