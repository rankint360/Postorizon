'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Textarea } from '@gitroom/react/form/textarea';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';

type ApprovalData = {
  postId: string;
  approvalState: string;
  approvalToken: string | null;
  history: Array<{
    id: string;
    state: string;
    comment?: string | null;
    viaLink: boolean;
    createdAt: string;
  }>;
};

const stateLabel = (t: ReturnType<typeof useT>, state: string) => {
  switch (state) {
    case 'PENDING':
      return t('approval_pending', 'Pending approval');
    case 'APPROVED':
      return t('approval_approved_state', 'Approved');
    case 'CHANGES_REQUESTED':
      return t('approval_changes_state', 'Changes requested');
    default:
      return t('approval_not_required', 'No approval requested');
  }
};

/**
 * Postorizon Phase 2 — approval panel for a calendar post: current state,
 * the shareable client link, request / approve / request-changes / reset
 * actions and the audit history. Backed by PostApprovalsController.
 */
export const ApprovalModal: FC<{
  postId: string;
  onSuccess?: () => void;
}> = ({ postId, onSuccess }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [data, setData] = useState<ApprovalData | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/posts/${postId}/approvals`);
    if (res.ok) {
      setData(await res.json());
    }
  }, [fetch, postId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (action: 'request' | 'approve' | 'request-changes' | 'reset') => {
      setBusy(true);
      try {
        const res = await fetch(`/posts/${postId}/approvals/${action}`, {
          method: 'POST',
          body: JSON.stringify({ comment: comment || undefined }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          toaster.show(
            err?.message || t('approval_action_failed', 'Action failed'),
            'warning'
          );
          return;
        }
        setComment('');
        await load();
        onSuccess?.();
      } finally {
        setBusy(false);
      }
    },
    [fetch, postId, comment, load, onSuccess, t, toaster]
  );

  const copyLink = useCallback(async () => {
    if (!data?.approvalToken) {
      return;
    }
    await navigator.clipboard.writeText(
      `${window.location.origin}/approve/${data.approvalToken}`
    );
    toaster.show(t('approval_link_copied', 'Approval link copied'), 'success');
  }, [data, t, toaster]);

  if (!data) {
    return <div className="p-[20px]">{t('loading', 'Loading...')}</div>;
  }

  return (
    <div className="p-[20px] flex flex-col gap-[16px]">
      <div className="flex items-center gap-[10px]">
        <div className="text-[15px] font-medium">
          {t('approval_status', 'Status')}:
        </div>
        <div className="text-[15px]">{stateLabel(t, data.approvalState)}</div>
      </div>

      {data.approvalToken && (
        <div className="flex items-center gap-[10px]">
          <div className="flex-1 truncate text-[13px] bg-newBgColorInner rounded-[6px] px-[10px] py-[8px]">
            {`${typeof window !== 'undefined' ? window.location.origin : ''}/approve/${data.approvalToken}`}
          </div>
          <Button onClick={copyLink}>{t('copy_link', 'Copy link')}</Button>
        </div>
      )}

      <Textarea
        name="approval-comment"
        disableForm
        label={t('approval_comment_label', 'Comment (optional)')}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />

      <div className="flex flex-wrap gap-[10px]">
        {data.approvalState !== 'PENDING' && (
          <Button onClick={() => act('request')} disabled={busy}>
            {t('approval_request', 'Request approval')}
          </Button>
        )}
        {data.approvalState === 'PENDING' && (
          <>
            <Button onClick={() => act('approve')} disabled={busy}>
              {t('approval_approve', 'Approve')}
            </Button>
            <Button onClick={() => act('request-changes')} disabled={busy} secondary>
              {t('approval_request_changes', 'Request changes')}
            </Button>
          </>
        )}
        {data.approvalState !== 'NOT_REQUIRED' && (
          <Button onClick={() => act('reset')} disabled={busy} secondary>
            {t('approval_reset', 'Reset approval')}
          </Button>
        )}
      </div>

      {!!data.history.length && (
        <div className="flex flex-col gap-[8px]">
          <div className="text-[14px] font-medium">
            {t('approval_history', 'History')}
          </div>
          {data.history.map((h) => (
            <div
              key={h.id}
              className="text-[13px] bg-newBgColorInner rounded-[6px] px-[10px] py-[8px] flex flex-col gap-[2px]"
            >
              <div>
                {stateLabel(t, h.state)} ·{' '}
                {dayjs(h.createdAt).format('MMM D, YYYY HH:mm')}
                {h.viaLink
                  ? ` · ${t('approval_via_link', 'via client link')}`
                  : ''}
              </div>
              {h.comment && <div className="opacity-80">{h.comment}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
