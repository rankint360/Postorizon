'use client';

import React, { FC } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  AdminCard,
  PlatformAdminGate,
} from '@gitroom/frontend/components/admin/platform-admin-shared';

interface OverviewResponse {
  users: number;
  organizations: number;
  integrations: number;
  postsLast30Days: number;
  snapshots: number;
}

export const PlatformAdminOverviewComponent: FC = () => {
  const fetch = useFetch();
  const { data, error } = useSWR<OverviewResponse>(
    '/admin/overview',
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load overview');
      return res.json();
    }
  );

  return (
    <PlatformAdminGate>
      {error ? (
        <div className="text-textColor">Failed to load overview.</div>
      ) : !data ? (
        <LoadingComponent />
      ) : (
        <div className="grid grid-cols-2 tablet:grid-cols-3 custom:grid-cols-2 gap-[12px]">
          <AdminCard label="Users" value={data.users} />
          <AdminCard label="Organizations" value={data.organizations} />
          <AdminCard label="Connected channels" value={data.integrations} />
          <AdminCard label="Posts (last 30 days)" value={data.postsLast30Days} />
          <AdminCard
            label="Engagement snapshots"
            value={data.snapshots}
            sub="Persisted analytics samples (Phase 3)"
          />
        </div>
      )}
    </PlatformAdminGate>
  );
};
