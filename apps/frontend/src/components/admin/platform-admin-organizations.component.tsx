'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  adminPost,
  AdminPager,
  formatDate,
  inputClass,
  PlatformAdminGate,
  statusChip,
} from '@gitroom/frontend/components/admin/platform-admin-shared';

const TIERS = ['FREE', 'STANDARD', 'PRO', 'TEAM', 'ULTIMATE'];

interface SubscriptionInfo {
  subscriptionTier: string;
  provider: string;
  period: string;
  totalChannels: number;
  isLifetime: boolean;
  cancelAt: string | null;
}

interface OrgRow {
  id: string;
  name: string;
  createdAt: string;
  suspendedAt: string | null;
  _count: { users: number; Integration: number };
  subscription: SubscriptionInfo | null;
}

interface OrgsResponse {
  items: OrgRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

interface OrgDetail {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  suspendedAt: string | null;
  subscription: SubscriptionInfo | null;
  users: {
    role: string;
    disabled: boolean;
    user: {
      id: string;
      email: string;
      name: string | null;
      lastName: string | null;
      isPlatformAdmin: boolean;
      suspendedAt: string | null;
    };
  }[];
  integrations: {
    id: string;
    name: string;
    customName: string | null;
    providerIdentifier: string;
    disabled: boolean;
    tokenExpiration: string | null;
    health: {
      tokenState: 'ok' | 'expiring_soon' | 'expired' | 'unknown';
      recentErrorCount: number;
      lastErrorAt: string | null;
      refreshNeeded: boolean;
    } | null;
  }[];
}

const tierOf = (org: { subscription: SubscriptionInfo | null }) =>
  org.subscription?.subscriptionTier || 'FREE';

const tokenStateChip = (state: string) =>
  state === 'ok'
    ? statusChip('Token ok', 'ok')
    : state === 'expiring_soon'
      ? statusChip('Token expiring', 'warn')
      : state === 'expired'
        ? statusChip('Token expired', 'bad')
        : statusChip('Token unknown', 'muted');

const TierModal: FC<{ org: OrgRow; onChanged: () => void }> = ({
  org,
  onChanged,
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const current = tierOf(org);
  const [tier, setTier] = useState(current);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (
      !(await deleteDialog(
        `Change ${org.name} from ${current} to ${tier}? Channel limits and team features adjust to the new tier immediately. This changes the tier only — no charge is made.`,
        'Yes, change tier',
        'Change tier?',
        'Cancel',
        tier === 'FREE'
      ))
    ) {
      return;
    }
    setSaving(true);
    try {
      await adminPost(fetch, `/admin/organizations/${org.id}/tier`, { tier });
      toaster.show('Tier updated', 'success');
      onChanged();
      modal.closeAll();
    } catch (e) {
      toaster.show(e instanceof Error ? e.message : 'Action failed', 'warning');
    } finally {
      setSaving(false);
    }
  }, [fetch, org, tier, current, onChanged, toaster, modal]);

  return (
    <div className="rounded-[4px] border border-newTableBorder bg-newBgColorInner p-[16px] w-full max-w-[440px] flex flex-col gap-[12px]">
      <div className="text-[16px] font-[600]">Tier override — {org.name}</div>
      <div className="text-[13px] opacity-80">
        Current tier: {current}
        {org.subscription?.isLifetime ? ' (lifetime — overrides are refused)' : ''}
      </div>
      <select
        className={inputClass}
        value={tier}
        onChange={(e) => setTier(e.target.value)}
      >
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="flex gap-[8px] justify-end">
        <Button secondary onClick={() => modal.closeAll()}>
          Cancel
        </Button>
        <Button loading={saving} disabled={tier === current} onClick={save}>
          Save tier
        </Button>
      </div>
    </div>
  );
};

const OrgDetailModal: FC<{ id: string; onChanged: () => void }> = ({ id }) => {
  const fetch = useFetch();
  const modal = useModals();
  const { data } = useSWR<OrgDetail>(`/admin/organizations/${id}`, async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load organization');
    return res.json();
  });

  if (!data) {
    return (
      <div className="rounded-[4px] border border-newTableBorder bg-newBgColorInner p-[16px] w-full max-w-[760px]">
        <LoadingComponent />
      </div>
    );
  }

  return (
    <div className="rounded-[4px] border border-newTableBorder bg-newBgColorInner px-[16px] pb-[16px] w-full max-w-[760px] max-h-[80vh] overflow-auto">
      <div className="sticky top-0 bg-newBgColorInner py-[16px] flex items-center justify-between gap-[12px] border-b border-newTableBorder mb-[12px]">
        <div className="text-[16px] font-[600]">{data.name}</div>
        <button
          className="outline-none px-[10px] h-[30px] hover:bg-boxFocused cursor-pointer rounded-[6px] text-[13px]"
          type="button"
          onClick={() => modal.closeAll()}
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-[12px] text-[13px] mb-[16px]">
        <div>
          <span className="opacity-70">Status:</span>{' '}
          {data.suspendedAt
            ? statusChip('Suspended', 'bad')
            : statusChip('Active', 'ok')}
        </div>
        <div>
          <span className="opacity-70">Tier:</span> {tierOf(data)}
          {data.subscription
            ? ` · ${data.subscription.provider} · ${data.subscription.period} · ${data.subscription.totalChannels} channels`
            : ' · no subscription row'}
          {data.subscription?.isLifetime ? ' · lifetime' : ''}
          {data.subscription?.cancelAt
            ? ` · cancels ${formatDate(data.subscription.cancelAt)}`
            : ''}
        </div>
        <div>
          <span className="opacity-70">Created:</span> {formatDate(data.createdAt)}
        </div>
        {data.suspendedAt ? (
          <div>
            <span className="opacity-70">Suspended at:</span>{' '}
            {formatDate(data.suspendedAt)}
          </div>
        ) : null}
      </div>

      <div className="text-[14px] font-[600] mb-[8px]">Members</div>
      <div className="flex flex-col gap-[6px] mb-[16px]">
        {data.users.map((membership) => (
          <div
            key={membership.user.id}
            className="flex items-center justify-between border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[13px]"
          >
            <span>
              {membership.user.email}
              {membership.user.isPlatformAdmin ? ' · platform admin' : ''}
              {membership.user.suspendedAt ? ' · user suspended' : ''}
            </span>
            <span className="opacity-70">
              {membership.role}
              {membership.disabled ? ' · disabled' : ''}
            </span>
          </div>
        ))}
        {!data.users.length && (
          <div className="text-[13px] opacity-70">No members.</div>
        )}
      </div>

      <div className="text-[14px] font-[600] mb-[8px]">
        Channels &amp; health
      </div>
      <div className="flex flex-col gap-[6px]">
        {data.integrations.map((integration) => (
          <div
            key={integration.id}
            className="flex items-center justify-between border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[13px]"
          >
            <span>
              {integration.customName || integration.name}{' '}
              <span className="opacity-70">
                ({integration.providerIdentifier})
              </span>
              {integration.disabled ? ' · disabled' : ''}
            </span>
            <span className="flex items-center gap-[6px]">
              {integration.health
                ? tokenStateChip(integration.health.tokenState)
                : statusChip('No health data', 'muted')}
              {integration.health && integration.health.recentErrorCount > 0
                ? statusChip(
                    `${integration.health.recentErrorCount} errors / 30d`,
                    'warn'
                  )
                : null}
            </span>
          </div>
        ))}
        {!data.integrations.length && (
          <div className="text-[13px] opacity-70">No channels connected.</div>
        )}
      </div>
    </div>
  );
};

export const PlatformAdminOrganizationsComponent: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const limit = 20;

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const key = `/admin/organizations?page=${page}&limit=${limit}${
    debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''
  }`;
  const { data, error, mutate } = useSWR<OrgsResponse>(
    key,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load organizations');
      return res.json();
    }
  );

  const toggleSuspend = useCallback(
    async (row: OrgRow) => {
      const suspend = !row.suspendedAt;
      if (
        !(await deleteDialog(
          suspend
            ? `Suspend ${row.name}? Its members lose access to this organization and its API keys stop working until reactivated.`
            : `Reactivate ${row.name}?`,
          'Yes, continue',
          'Are you sure?',
          'Cancel',
          suspend
        ))
      ) {
        return;
      }
      try {
        await adminPost(
          fetch,
          `/admin/organizations/${row.id}/${suspend ? 'suspend' : 'reactivate'}`
        );
        toaster.show(
          suspend ? 'Organization suspended' : 'Organization reactivated',
          'success'
        );
        mutate();
      } catch (e) {
        toaster.show(e instanceof Error ? e.message : 'Action failed', 'warning');
      }
    },
    [fetch, mutate, toaster]
  );

  const openDetail = useCallback(
    (id: string) => {
      modal.openModal({
        children: <OrgDetailModal id={id} onChanged={() => mutate()} />,
        classNames: { modal: 'w-[100%] max-w-[800px] text-textColor' },
      });
    },
    [modal, mutate]
  );

  const openTier = useCallback(
    (org: OrgRow) => {
      modal.openModal({
        children: <TierModal org={org} onChanged={() => mutate()} />,
        classNames: { modal: 'w-[100%] max-w-[480px] text-textColor' },
      });
    },
    [modal, mutate]
  );

  return (
    <PlatformAdminGate>
      <div className="flex items-center gap-[12px]">
        <input
          className={`${inputClass} w-[320px]`}
          placeholder="Search organizations by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error ? (
        <div className="text-textColor">Failed to load organizations.</div>
      ) : !data ? (
        <LoadingComponent />
      ) : (
        <div className="flex flex-col gap-[12px]">
          <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
            <div className="grid grid-cols-[1.4fr_110px_90px_90px_150px_250px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
              <div>Name</div>
              <div>Tier</div>
              <div>Members</div>
              <div>Channels</div>
              <div>Created</div>
              <div>Actions</div>
            </div>
            {data.items.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[1.4fr_110px_90px_90px_150px_250px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0 items-center"
              >
                <div>
                  {row.name}{' '}
                  {row.suspendedAt ? statusChip('Suspended', 'bad') : null}
                </div>
                <div>
                  {tierOf(row)}
                  {row.subscription?.isLifetime ? ' (lifetime)' : ''}
                </div>
                <div>{row._count.users}</div>
                <div>{row._count.Integration}</div>
                <div>{formatDate(row.createdAt)}</div>
                <div className="flex gap-[6px]">
                  <Button secondary onClick={() => openDetail(row.id)}>
                    Details
                  </Button>
                  <Button secondary onClick={() => openTier(row)}>
                    Tier
                  </Button>
                  <Button secondary onClick={() => toggleSuspend(row)}>
                    {row.suspendedAt ? 'Reactivate' : 'Suspend'}
                  </Button>
                </div>
              </div>
            ))}
            {!data.items.length && (
              <div className="px-[12px] py-[16px] text-[13px] opacity-70">
                No organizations match.
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
