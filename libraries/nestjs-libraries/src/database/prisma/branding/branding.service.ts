import { HttpException, Injectable } from '@nestjs/common';
import { BrandingRepository } from '@gitroom/nestjs-libraries/database/prisma/branding/branding.repository';
import { EngagementService } from '@gitroom/nestjs-libraries/database/prisma/engagement/engagement.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

export type PublicBranding = {
  portalName: string | null;
  logoUrl: string | null;
  accentColor: string | null;
};

const ACCENT_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Postorizon Phase 3 — white-label agency v1.
 *
 * (a) Organization branding (logo URL, accent colour, portal display
 * name) stored on OrganizationBranding and applied to client-facing
 * public pages. (b) The public approval endpoint includes the branding
 * of the post's organization (see PublicPostApprovalsController).
 * (c) Public client reports: a per-customer unguessable reportToken
 * (same pattern as Post.approvalToken) opens a read-only report of the
 * client's published posts in a period plus engagement aggregates from
 * the persisted snapshots — posts never sampled simply report
 * engagement as null; nothing is estimated.
 */
@Injectable()
export class BrandingService {
  constructor(
    private _brandingRepository: BrandingRepository,
    private _engagementService: EngagementService
  ) {}

  async getBranding(organizationId: string): Promise<PublicBranding> {
    const row = await this._brandingRepository.getBranding(organizationId);
    return {
      portalName: row?.portalName || null,
      logoUrl: row?.logoUrl || null,
      accentColor: row?.accentColor || null,
    };
  }

  async updateBranding(
    organizationId: string,
    data: {
      logoUrl?: string | null;
      accentColor?: string | null;
      portalName?: string | null;
    }
  ): Promise<PublicBranding> {
    const accentColor = data.accentColor?.trim() || null;
    if (accentColor && !ACCENT_COLOR.test(accentColor)) {
      throw new HttpException(
        'Accent colour must be a hex colour like #FF5A3C',
        400
      );
    }
    const row = await this._brandingRepository.upsertBranding(organizationId, {
      logoUrl: data.logoUrl?.trim() || null,
      accentColor,
      portalName: data.portalName?.trim() || null,
    });
    return {
      portalName: row.portalName,
      logoUrl: row.logoUrl,
      accentColor: row.accentColor,
    };
  }

  private async requireCustomer(organizationId: string, customerId: string) {
    const customer = await this._brandingRepository.getCustomer(
      organizationId,
      customerId
    );
    if (!customer) {
      throw new HttpException('Customer group not found', 404);
    }
    return customer;
  }

  async getReportToken(organizationId: string, customerId: string) {
    const customer = await this.requireCustomer(organizationId, customerId);
    return { token: customer.reportToken };
  }

  /** Create the report token if missing; never rotates implicitly. */
  async ensureReportToken(organizationId: string, customerId: string) {
    const customer = await this.requireCustomer(organizationId, customerId);
    if (customer.reportToken) {
      return { token: customer.reportToken };
    }
    const updated = await this._brandingRepository.setReportToken(
      customerId,
      makeId(32)
    );
    return { token: updated.reportToken };
  }

  async rotateReportToken(organizationId: string, customerId: string) {
    await this.requireCustomer(organizationId, customerId);
    const updated = await this._brandingRepository.setReportToken(
      customerId,
      makeId(32)
    );
    return { token: updated.reportToken };
  }

  /**
   * The public, no-login client report behind a reportToken. Read-only;
   * the response never includes the organization id or any token.
   */
  async getClientReport(token: string, from?: Date, to?: Date) {
    const customer = await this._brandingRepository.getCustomerByReportToken(
      token
    );
    if (!customer) {
      throw new HttpException('Report link not found', 404);
    }
    const periodTo = to && !isNaN(to.getTime()) ? to : new Date();
    const periodFrom =
      from && !isNaN(from.getTime())
        ? from
        : new Date(periodTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [branding, posts, latest] = await Promise.all([
      this.getBranding(customer.orgId),
      this._brandingRepository.listClientPublishedPosts(
        customer.orgId,
        customer.id,
        periodFrom,
        periodTo
      ),
      this._engagementService.latestPerPost(customer.orgId, {
        customerId: customer.id,
      }),
    ]);

    const engagementByPost = new Map(
      latest
        .filter(
          (p) => p.publishDate >= periodFrom && p.publishDate <= periodTo
        )
        .map((p) => [p.postId, p] as const)
    );

    const reportPosts = posts.map((post) => {
      const engagement = engagementByPost.get(post.id);
      return {
        id: post.id,
        content: post.content,
        publishDate: post.publishDate,
        releaseURL: post.releaseURL,
        integration: post.integration,
        engagement: engagement
          ? {
              total: engagement.engagement,
              views: engagement.views,
              likes: engagement.likes,
              comments: engagement.comments,
              shares: engagement.shares,
            }
          : null,
      };
    });

    const sampled = reportPosts.filter((p) => p.engagement !== null);
    const sum = (pick: (e: NonNullable<(typeof reportPosts)[number]['engagement']>) => number | null) =>
      sampled.reduce((total, p) => total + (pick(p.engagement!) ?? 0), 0);

    return {
      customer: { name: customer.name },
      branding,
      period: { from: periodFrom, to: periodTo },
      totals: {
        postsPublished: reportPosts.length,
        postsSampled: sampled.length,
        engagement: sum((e) => e.total),
        views: sum((e) => e.views),
        likes: sum((e) => e.likes),
        comments: sum((e) => e.comments),
        shares: sum((e) => e.shares),
      },
      topPosts: [...sampled]
        .sort((a, b) => (b.engagement?.total || 0) - (a.engagement?.total || 0))
        .slice(0, 5),
      posts: reportPosts,
    };
  }
}
