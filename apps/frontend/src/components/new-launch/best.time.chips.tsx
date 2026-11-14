'use client';

import { FC, useCallback } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  getTimezone,
  newDayjs,
} from '@gitroom/frontend/components/layout/set.timezone';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type BestTimesResponse = {
  insufficientData: boolean;
  postsSampled: number;
  minimumRequired: number;
  slots: { weekday: number; hour: number; avgEngagement: number; posts: number }[];
};

/** Minutes east of UTC for an IANA zone at a given instant (Intl-based). */
export const tzOffsetMinutes = (timeZone: string, date = new Date()): number => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    const map: Record<string, string> = {};
    for (const part of parts) {
      map[part.type] = part.value;
    }
    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) % 24,
      Number(map.minute),
      Number(map.second)
    );
    return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  } catch (err) {
    return -date.getTimezoneOffset();
  }
};

/**
 * Postorizon Phase 3 — best-time suggestions in the composer (MVP_SPEC
 * §3.2.6). Chips come from GET /engagement/best-times, computed from the
 * org's own persisted engagement snapshots in the app's selected
 * timezone. Clicking a chip moves the picker to the next occurrence of
 * that weekday/hour. When there is not enough sampled data yet the
 * component renders nothing — the composer is unchanged until the data
 * exists (the API states its minimum: 8 sampled posts).
 */
export const BestTimeChips: FC<{ onPick: (date: dayjs.Dayjs) => void }> = ({
  onPick,
}) => {
  const fetch = useFetch();
  const t = useT();

  const load = useCallback(async () => {
    const offset = tzOffsetMinutes(getTimezone());
    const res = await fetch(`/engagement/best-times?tzOffset=${offset}`);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as BestTimesResponse;
  }, [fetch]);

  const { data } = useSWR('best-time-chips', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: null,
  });

  if (!data || data.insufficientData || !data.slots?.length) {
    return null;
  }

  const pick = (weekday: number, hour: number) => () => {
    let target = newDayjs().day(weekday).hour(hour).minute(0).second(0);
    if (target.isBefore(newDayjs())) {
      target = target.add(1, 'week');
    }
    onPick(target);
  };

  return (
    <div className="flex items-center gap-[6px] me-[4px]">
      <span className="text-[13px] text-customColor18 whitespace-nowrap">
        {t('best_times', 'Best times:')}
      </span>
      {data.slots.slice(0, 3).map((slot) => (
        <button
          key={`${slot.weekday}-${slot.hour}`}
          type="button"
          onClick={pick(slot.weekday, slot.hour)}
          title={t(
            'best_time_chip_hint',
            'Average engagement {{avg}} across {{posts}} posts — click to use the next {{day}} at {{hour}}',
            {
              avg: slot.avgEngagement,
              posts: slot.posts,
              day: WEEKDAYS[slot.weekday],
              hour: `${String(slot.hour).padStart(2, '0')}:00`,
            }
          )}
          className="cursor-pointer whitespace-nowrap px-[10px] h-[32px] rounded-full border border-btnPrimary/40 text-btnPrimary text-[13px] font-[600] hover:bg-btnPrimary/10"
        >
          {WEEKDAYS[slot.weekday]} {String(slot.hour).padStart(2, '0')}:00
        </button>
      ))}
    </div>
  );
};
