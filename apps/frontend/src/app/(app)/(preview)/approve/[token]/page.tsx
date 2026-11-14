import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { PlatformIcon } from '@gitroom/frontend/components/ui/platform.icon.component';
import { PostContentClient } from '@gitroom/frontend/components/preview/post.content.client';
import { ApprovalActions } from '@gitroom/frontend/components/preview/approval.actions';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export const metadata: Metadata = {
  title: 'Postorizon — Review post',
  description: '',
};

/**
 * Postorizon Phase 2 — public (no-login) client approval page.
 * The token in the URL is the credential; the page renders the post behind
 * GET /public/approvals/:token and the approve / request-changes actions.
 */
export default async function Approve(props: {
  params: Promise<{ token: string }>;
}) {
  const params = await props.params;
  const { token } = params;
  const t = await getT();

  const res = await internalFetch(`/public/approvals/${token}`);
  const post = res.ok ? await res.json() : null;

  if (!post?.id) {
    return (
      <div className="text-newTextColor fixed start-0 top-0 w-full h-full flex justify-center items-center text-[20px]">
        {t('approval_link_not_found', 'Approval link not found')}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[900px] p-[12px] flex flex-col gap-[12px] text-newTextColor">
      <div className="flex bg-newBgColorInner rounded-[12px] min-h-[80px] px-[20px] py-[12px] items-center gap-[20px] flex-wrap">
        <div className="text-[20px] font-semibold">
          {t('approval_page_title', 'Review this post')}
        </div>
        {post.integration && (
          <div className="flex items-center gap-[8px] text-[14px]">
            <PlatformIcon
              identifier={post.integration.providerIdentifier}
              size={24}
              channel={post.integration.profile || ''}
              iconClassName="w-[24px] h-[24px] bg-newBgColor aspect-square rounded-full"
              markClassName="bg-newBgColorInner"
            />
            <span>{post.integration.name}</span>
          </div>
        )}
        <div className="text-[14px] opacity-70">
          {t('publication_date', 'Publication Date:')}{' '}
          {dayjs.utc(post.publishDate).format('MMM D, YYYY HH:mm')} UTC
        </div>
      </div>

      <div className="bg-newBgColorInner rounded-[12px] p-[20px] text-[15px] leading-relaxed">
        <PostContentClient postId={post.id} html={sanitizePostContent(post.content)} />
      </div>

      <ApprovalActions token={token} approvalState={post.approvalState} />
    </div>
  );
}
