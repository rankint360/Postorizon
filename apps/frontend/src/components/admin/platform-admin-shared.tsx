'use client';

import React, { FC, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';

/**
 * Postorizon Phase 6 — shared pieces for the platform admin console.
 *
 * Protection model (same as the existing /admin/stats + /admin/errors
 * pages): the proxy keeps logged-out users out, this gate hides the
 * console from non-platform-admins, and the API enforces
 * PlatformAdminGuard on every call regardless of what renders here.
 */

export const ADMIN_NAV = [
  { label: 'Overview', path: '/admin/overview' },
  { label: 'Users', path: '/admin/users' },
  { label: 'Organizations', path: '/admin/organizations' },
  { label: 'Integrations', path: '/admin/integrations' },
  { label: 'System', path: '/admin/system' },
  { label: 'Audit log', path: '/admin/audit' },
];

export const PlatformAdminNav: FC = () => {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-[8px] items-center">
      <div className="text-[18px] font-[600] me-[8px]">Platform Admin</div>
      {ADMIN_NAV.map((item) => {
        const active = pathname === item.path;
        return (
          <Link
            key={item.path}
            href={item.path}
            className={`px-[12px] h-[34px] flex items-center rounded-[8px] border text-[13px] ${
              active
                ? 'bg-forth text-white border-transparent'
                : 'border-newTableBorder hover:bg-boxFocused'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
};

export const PlatformAdminGate: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const user = useUser();
  if (!user) {
    return <LoadingComponent />;
  }
  if (!user.isPlatformAdmin) {
    return (
      <div className="text-textColor p-[20px]">
        You do not have access to this page.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[16px]">
      <PlatformAdminNav />
      {children}
    </div>
  );
};

export const AdminCard: FC<{ label: string; value: ReactNode; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <div className="border border-newTableBorder rounded-[8px] p-[16px] flex flex-col gap-[4px]">
    <div className="text-[12px] uppercase opacity-70">{label}</div>
    <div className="text-[24px] font-[600] leading-none">{value}</div>
    {sub ? <div className="text-[12px] opacity-70">{sub}</div> : null}
  </div>
);

export const AdminPager: FC<{
  page: number;
  total: number;
  limit: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}> = ({ page, total, limit, hasMore, onPage }) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between">
      <div className="text-[13px] opacity-70">
        Page {page + 1} of {totalPages} — {total} total
      </div>
      <div className="flex gap-[8px]">
        <Button
          secondary
          disabled={page === 0}
          onClick={() => onPage(Math.max(0, page - 1))}
        >
          Previous
        </Button>
        <Button disabled={!hasMore} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
};

export const inputClass =
  'bg-newBgColorInner h-[38px] border border-newTableBorder rounded-[8px] px-[10px] text-[14px] text-textColor';

export const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

export const statusChip = (text: string, tone: 'ok' | 'warn' | 'bad' | 'muted') => (
  <span
    className={`inline-flex px-[8px] py-[2px] rounded-[6px] text-[12px] ${
      tone === 'ok'
        ? 'bg-green-500/15 text-green-500'
        : tone === 'warn'
          ? 'bg-yellow-500/15 text-yellow-600'
          : tone === 'bad'
            ? 'bg-red-500/15 text-red-500'
            : 'bg-boxFocused opacity-80'
    }`}
  >
    {text}
  </span>
);

/** POST helper for admin actions — surfaces the API's message on failure. */
export async function adminPost(
  fetchFn: (url: string, options?: any) => Promise<Response>,
  url: string,
  body?: Record<string, unknown>
): Promise<any> {
  const res = await fetchFn(url, {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) {
        message = Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message;
      }
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return res.json();
}
