import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { PlatformIcon } from '@gitroom/frontend/components/ui/platform.icon.component';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export const metadata: Metadata = {
  title: 'Postorizon — Client report',
  description: '',
};

const stripHtml = (value: string) =>
  String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Postorizon Phase 3 — public (no-login) client report page.
 * The report token in the URL is the credential; data comes from
 * GET /public/reports/:token (published posts in the period +
 * engagement aggregates from persisted snapshots). Read-only.
 * Engagement shows only for posts that have been sampled — the page
 * says so instead of estimating numbers.
 */
export default async function Report(props: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const params = await props.params;
  const { token } = params;
  const searchParams = await props.searchParams;
  const fromParam = searchParams?.from;
  const toParam = searchParams?.to;
  const t = await getT();

  const periodQuery = [
    fromParam ? `from=${encodeURIComponent(fromParam)}` : null,
    toParam ? `to=${encodeURIComponent(toParam)}` : null,
  ]
    .filter(Boolean)
    .join('&');
  const res = await internalFetch(
    `/public/reports/${token}${periodQuery ? `?${periodQuery}` : ''}`
  );
  const report = res.ok ? await res.json() : null;

  if (!report?.customer) {
    return (
      <div className="text-newTextColor fixed start-0 top-0 w-full h-full flex justify-center items-center text-[20px]">
        {t('report_link_not_found', 'Report link not found')}
      </div>
    );
  }

  const branding = report.branding || null;
  const totals = report.totals;

  const activePeriodDays = (() => {
    if (!fromParam && !toParam) {
      return 30;
    }
    if (fromParam && toParam) {
      const diffDays = Math.round(
        (new Date(toParam).getTime() - new Date(fromParam).getTime()) /
          (24 * 3600 * 1000)
      );
      return [7, 30, 90].includes(diffDays) ? diffDays : null;
    }
    return null;
  })();

  const periodPresets: { days: number; label: string; href: string }[] = [
    { days: 7, label: t('report_period_7d', 'Last 7 days') },
    { days: 30, label: t('report_period_30d', 'Last 30 days') },
    { days: 90, label: t('report_period_90d', 'Last 90 days') },
  ].map((preset) => {
    const toIso = new Date().toISOString();
    const fromIso = new Date(
      Date.now() - preset.days * 24 * 3600 * 1000
    ).toISOString();
    return {
      ...preset,
      href: `/report/${token}?from=${fromIso}&to=${toIso}`,
    };
  });

  const totalsCards: { label: string; value: number }[] = [
    { label: t('report_posts_published', 'Posts published'), value: totals.postsPublished },
    { label: t('report_engagement', 'Engagement'), value: totals.engagement },
    { label: t('report_views', 'Views'), value: totals.views },
    { label: t('report_likes', 'Likes'), value: totals.likes },
    { label: t('report_comments', 'Comments'), value: totals.comments },
    { label: t('report_shares', 'Shares'), value: totals.shares },
  ];

  return (
    <div className="mx-auto w-full max-w-[900px] p-[12px] flex flex-col gap-[12px] text-newTextColor">
      <div
        className="flex bg-newBgColorInner rounded-[12px] min-h-[80px] px-[20px] py-[12px] items-center gap-[20px] flex-wrap"
        {...(branding?.accentColor
          ? { style: { borderTop: `4px solid ${branding.accentColor}` } }
          : {})}
      >
        {!!branding?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt={branding.portalName || ''}
            className="h-[40px] max-w-[180px] object-contain"
          />
        )}
        <div className="flex flex-col">
          <div className="text-[20px] font-semibold">
            {report.customer.name}
          </div>
          <div className="text-[13px] opacity-70">
            {branding?.portalName
              ? `${branding.portalName} · `
              : ''}
            {dayjs.utc(report.period.from).format('MMM D, YYYY')} –{' '}
            {dayjs.utc(report.period.to).format('MMM D, YYYY')}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-[8px] flex-wrap px-[4px]">
        {periodPresets.map((preset) => (
          <a
            key={preset.days}
            href={preset.href}
            className={
              preset.days === activePeriodDays
                ? 'text-[13px] font-semibold bg-btnPrimary text-white border border-btnPrimary rounded-[8px] px-[12px] py-[6px]'
                : 'text-[13px] bg-newBgColorInner border border-newBorder rounded-[8px] px-[12px] py-[6px]'
            }
          >
            {preset.label}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-2 minCustom:grid-cols-3 gap-[12px]">
        {totalsCards.map((card) => (
          <div
            key={card.label}
            className="bg-newBgColorInner rounded-[12px] p-[16px] flex flex-col gap-[4px]"
          >
            <div className="text-[24px] font-semibold">
              {card.value.toLocaleString()}
            </div>
            <div className="text-[13px] opacity-70">{card.label}</div>
          </div>
        ))}
      </div>

      {totals.postsSampled < totals.postsPublished && (
        <div className="text-[13px] opacity-70 px-[4px]">
          {t(
            'report_partial_sampling',
            'Engagement is shown for {{sampled}} of {{published}} posts — the rest have not been measured yet.',
            { sampled: totals.postsSampled, published: totals.postsPublished }
          )}
        </div>
      )}

      {!!report.topPosts?.length && (
        <div className="bg-newBgColorInner rounded-[12px] p-[20px] flex flex-col gap-[12px]">
          <div className="text-[16px] font-semibold">
            {t('report_top_posts', 'Top posts')}
          </div>
          {report.topPosts.map((post: any) => (
            <ReportPostRow key={post.id} post={post} t={t} />
          ))}
        </div>
      )}

      <div className="bg-newBgColorInner rounded-[12px] p-[20px] flex flex-col gap-[12px]">
        <div className="text-[16px] font-semibold">
          {t('report_all_posts', 'All posts in this period')}
        </div>
        {!report.posts?.length && (
          <div className="text-[14px] opacity-70">
            {t('report_no_posts', 'No posts were published in this period.')}
          </div>
        )}
        {(report.posts || []).map((post: any) => (
          <ReportPostRow key={post.id} post={post} t={t} />
        ))}
      </div>
    </div>
  );
}

const ReportPostRow = ({ post, t }: { post: any; t: any }) => (
  <div className="flex flex-col gap-[6px] border-b border-newBorder pb-[12px] last:border-b-0 last:pb-0">
    <div className="flex items-center gap-[8px] text-[13px] opacity-80 flex-wrap">
      {post.integration && (
        <>
          <PlatformIcon
            identifier={post.integration.providerIdentifier}
            size={18}
            channel={post.integration.profile || ''}
            iconClassName="w-[18px] h-[18px] bg-newBgColor aspect-square rounded-full"
            markClassName="bg-newBgColorInner"
          />
          <span>{post.integration.name}</span>
        </>
      )}
      <span>
        {dayjs.utc(post.publishDate).format('MMM D, YYYY HH:mm')} UTC
      </span>
      {post.engagement ? (
        <span>
          · {t('report_engagement', 'Engagement')}:{' '}
          {post.engagement.total.toLocaleString()}
          {post.engagement.views !== null &&
            ` · ${t('report_views', 'Views')}: ${post.engagement.views.toLocaleString()}`}
        </span>
      ) : (
        <span>· {t('report_not_measured', 'Not measured yet')}</span>
      )}
      {!!post.releaseURL && (
        <a
          href={post.releaseURL}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {t('report_view_post', 'View post')}
        </a>
      )}
    </div>
    <div className="text-[14px] leading-relaxed">
      {stripHtml(post.content).slice(0, 280)}
    </div>
  </div>
);
