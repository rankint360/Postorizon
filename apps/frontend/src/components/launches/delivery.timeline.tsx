import { FC, useCallback } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type DeliveryEvent = {
  kind: 'created' | 'approval' | 'scheduled' | 'error' | 'published';
  at: string | null;
  message?: string;
  platform?: string;
  state?: string;
  viaLink?: boolean;
  releaseURL?: string;
};

type DeliveryTimelineResponse = {
  post: {
    id: string;
    state: string;
    approvalState: string;
    error: string | null;
  };
  errorCount: number;
  deliveredFirstTry: boolean | null;
  events: DeliveryEvent[];
};

const dotColor = (kind: DeliveryEvent['kind']) => {
  switch (kind) {
    case 'published':
      return 'bg-[#32d583]';
    case 'error':
      return 'bg-[#f04438]';
    case 'approval':
      return 'bg-[#612bd3]';
    default:
      return 'bg-gray-400';
  }
};

/**
 * Postorizon Phase 4 — per-post delivery timeline (MVP_SPEC §3.2.4),
 * rendered at the bottom of the statistics modal. Data comes from
 * GET /posts/:id/delivery, which is built only from persisted fields:
 * creation time, the approval audit trail, the scheduled publish date,
 * one entry per recorded publish failure (Errors rows) and the
 * published state + live link. The published event intentionally has
 * no timestamp — none is persisted, so none is shown.
 */
export const DeliveryTimeline: FC<{ postId: string }> = ({ postId }) => {
  const t = useT();
  const fetch = useFetch();

  const load = useCallback(async () => {
    const res = await fetch(`/posts/${postId}/delivery`);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as DeliveryTimelineResponse;
  }, [postId, fetch]);

  const { data } = useSWR(`/posts/${postId}/delivery`, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: null,
  });

  if (!data) {
    return null;
  }

  const label = (event: DeliveryEvent): string => {
    switch (event.kind) {
      case 'created':
        return t('delivery_created', 'Post created');
      case 'approval':
        return t(
          'delivery_approval',
          'Approval: {{state}}',
          { state: event.state || '' }
        );
      case 'scheduled':
        return t('delivery_scheduled', 'Scheduled for');
      case 'error':
        return t('delivery_failed', 'Publish failed');
      case 'published':
        return t('delivery_published', 'Published');
    }
  };

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[18px] font-[500]">
          {t('delivery_timeline', 'Delivery Timeline')}
        </h3>
        {data.deliveredFirstTry === true && (
          <span className="text-[13px] font-[600] text-[#32d583]">
            {t('delivered_first_try', 'Delivered first try')}
          </span>
        )}
        {data.deliveredFirstTry === false && (
          <span className="text-[13px] font-[600] text-[#f79009]">
            {t(
              'published_after_failures',
              'Published after {{count}} failed attempt(s)',
              { count: data.errorCount }
            )}
          </span>
        )}
        {data.deliveredFirstTry === null && data.errorCount > 0 && (
          <span className="text-[13px] font-[600] text-[#f04438]">
            {t('failed_attempts', '{{count}} failed attempt(s)', {
              count: data.errorCount,
            })}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        {data.events.map((event, index) => (
          <div key={index} className="flex gap-[12px]">
            <div className="flex flex-col items-center">
              <div
                className={`w-[10px] h-[10px] rounded-full mt-[5px] shrink-0 ${dotColor(event.kind)}`}
              />
              {index < data.events.length - 1 && (
                <div className="w-[2px] flex-1 bg-newTableBorder min-h-[18px]" />
              )}
            </div>
            <div className="flex flex-col pb-[14px] min-w-0">
              <div className="flex items-baseline gap-[8px] flex-wrap">
                <span className="text-[14px] font-[500]">{label(event)}</span>
                <span className="text-[13px] text-gray-400">
                  {event.at
                    ? dayjs(event.at).format('MMM D, YYYY HH:mm')
                    : t('time_not_recorded', 'Time not recorded')}
                </span>
                {event.viaLink && (
                  <span className="text-[13px] text-gray-400">
                    {t('via_client_link', 'via client link')}
                  </span>
                )}
                {event.platform && (
                  <span className="text-[13px] text-gray-400">
                    {event.platform}
                  </span>
                )}
              </div>
              {event.message && (
                <div
                  className={`text-[13px] break-words ${
                    event.kind === 'error' ? 'text-[#f04438]' : 'text-gray-400'
                  }`}
                >
                  {event.message}
                </div>
              )}
              {event.releaseURL && (
                <a
                  href={event.releaseURL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] text-btnPrimary underline break-all"
                >
                  {event.releaseURL}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      {data.post.error && data.post.state !== 'PUBLISHED' && (
        <div className="text-[13px] text-[#f04438] break-words">
          {data.post.error}
        </div>
      )}
    </div>
  );
};
