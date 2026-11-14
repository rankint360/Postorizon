'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import { tzOffsetMinutes } from '@gitroom/frontend/components/new-launch/best.time.chips';

type Recommendation = {
  type: 'best_time' | 'content_pattern' | 'top_post' | 'cadence';
  title: string;
  detail: string;
  data: Record<string, unknown>;
};

type RecommendationsResponse = {
  postsSampled: number;
  minimumRequired: number;
  insufficientEngagementData: boolean;
  recommendations: Recommendation[];
};

/**
 * Postorizon Phase 3 — prescriptive analytics v1 ("what to post next").
 * Renders GET /engagement/recommendations: rules over the org's own
 * persisted engagement snapshots and publish history. Every card shows
 * the numbers it was derived from (they are in the detail text from the
 * API). "Update data" triggers a fresh engagement sampling run
 * (POST /engagement/sample) and refetches. When fewer than the minimum
 * sampled posts exist, the section says so instead of inventing advice.
 */
export const RecommendationsComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const [sampling, setSampling] = useState(false);

  const load = useCallback(async () => {
    const offset = tzOffsetMinutes(getTimezone());
    const res = await fetch(`/engagement/recommendations?tzOffset=${offset}`);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as RecommendationsResponse;
  }, [fetch]);

  const { data, mutate } = useSWR('engagement-recommendations', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: null,
  });

  const sampleNow = useCallback(async () => {
    setSampling(true);
    try {
      const res = await fetch('/engagement/sample', {
        method: 'POST',
        body: JSON.stringify({ days: 30, limit: 50 }),
      });
      if (!res.ok) {
        throw new Error('sample failed');
      }
      const result = await res.json();
      toaster.show(
        t(
          'engagement_sample_done',
          'Sampled {{sampled}} of {{candidates}} recent posts',
          { sampled: result.sampled, candidates: result.candidates }
        ),
        'success'
      );
      await mutate();
    } catch (err) {
      toaster.show(
        t('engagement_sample_failed', 'Could not sample engagement data'),
        'warning'
      );
    } finally {
      setSampling(false);
    }
  }, [fetch, mutate, t, toaster]);

  if (!data) {
    return null;
  }

  return (
    <div className="border-t border-newBorder pt-[16px] flex flex-col gap-[12px]">
      <div className="flex items-center gap-[12px] flex-wrap">
        <h3 className="text-[18px] font-[500] flex-1">
          {t('what_to_post_next', 'What to post next')}
        </h3>
        <div className="text-[13px] text-customColor18">
          {t('based_on_sampled_posts', 'Based on {{count}} sampled posts', {
            count: data.postsSampled,
          })}
        </div>
        <Button
          onClick={sampleNow}
          disabled={sampling}
          className="!h-[36px] !text-[13px]"
        >
          {sampling
            ? t('sampling', 'Sampling…')
            : t('update_engagement_data', 'Update data')}
        </Button>
      </div>

      {data.insufficientEngagementData && (
        <div className="text-[14px] text-customColor18 bg-newBgColor rounded-[8px] p-[14px]">
          {t(
            'recommendations_need_more_data',
            'Recommendations need at least {{min}} sampled posts — you have {{count}}. Publish posts, then use "Update data" to sample their engagement.',
            { min: data.minimumRequired, count: data.postsSampled }
          )}
        </div>
      )}

      {!!data.recommendations.length && (
        <div className="grid grid-cols-1 minCustom:grid-cols-2 gap-[12px]">
          {data.recommendations.map((rec, index) => (
            <div
              key={`${rec.type}-${index}`}
              className="bg-newBgColor rounded-[8px] p-[14px] flex flex-col gap-[6px]"
            >
              <div className="text-[15px] font-[600]">{rec.title}</div>
              <div className="text-[13px] text-customColor18 leading-relaxed">
                {rec.detail}
              </div>
            </div>
          ))}
        </div>
      )}

      {!data.insufficientEngagementData && !data.recommendations.length && (
        <div className="text-[14px] text-customColor18">
          {t(
            'no_recommendations_yet',
            'No strong patterns yet — your recent posting looks consistent. Keep publishing and update the data again later.'
          )}
        </div>
      )}
    </div>
  );
};
