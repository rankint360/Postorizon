'use client';

import React, { FC, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  AdminPager,
  formatDate,
  PlatformAdminGate,
} from '@gitroom/frontend/components/admin/platform-admin-shared';

interface AuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  adminUser: {
    id: string;
    email: string;
    name: string | null;
    lastName: string | null;
  };
}

interface AuditResponse {
  items: AuditRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export const PlatformAdminAuditComponent: FC = () => {
  const fetch = useFetch();
  const [page, setPage] = useState(0);
  const limit = 20;
  const { data, error } = useSWR<AuditResponse>(
    `/admin/audit-log?page=${page}&limit=${limit}`,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load audit log');
      return res.json();
    }
  );

  return (
    <PlatformAdminGate>
      {error ? (
        <div className="text-textColor">Failed to load audit log.</div>
      ) : !data ? (
        <LoadingComponent />
      ) : (
        <div className="flex flex-col gap-[12px]">
          <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
            <div className="grid grid-cols-[170px_220px_190px_1fr_1fr] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
              <div>When</div>
              <div>Admin</div>
              <div>Action</div>
              <div>Target</div>
              <div>Metadata</div>
            </div>
            {data.items.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[170px_220px_190px_1fr_1fr] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0 break-all"
              >
                <div>{formatDate(row.createdAt)}</div>
                <div>{row.adminUser?.email || row.adminUser?.id}</div>
                <div>{row.action}</div>
                <div>
                  {row.targetType}
                  {row.targetId ? `: ${row.targetId}` : ''}
                </div>
                <div className="opacity-80">
                  {row.metadata ? JSON.stringify(row.metadata) : '—'}
                </div>
              </div>
            ))}
            {!data.items.length && (
              <div className="px-[12px] py-[16px] text-[13px] opacity-70">
                No admin actions recorded yet.
              </div>
            )}
          </div>
          <AdminPager
            page={page}
            total={data.total}
            limit={limit}
            hasMore={data.hasMore}
            onPage={setPage}
          />
        </div>
      )}
    </PlatformAdminGate>
  );
};
