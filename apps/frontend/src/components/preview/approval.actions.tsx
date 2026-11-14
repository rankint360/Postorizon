'use client';

import { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Textarea } from '@gitroom/react/form/textarea';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/**
 * Postorizon Phase 2 — approve / request-changes actions for the public
 * (no-login) client approval page. The approval token in the URL is the
 * credential; the backend only accepts actions while the post is PENDING.
 */
export const ApprovalActions: FC<{
  token: string;
  approvalState: string;
}> = ({ token, approvalState: initialState }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [approvalState, setApprovalState] = useState(initialState);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (action: 'approve' | 'request-changes') => {
      setBusy(true);
      try {
        const res = await fetch(`/public/approvals/${token}/${action}`, {
          method: 'POST',
          body: JSON.stringify({ comment: comment || undefined }),
        });
        const data = await res.json();
        if (!res.ok) {
          toaster.show(
            data?.message ||
              t('approval_action_failed', 'Something went wrong, please try again'),
            'warning'
          );
          return;
        }
        setApprovalState(data.approvalState);
        toaster.show(
          action === 'approve'
            ? t('approval_approved', 'Post approved')
            : t('approval_changes_requested', 'Changes requested'),
          'success'
        );
      } finally {
        setBusy(false);
      }
    },
    [fetch, token, comment, t, toaster]
  );

  if (approvalState !== 'PENDING') {
    return (
      <div className="bg-newBgColorInner rounded-[12px] p-[20px] text-[15px]">
        {approvalState === 'APPROVED'
          ? t('approval_state_approved', 'This post has been approved.')
          : approvalState === 'CHANGES_REQUESTED'
            ? t(
                'approval_state_changes',
                'Changes were requested for this post. The team has been notified.'
              )
            : t('approval_state_closed', 'This approval link is no longer active.')}
      </div>
    );
  }

  return (
    <div className="bg-newBgColorInner rounded-[12px] p-[20px] flex flex-col gap-[12px]">
      <div className="text-[15px] font-medium">
        {t('approval_review_prompt', 'Please review this post')}
      </div>
      <Textarea
        name="comment"
        disableForm
        label={t('approval_comment_label', 'Comment (optional)')}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t(
          'approval_comment_placeholder',
          'Anything the team should know?'
        )}
      />
      <div className="flex gap-[10px]">
        <Button
          onClick={() => act('approve')}
          disabled={busy}
          className="flex-1"
        >
          {t('approval_approve', 'Approve')}
        </Button>
        <Button
          onClick={() => act('request-changes')}
          disabled={busy}
          secondary
          className="flex-1"
        >
          {t('approval_request_changes', 'Request changes')}
        </Button>
      </div>
    </div>
  );
};
