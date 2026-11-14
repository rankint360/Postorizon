import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

/**
 * Postorizon Phase 3 — white-label agency v1 persistence.
 * Branding is one row per organization (OrganizationBranding). The
 * client-report token lives on Customer (reportToken), mirroring the
 * Post.approvalToken pattern from Phase 1/2.
 */
@Injectable()
export class BrandingRepository {
  constructor(
    private _branding: PrismaRepository<'organizationBranding'>,
    private _customer: PrismaRepository<'customer'>,
    private _post: PrismaRepository<'post'>
  ) {}

  getBranding(organizationId: string) {
    return this._branding.model.organizationBranding.findUnique({
      where: { organizationId },
    });
  }

  upsertBranding(
    organizationId: string,
    data: {
      logoUrl: string | null;
      accentColor: string | null;
      portalName: string | null;
    }
  ) {
    return this._branding.model.organizationBranding.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: { ...data },
    });
  }

  getCustomer(organizationId: string, customerId: string) {
    return this._customer.model.customer.findFirst({
      where: { id: customerId, orgId: organizationId, deletedAt: null },
      select: { id: true, name: true, reportToken: true },
    });
  }

  getCustomerByReportToken(token: string) {
    return this._customer.model.customer.findFirst({
      where: { reportToken: token, deletedAt: null },
      select: { id: true, name: true, orgId: true },
    });
  }

  setReportToken(customerId: string, token: string) {
    return this._customer.model.customer.update({
      where: { id: customerId },
      data: { reportToken: token },
      select: { id: true, reportToken: true },
    });
  }

  /** Published posts of one client (via its channels) inside a period. */
  listClientPublishedPosts(
    organizationId: string,
    customerId: string,
    from: Date,
    to: Date,
    take = 100
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId,
        state: 'PUBLISHED',
        deletedAt: null,
        publishDate: { gte: from, lte: to },
        integration: { customerId },
      },
      orderBy: { publishDate: 'desc' },
      take,
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            profile: true,
          },
        },
      },
    });
  }
}
