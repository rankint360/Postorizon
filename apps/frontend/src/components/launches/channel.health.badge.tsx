'use client';

import { FC, useCallback } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export type IntegrationHealthItem = {
  id: string;
  tokenState: 'ok' | 'expiring_soon' | 'expired' | 'unknown';
  daysUntilExpiration: number | null;
  recentErrorCount: number;
  refreshNeeded: boolean;
};

/**
 * Postorizon Phase 3 — channel health badge (reliability surfacing).
 * Data comes from GET /integrations/health (token expiry + publish
 * errors from the existing substrate; display layer only). Every row
 * mounts this hook with the same SWR key, so the whole channel list
 * shares one request. Renders nothing for a healthy channel.
 */
export const ChannelHealthBadge: FC<{ integrationId: string }> = ({
  integrationId,
}) => {
  const fetch = useFetch();
  const t = useT();

  const load = useCallback(async () => {
    const res = await fetch('/integrations/health');
    if (!res.ok) {
      return {};
    }
    const list = (await res.json()) as IntegrationHealthItem[];
    return Object.fromEntries(list.map((item) => [item.id, item]));
  }, [fetch]);

  const { data } = useSWR('integration-health', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: {},
  });

  const health = data?.[integrationId];
  if (!health) {
    return null;
  }

  const warnings: string[] = [];
  if (health.tokenState === 'expired') {
    warnings.push(
      t('health_token_expired', 'Token expired — reconnect this channel')
    );
  } else if (health.tokenState === 'expiring_soon') {
    warnings.push(
      t(
        'health_token_expiring_soon',
        'Token expires in {{days}} day(s) — reconnect soon to avoid failed posts',
        { days: health.daysUntilExpiration ?? 0 }
      )
    );
  }
  if (health.recentErrorCount > 0) {
    warnings.push(
      t('health_recent_errors', '{{count}} publish error(s) in the last 30 days', {
        count: health.recentErrorCount,
      })
    );
  }

  if (!warnings.length) {
    return null;
  }

  return (
    <div
      data-tooltip-id="tooltip"
      data-tooltip-content={warnings.join(' · ')}
      className={clsx(
        'shrink-0 w-[18px] h-[18px] rounded-full text-[11px] font-bold flex items-center justify-center cursor-default',
        health.tokenState === 'expired' || health.recentErrorCount > 0
          ? 'bg-red-500 text-white'
          : 'bg-amber-500 text-black'
      )}
    >
      !
    </div>
  );
};
