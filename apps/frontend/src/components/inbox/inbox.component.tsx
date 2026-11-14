'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { PlatformIcon } from '@gitroom/frontend/components/ui/platform.icon.component';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';

interface InboxIntegration {
  id: string;
  name: string;
  providerIdentifier: string;
  picture: string | null;
}

interface InboxPost {
  id: string;
  content: string;
  state: string;
  approvalState: string;
  publishDate: string;
  integration: InboxIntegration | null;
}

interface InboxItem {
  key: string;
  sourceType: 'comment' | 'approval';
  sourceId: string;
  body: string | null;
  authorName: string | null;
  viaLink: boolean;
  createdAt: string;
  post: InboxPost;
  approvalState?: string;
  read: boolean;
  readAt: string | null;
  assigneeId: string | null;
}

interface InboxResponse {
  items: InboxItem[];
  nextCursor: string | null;
}

type SourceFilter = 'all' | 'comment' | 'approval';

// post.content can contain HTML — strip tags before displaying it as text.
const stripHtml = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const truncate = (value: string, max = 200): string => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
};

// Relative label without relying on a dayjs plugin being registered,
// with the absolute date kept alongside it in the UI.
const relativeLabel = (date: string): string => {
  const then = dayjs(date);
  const diffMinutes = dayjs().diff(then, 'minute');
  if (diffMinutes < 1) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  return then.format('MMM D, YYYY');
};

export const InboxComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const user = useUser();
  // useUser() returns the Prisma User (plus org fields) — its id field is `id`.
  const currentUserId = user?.id;

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (): Promise<InboxResponse> => {
    const params = new URLSearchParams();
    params.set('limit', '30');
    if (unreadOnly) {
      params.set('unreadOnly', 'true');
    }
    const res = await fetch(`/inbox?${params.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to load inbox');
    }
    return res.json();
  }, [fetch, unreadOnly]);

  const { data, error, isLoading, mutate } = useSWR<InboxResponse>(
    `inbox-${unreadOnly ? 'unread' : 'all'}`,
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  );

  const items = useMemo(() => data?.items || [], [data]);

  // The API has no source filter, so All / Comments / Approvals is a
  // client-side filter over the fetched items.
  const filteredItems = useMemo(() => {
    if (sourceFilter === 'all') {
      return items;
    }
    return items.filter((item) => item.sourceType === sourceFilter);
  }, [items, sourceFilter]);

  const loadMore = useCallback(async () => {
    if (!data?.nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '30');
      params.set('cursor', data.nextCursor);
      if (unreadOnly) {
        params.set('unreadOnly', 'true');
      }
      const res = await fetch(`/inbox?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Failed to load more inbox items');
      }
      const next: InboxResponse = await res.json();
      await mutate(
        {
          items: [...items, ...next.items],
          nextCursor: next.nextCursor,
        },
        { revalidate: false }
      );
    } catch {
      toaster.show(
        t('inbox_load_more_failed', 'Could not load more items'),
        'warning'
      );
    } finally {
      setLoadingMore(false);
    }
  }, [data, fetch, items, loadingMore, mutate, t, toaster, unreadOnly]);

  const updateState = useCallback(
    async (item: InboxItem, body: { read?: boolean; assigneeId?: string | null }) => {
      setUpdatingKey(item.key);
      try {
        const res = await fetch(
          `/inbox/${item.sourceType}/${item.sourceId}/state`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          throw new Error('Failed to update inbox item');
        }
        const updated: {
          key: string;
          read: boolean;
          readAt: string | null;
          assigneeId: string | null;
        } = await res.json();
        await mutate(
          {
            items: items.map((existing) =>
              existing.key === updated.key
                ? {
                    ...existing,
                    read: updated.read,
                    readAt: updated.readAt,
                    assigneeId: updated.assigneeId,
                  }
                : existing
            ),
            nextCursor: data?.nextCursor ?? null,
          },
          { revalidate: false }
        );
      } catch {
        toaster.show(
          t('inbox_update_failed', 'Could not update this item'),
          'warning'
        );
      } finally {
        setUpdatingKey(null);
      }
    },
    [data, fetch, items, mutate, t, toaster]
  );

  const sendReply = useCallback(
    async (item: InboxItem) => {
      const content = (replyDrafts[item.sourceId] || '').trim();
      if (!content) {
        return;
      }
      setReplyingId(item.sourceId);
      try {
        const res = await fetch(`/inbox/comments/${item.sourceId}/reply`, {
          method: 'POST',
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          throw new Error('Failed to send reply');
        }
        setReplyDrafts((drafts) => ({ ...drafts, [item.sourceId]: '' }));
        toaster.show(t('inbox_reply_sent', 'Reply sent'), 'success');
        await mutate();
      } catch {
        toaster.show(
          t('inbox_reply_failed', 'Could not send reply'),
          'warning'
        );
      } finally {
        setReplyingId(null);
      }
    },
    [fetch, mutate, replyDrafts, t, toaster]
  );

  const suggestReply = useCallback(
    async (item: InboxItem) => {
      setSuggestingId(item.sourceId);
      try {
        const res = await fetch(
          `/inbox/comments/${item.sourceId}/suggest-reply`,
          {
            method: 'POST',
          }
        );
        if (!res.ok) {
          throw new Error('Failed to suggest a reply');
        }
        const json: { suggestion: string; provider: string } =
          await res.json();
        if (!json?.suggestion) {
          throw new Error('Failed to suggest a reply');
        }
        // Insert the suggestion as an editable draft only — it is never
        // sent automatically; the user reviews and sends it manually.
        setReplyDrafts((drafts) => ({
          ...drafts,
          [item.sourceId]: json.suggestion,
        }));
      } catch {
        toaster.show(
          t(
            'inbox_suggest_failed',
            'Could not generate a suggestion — check that an AI key is configured.'
          ),
          'warning'
        );
      } finally {
        setSuggestingId(null);
      }
    },
    [fetch, t, toaster]
  );

  if (isLoading) {
    return (
      <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all items-center justify-center text-newTextColor">
        <LoadingComponent />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all items-center justify-center text-center text-newTextColor">
        <div className="text-[20px]">
          {t('inbox_load_failed', 'Could not load your inbox.')}
        </div>
        <Button onClick={() => mutate()}>
          {t('inbox_try_again', 'Try again')}
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-newBgColorInner flex-1 flex flex-col p-[20px] mobile:p-[12px] gap-[16px] text-newTextColor">
      <div className="flex flex-wrap items-center gap-[12px]">
        <h2 className="flex-1 text-[24px] font-[500]">
          {t('inbox', 'Inbox')}
        </h2>
        <Button secondary={true} onClick={() => mutate()}>
          {t('inbox_refresh', 'Refresh')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-[12px]">
        <div className="flex gap-[8px]">
          {(
            [
              { value: 'all', label: t('inbox_filter_all', 'All') },
              {
                value: 'comment',
                label: t('inbox_filter_comments', 'Comments'),
              },
              {
                value: 'approval',
                label: t('inbox_filter_approvals', 'Approvals'),
              },
            ] as { value: SourceFilter; label: string }[]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSourceFilter(option.value)}
              className={clsx(
                'px-[16px] h-[36px] rounded-[6px] border border-fifth cursor-pointer text-[14px]',
                sourceFilter === option.value
                  ? 'bg-forth text-white'
                  : 'bg-sixth hover:bg-boxHover'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-[8px] cursor-pointer text-[14px]">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          {t('inbox_unread_only', 'Unread only')}
        </label>
      </div>

      {!items.length ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center gap-[12px] py-[40px]">
          <div className="text-[20px]">
            {t(
              'inbox_empty',
              'Nothing waiting — new comments and approval requests will appear here.'
            )}
          </div>
        </div>
      ) : !filteredItems.length ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center gap-[12px] py-[40px]">
          <div className="text-[20px]">
            {t('inbox_no_matches', 'No items match this filter.')}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {filteredItems.map((item) => {
            const integration = item.post?.integration;
            const approvalState = item.approvalState || item.post?.approvalState;
            const isAssignedToMe =
              !!currentUserId && item.assigneeId === currentUserId;
            const postExcerpt = truncate(stripHtml(item.post?.content));
            return (
              <div
                key={item.key}
                style={!item.read ? { borderLeftWidth: 4 } : undefined}
                className={clsx(
                  'bg-sixth border border-fifth rounded-[4px] p-[16px] flex flex-col gap-[12px]',
                  !item.read && 'shadow-sm'
                )}
              >
                <div className="flex flex-wrap items-center gap-[10px]">
                  {!item.read && (
                    <span className="w-[8px] h-[8px] rounded-full bg-blue-500 shrink-0" />
                  )}
                  <span className="text-[12px] px-[8px] py-[2px] rounded-full bg-third">
                    {item.sourceType === 'comment'
                      ? t('inbox_source_comment', 'Comment')
                      : t('inbox_source_approval', 'Approval')}
                  </span>
                  {!!integration && (
                    <span className="flex items-center gap-[8px]">
                      <PlatformIcon
                        identifier={integration.providerIdentifier}
                        size={20}
                      />
                      <span className="text-[14px]">{integration.name}</span>
                    </span>
                  )}
                  <span className="flex-1" />
                  <span
                    className="text-[12px] text-newTextColor/60"
                    title={dayjs(item.createdAt).format('MMM D, YYYY HH:mm')}
                  >
                    {relativeLabel(item.createdAt)}
                    {' · '}
                    {dayjs(item.createdAt).format('MMM D, YYYY HH:mm')}
                  </span>
                </div>

                <div
                  className={clsx(
                    'flex flex-wrap items-center gap-[8px] text-[14px]',
                    !item.read && 'font-[600]'
                  )}
                >
                  {!!item.authorName && <span>{item.authorName}</span>}
                  {item.viaLink && (
                    <span className="text-[12px] text-newTextColor/60">
                      {t('inbox_via_approval_link', 'via approval link')}
                    </span>
                  )}
                  {item.sourceType === 'approval' && !!approvalState && (
                    <span className="text-[12px] px-[8px] py-[2px] rounded-full border border-fifth">
                      {approvalState.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                {!!item.body && (
                  <div className="text-[14px] whitespace-pre-wrap">
                    {item.body}
                  </div>
                )}

                {!!postExcerpt && (
                  <div className="text-[14px] text-newTextColor/70 bg-newBgColorInner border border-fifth rounded-[4px] p-[12px]">
                    {postExcerpt}
                  </div>
                )}

                <div className="text-[12px] text-newTextColor/60">
                  {isAssignedToMe
                    ? t('inbox_assigned_to_you', 'Assigned to you')
                    : item.assigneeId
                      ? t('inbox_assigned', 'Assigned')
                      : t('inbox_unassigned', 'Unassigned')}
                </div>

                <div className="flex flex-wrap gap-[10px]">
                  <Button
                    secondary={true}
                    disabled={updatingKey === item.key}
                    onClick={() =>
                      updateState(item, { read: !item.read })
                    }
                  >
                    {item.read
                      ? t('inbox_mark_unread', 'Mark unread')
                      : t('inbox_mark_read', 'Mark read')}
                  </Button>
                  <Button
                    secondary={true}
                    disabled={updatingKey === item.key || !currentUserId}
                    onClick={() =>
                      updateState(item, {
                        assigneeId: isAssignedToMe ? null : currentUserId,
                      })
                    }
                  >
                    {isAssignedToMe
                      ? t('inbox_unassign', 'Unassign')
                      : t('inbox_assign_to_me', 'Assign to me')}
                  </Button>
                </div>

                {item.sourceType === 'comment' ? (
                  <div className="flex flex-col gap-[8px]">
                    <textarea
                      value={replyDrafts[item.sourceId] || ''}
                      onChange={(e) =>
                        setReplyDrafts((drafts) => ({
                          ...drafts,
                          [item.sourceId]: e.target.value,
                        }))
                      }
                      placeholder={t(
                        'inbox_reply_placeholder',
                        'Write a reply...'
                      )}
                      className="bg-input min-h-[80px] p-[12px] outline-none border-fifth border rounded-[4px] text-inputText placeholder-inputText w-full"
                    />
                    <div className="text-[12px] text-newTextColor/60">
                      {t(
                        'inbox_ai_suggestion_caption',
                        'AI suggestion — review before sending'
                      )}
                    </div>
                    <div className="flex flex-wrap gap-[10px]">
                      <Button
                        disabled={
                          !(replyDrafts[item.sourceId] || '').trim() ||
                          replyingId === item.sourceId
                        }
                        loading={replyingId === item.sourceId}
                        onClick={() => sendReply(item)}
                      >
                        {t('inbox_reply', 'Reply')}
                      </Button>
                      <Button
                        secondary={true}
                        disabled={suggestingId === item.sourceId}
                        loading={suggestingId === item.sourceId}
                        onClick={() => suggestReply(item)}
                      >
                        {t('inbox_suggest_reply', 'Suggest reply')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[12px] text-newTextColor/60">
                    {t(
                      'inbox_approval_hint',
                      'Approvals are actioned from the calendar — open the post there to approve or request changes.'
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!!data?.nextCursor && (
        <div className="flex justify-center">
          <Button
            secondary={true}
            disabled={loadingMore}
            loading={loadingMore}
            onClick={loadMore}
          >
            {t('inbox_load_more', 'Load more')}
          </Button>
        </div>
      )}
    </div>
  );
};
