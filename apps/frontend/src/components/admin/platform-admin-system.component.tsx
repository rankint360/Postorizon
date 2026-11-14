'use client';

import React, { FC } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  AdminCard,
  formatDate,
  PlatformAdminGate,
  statusChip,
} from '@gitroom/frontend/components/admin/platform-admin-shared';

interface SystemResponse {
  email: { provider: string; configured: boolean; missingKeys: string[] };
  storage: { provider: string; configured: boolean; missingKeys: string[] };
  engagement: { totalSnapshots: number; latestCapturedAt: string | null };
  tokenBackfill: {
    remainingPlaintext: number;
    encrypted: number;
    preEncrypted: number;
    total: number;
  };
}

const ServiceRow: FC<{
  title: string;
  provider: string;
  configured: boolean;
  missingKeys: string[];
}> = ({ title, provider, configured, missingKeys }) => (
  <div className="border border-newTableBorder rounded-[8px] p-[16px] flex flex-col gap-[6px]">
    <div className="flex items-center justify-between">
      <div className="text-[14px] font-[600]">{title}</div>
      {configured
        ? statusChip('Configured', 'ok')
        : statusChip('Not configured', 'bad')}
    </div>
    <div className="text-[13px]">
      <span className="opacity-70">Provider:</span> {provider}
    </div>
    {missingKeys.length > 0 && (
      <div className="text-[13px]">
        <span className="opacity-70">Missing env keys:</span>{' '}
        {missingKeys.join(', ')}
      </div>
    )}
  </div>
);

export const PlatformAdminSystemComponent: FC = () => {
  const fetch = useFetch();
  const { data, error } = useSWR<SystemResponse>(
    '/admin/system',
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load system status');
      return res.json();
    }
  );

  return (
    <PlatformAdminGate>
      {error ? (
        <div className="text-textColor">Failed to load system status.</div>
      ) : !data ? (
        <LoadingComponent />
      ) : (
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-[12px]">
            <ServiceRow
              title="Email"
              provider={data.email.provider}
              configured={data.email.configured}
              missingKeys={data.email.missingKeys}
            />
            <ServiceRow
              title="Storage"
              provider={data.storage.provider}
              configured={data.storage.configured}
              missingKeys={data.storage.missingKeys}
            />
          </div>
          <div className="grid grid-cols-2 tablet:grid-cols-3 custom:grid-cols-2 gap-[12px]">
            <AdminCard
              label="Engagement snapshots"
              value={data.engagement.totalSnapshots}
            />
            <AdminCard
              label="Latest sampling activity"
              value={
                data.engagement.latestCapturedAt
                  ? formatDate(data.engagement.latestCapturedAt)
                  : 'Never'
              }
              sub="Newest PostEngagementSnapshot"
            />
            <AdminCard
              label="Token backfill remaining"
              value={data.tokenBackfill.remainingPlaintext}
              sub={`${data.tokenBackfill.encrypted} encrypted · ${data.tokenBackfill.preEncrypted} pre-encrypted · ${data.tokenBackfill.total} total`}
            />
          </div>
          <div className="text-[12px] opacity-70">
            Status is derived from live configuration and database state only —
            no synthetic health probes.
          </div>
        </div>
      )}
    </PlatformAdminGate>
  );
};
