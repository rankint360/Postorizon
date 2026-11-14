import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

/**
 * Postorizon Phase 2 — brand-voice memory persistence (MVP_SPEC §3.2.7).
 * One profile per customer group.
 */
@Injectable()
export class BrandVoiceRepository {
  constructor(
    private _brandVoice: PrismaRepository<'brandVoiceProfile'>,
    private _customer: PrismaRepository<'customer'>
  ) {}

  getCustomer(organizationId: string, customerId: string) {
    return this._customer.model.customer.findFirst({
      where: { id: customerId, orgId: organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  getByCustomer(customerId: string) {
    return this._brandVoice.model.brandVoiceProfile.findUnique({
      where: { customerId },
    });
  }

  upsert(
    organizationId: string,
    customerId: string,
    data: {
      toneNotes?: string | null;
      bannedTopics?: string[];
      examplePostIds?: string[];
    }
  ) {
    return this._brandVoice.model.brandVoiceProfile.upsert({
      where: { customerId },
      create: {
        organizationId,
        customerId,
        toneNotes: data.toneNotes,
        bannedTopics: data.bannedTopics || [],
        examplePostIds: data.examplePostIds || [],
      },
      update: {
        ...(data.toneNotes !== undefined
          ? { toneNotes: data.toneNotes }
          : {}),
        ...(data.bannedTopics !== undefined
          ? { bannedTopics: data.bannedTopics }
          : {}),
        ...(data.examplePostIds !== undefined
          ? { examplePostIds: data.examplePostIds }
          : {}),
      },
    });
  }
}
