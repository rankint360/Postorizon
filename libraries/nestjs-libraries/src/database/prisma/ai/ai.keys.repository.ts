import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AiKeyProvider } from '@prisma/client';

/**
 * Postorizon Phase 2 — BYOK AI key persistence (MVP_SPEC §3.2.7).
 * Only encrypted key material ever touches this layer.
 */
@Injectable()
export class AiKeysRepository {
  constructor(private _aiKey: PrismaRepository<'organizationAiKey'>) {}

  listByOrganization(organizationId: string) {
    return this._aiKey.model.organizationAiKey.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  getByProvider(organizationId: string, provider: AiKeyProvider) {
    return this._aiKey.model.organizationAiKey.findUnique({
      where: {
        organizationId_provider: { organizationId, provider },
      },
    });
  }

  upsertKey(
    organizationId: string,
    provider: AiKeyProvider,
    encryptedKey: string
  ) {
    return this._aiKey.model.organizationAiKey.upsert({
      where: {
        organizationId_provider: { organizationId, provider },
      },
      create: { organizationId, provider, encryptedKey },
      update: { encryptedKey },
    });
  }

  deleteKey(organizationId: string, provider: AiKeyProvider) {
    return this._aiKey.model.organizationAiKey.deleteMany({
      where: { organizationId, provider },
    });
  }
}
