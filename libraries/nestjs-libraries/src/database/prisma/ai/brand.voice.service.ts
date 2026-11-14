import { HttpException, Injectable } from '@nestjs/common';
import { BrandVoiceRepository } from '@gitroom/nestjs-libraries/database/prisma/ai/brand.voice.repository';

export type BrandVoiceData = {
  toneNotes?: string | null;
  bannedTopics?: string[];
  examplePostIds?: string[];
};

/**
 * Postorizon Phase 2 — brand-voice memory (MVP_SPEC §3.2.7).
 *
 * A per-customer-group voice profile: free-text tone notes, a banned-topic
 * list (hard guardrail for the closed-loop agent) and example post ids that
 * represent the brand's voice. The profile also renders into a prompt
 * fragment (voicePromptFragment) so generation paths can carry the voice
 * without knowing the storage shape.
 */
@Injectable()
export class BrandVoiceService {
  constructor(private _brandVoiceRepository: BrandVoiceRepository) {}

  private async requireCustomer(organizationId: string, customerId: string) {
    const customer = await this._brandVoiceRepository.getCustomer(
      organizationId,
      customerId
    );
    if (!customer) {
      throw new HttpException('Customer group not found', 404);
    }
    return customer;
  }

  async getProfile(organizationId: string, customerId: string) {
    await this.requireCustomer(organizationId, customerId);
    const profile = await this._brandVoiceRepository.getByCustomer(customerId);
    return (
      profile || {
        customerId,
        toneNotes: null,
        bannedTopics: [],
        examplePostIds: [],
      }
    );
  }

  async upsertProfile(
    organizationId: string,
    customerId: string,
    data: BrandVoiceData
  ) {
    await this.requireCustomer(organizationId, customerId);
    return this._brandVoiceRepository.upsert(organizationId, customerId, {
      toneNotes: data.toneNotes,
      bannedTopics: data.bannedTopics?.map((t) => t.trim()).filter(Boolean),
      examplePostIds: data.examplePostIds,
    });
  }

  /**
   * Render the profile as instructions for an AI prompt. Returns an empty
   * string when there is nothing worth telling the model.
   */
  voicePromptFragment(profile: {
    toneNotes?: string | null;
    bannedTopics?: string[];
  }): string {
    const parts: string[] = [];
    if (profile.toneNotes?.trim()) {
      parts.push(`Brand voice: ${profile.toneNotes.trim()}`);
    }
    if (profile.bannedTopics?.length) {
      parts.push(
        `Never write about these banned topics: ${profile.bannedTopics.join(', ')}.`
      );
    }
    return parts.join('\n');
  }

  /**
   * Hard guardrail used by the closed-loop agent: true when the text
   * mentions a banned topic (case-insensitive substring match — blunt on
   * purpose, a draft that trips it is dropped, never published).
   */
  violatesBannedTopics(
    text: string,
    profile: { bannedTopics?: string[] }
  ): boolean {
    const lower = text.toLowerCase();
    return (profile.bannedTopics || []).some((topic) =>
      lower.includes(topic.toLowerCase())
    );
  }
}
