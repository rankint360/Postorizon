import { HttpException, Injectable } from '@nestjs/common';
import { AiKeyProvider } from '@prisma/client';
import { AiKeysService } from '@gitroom/nestjs-libraries/database/prisma/ai/ai.keys.service';

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/**
 * Postorizon Phase 2 — the BYOK-aware text generation seam.
 *
 * Resolution order for every call: the organization's own key (explicit
 * provider when given, otherwise the most recently saved/rotated one),
 * then the platform OPENAI_API_KEY. Providers are called over plain HTTPS
 * with their native request shapes:
 *  - OpenAI / OpenRouter: Chat Completions API (OpenRouter is
 *    OpenAI-compatible, only the base URL and model slug differ)
 *  - Anthropic: Messages API (system prompt is a top-level field there)
 *
 * Consumers: the closed-loop agent (weekly plan drafts) and inbox AI
 * suggested replies. The CopilotKit chat/agent endpoints use
 * AiKeysService.openAiClientForOrg instead, because they need an
 * OpenAI-SDK-shaped client.
 */
@Injectable()
export class AiChatService {
  constructor(private _aiKeysService: AiKeysService) {}

  async chatCompletion(
    organizationId: string,
    messages: AiChatMessage[],
    options?: { provider?: AiKeyProvider; maxTokens?: number }
  ): Promise<{ text: string; provider: AiKeyProvider | 'PLATFORM' }> {
    const resolved = options?.provider
      ? await this._aiKeysService
          .resolveKey(organizationId, options.provider)
          .then((apiKey) =>
            apiKey ? { provider: options.provider!, apiKey } : undefined
          )
      : await this._aiKeysService.resolvePreferredKey(organizationId);

    if (resolved) {
      const text = await this.callProvider(
        resolved.provider,
        resolved.apiKey,
        messages,
        options?.maxTokens
      );
      return { text, provider: resolved.provider };
    }

    if (process.env.OPENAI_API_KEY) {
      const text = await this.callProvider(
        AiKeyProvider.OPENAI,
        process.env.OPENAI_API_KEY,
        messages,
        options?.maxTokens
      );
      return { text, provider: 'PLATFORM' };
    }

    throw new HttpException(
      'No AI provider key available: add your own key in Settings or ask the workspace admin to configure one',
      400
    );
  }

  private async callProvider(
    provider: AiKeyProvider,
    apiKey: string,
    messages: AiChatMessage[],
    maxTokens = 2048
  ): Promise<string> {
    if (provider === AiKeyProvider.ANTHROPIC) {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          // current Claude Sonnet slug on the Messages API
          model: 'claude-sonnet-4-5',
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new HttpException(
          `Anthropic request failed (${response.status}): ${
            body?.error?.message || 'unknown error'
          }`,
          502
        );
      }
      return (body?.content || [])
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => b.text)
        .join('');
    }

    const isOpenRouter = provider === AiKeyProvider.OPENROUTER;
    const response = await fetch(
      isOpenRouter
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: isOpenRouter ? 'openai/gpt-4.1' : 'gpt-4.1',
          max_tokens: maxTokens,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      }
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new HttpException(
        `${isOpenRouter ? 'OpenRouter' : 'OpenAI'} request failed (${
          response.status
        }): ${body?.error?.message || 'unknown error'}`,
        502
      );
    }
    return body?.choices?.[0]?.message?.content || '';
  }
}
