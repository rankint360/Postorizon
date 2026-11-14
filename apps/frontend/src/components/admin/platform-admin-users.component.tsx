'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
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

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  lastName: string | null;
  providerName: string;
  activated: boolean;
  isPlatformAdmin: boolean;
  suspendedAt: string | null;
  sessionEpoch: number;
  lastOnline: string;
  createdAt: string;
  _count: { organizations: number };
}

interface UsersResponse {
  items: UserRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

interface UserDetail extends UserRow {
  providerId: string | null;
  timezoneName: string | null;
  organizations: {
    role: string;
    disabled: boolean;
    organization: {
      id: string;
      name: string;
      createdAt: string;
      suspendedAt: string | null;
    };
  }[];
}

const fullName = (u: { name: string | null; lastName: string | null }) =>
  [u.name, u.lastName].filter(Boolean).join(' ') || '—';

const userStatus = (u: { suspendedAt: string | null; activated: boolean }) =>
  u.suspendedAt
    ? statusChip('Suspended', 'bad')
    : !u.activated
      ? statusChip('Not activated', 'warn')
      : statusChip('Active', 'ok');

const UserDetailModal: FC<{ id: string; onChanged: () => void }> = ({
  id,
  onChanged,
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const me = useUser();
  const { data, mutate } = useSWR<UserDetail>(
    `/admin/users/${id}`,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load user');
      return res.json();
    }
  );

  const run = useCallback(
    async (
      path: string,
      confirm: string,
      success: string,
      destructive = false
    ) => {
      if (
        !(await deleteDialog(
          confirm,
          'Yes, continue',
          'Are you sure?',
          'Cancel',
          destructive
        ))
      ) {
        return;
      }
      try {
        await adminPost(fetch, path);
        toaster.show(success, 'success');
        mutate();
        onChanged();
      } catch (e) {
        toaster.show(e instanceof Error ? e.message : 'Action failed', 'warning');
      }
    },
    [fetch, mutate, onChanged, toaster]
  );

  if (!data) {
    return (
      <div className="rounded-[4px] border border-newTableBorder bg-newBgColorInner p-[16px] w-full max-w-[720px]">
        <LoadingComponent />
      </div>
    );
  }

  const isSelf = me?.id === data.id;

  return (
    <div className="rounded-[4px] border border-newTableBorder bg-newBgColorInner px-[16px] pb-[16px] w-full max-w-[720px] max-h-[80vh] overflow-auto">
      <div className="sticky top-0 bg-newBgColorInner py-[16px] flex items-center justify-between gap-[12px] border-b border-newTableBorder mb-[12px]">
        <div className="text-[16px] font-[600]">{data.email}</div>
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
          <span className="opacity-70">Name:</span> {fullName(data)}
        </div>
        <div>
          <span className="opacity-70">Provider:</span> {data.providerName}
        </div>
        <div>
          <span className="opacity-70">Status:</span> {userStatus(data)}
          {data.isPlatformAdmin
            ? statusChip('Platform admin', 'muted')
            : null}
        </div>
        <div>
          <span className="opacity-70">Session epoch:</span> {data.sessionEpoch}
        </div>
        <div>
          <span className="opacity-70">Created:</span> {formatDate(data.createdAt)}
        </div>
        <div>
          <span className="opacity-70">Last online:</span>{' '}
          {formatDate(data.lastOnline)}
        </div>
        {data.suspendedAt ? (
          <div>
            <span className="opacity-70">Suspended at:</span>{' '}
            {formatDate(data.suspendedAt)}
          </div>
        ) : null}
      </div>

      <div className="text-[14px] font-[600] mb-[8px]">Organizations</div>
      <div className="flex flex-col gap-[6px] mb-[16px]">
        {data.organizations.map((membership) => (
          <div
            key={membership.organization.id}
            className="flex items-center justify-between border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[13px]"
          >
            <span>{membership.organization.name}</span>
            <span className="opacity-70">
              {membership.role}
              {membership.disabled ? ' · membership disabled' : ''}
              {membership.organization.suspendedAt ? ' · org suspended' : ''}
            </span>
          </div>
        ))}
        {!data.organizations.length && (
          <div className="text-[13px] opacity-70">No organizations.</div>
        )}
      </div>

      <div className="text-[14px] font-[600] mb-[8px]">Actions</div>
      <div className="flex flex-wrap gap-[8px]">
        {data.suspendedAt ? (
          <Button
            onClick={() =>
              run(
                `/admin/users/${data.id}/reactivate`,
                `Reactivate ${data.email}? They will be able to sign in again.`,
                'User reactivated'
              )
            }
          >
            Reactivate
          </Button>
        ) : (
          <Button
            disabled={isSelf}
            onClick={() =>
              run(
                `/admin/users/${data.id}/suspend`,
                `Suspend ${data.email}? Their sessions end immediately and they cannot sign in until reactivated.`,
                'User suspended',
                true
              )
            }
          >
            Suspend
          </Button>
        )}
        <Button
          secondary
          onClick={() =>
            run(
              `/admin/users/${data.id}/force-sign-out`,
              `Sign ${data.email} out on every device? Their current sessions will be rejected on the next request.`,
              'User signed out everywhere'
            )
          }
        >
          Force sign-out
        </Button>
        {data.isPlatformAdmin ? (
          <Button
            secondary
            disabled={isSelf}
            onClick={() =>
              run(
                `/admin/users/${data.id}/revoke-admin`,
                `Revoke platform admin from ${data.email}? They lose access to this console immediately.`,
                'Platform admin revoked',
                true
              )
            }
          >
            Revoke admin
          </Button>
        ) : (
          <Button
            secondary
            onClick={() =>
              run(
                `/admin/users/${data.id}/grant-admin`,
                `Make ${data.email} a platform admin? They gain full access to this console, including user and organization controls.`,
                'Platform admin granted'
              )
            }
          >
            Grant admin
          </Button>
        )}
        {!data.activated && (
          <Button
            secondary
            onClick={() =>
              run(
                `/admin/users/${data.id}/resend-activation`,
                `Resend the activation email to ${data.email}?`,
                'Activation email sent'
              )
            }
          >
            Resend activation
          </Button>
        )}
      </div>
      {isSelf && (
        <div className="text-[12px] opacity-70 mt-[10px]">
          You cannot suspend or demote your own account.
        </div>
      )}
    </div>
  );
};

export const PlatformAdminUsersComponent: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const me = useUser();
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

  const key = `/admin/users?page=${page}&limit=${limit}${
    debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''
  }`;
  const { data, error, mutate } = useSWR<UsersResponse>(
    key,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    }
  );

  const toggleSuspend = useCallback(
    async (row: UserRow) => {
      const suspend = !row.suspendedAt;
      if (
        !(await deleteDialog(
          suspend
            ? `Suspend ${row.email}? Their sessions end immediately.`
            : `Reactivate ${row.email}?`,
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
          `/admin/users/${row.id}/${suspend ? 'suspend' : 'reactivate'}`
        );
        toaster.show(suspend ? 'User suspended' : 'User reactivated', 'success');
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
        children: <UserDetailModal id={id} onChanged={() => mutate()} />,
        classNames: { modal: 'w-[100%] max-w-[760px] text-textColor' },
      });
    },
    [modal, mutate]
  );

  return (
    <PlatformAdminGate>
      <div className="flex items-center gap-[12px]">
        <input
          className={`${inputClass} w-[320px]`}
          placeholder="Search by email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error ? (
        <div className="text-textColor">Failed to load users.</div>
      ) : !data ? (
        <LoadingComponent />
      ) : (
        <div className="flex flex-col gap-[12px]">
          <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1fr_150px_70px_160px_190px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
              <div>Email</div>
              <div>Name</div>
              <div>Status</div>
              <div>Orgs</div>
              <div>Created</div>
              <div>Actions</div>
            </div>
            {data.items.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[1.4fr_1fr_150px_70px_160px_190px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0 items-center"
              >
                <div className="break-all">
                  {row.email}
                  {row.isPlatformAdmin
                    ? statusChip('Admin', 'muted')
                    : null}
                </div>
                <div>{fullName(row)}</div>
                <div>{userStatus(row)}</div>
                <div>{row._count.organizations}</div>
                <div>{formatDate(row.createdAt)}</div>
                <div className="flex gap-[6px]">
                  <Button secondary onClick={() => openDetail(row.id)}>
                    Details
                  </Button>
                  <Button
                    secondary
                    disabled={me?.id === row.id && !row.suspendedAt}
                    onClick={() => toggleSuspend(row)}
                  >
                    {row.suspendedAt ? 'Reactivate' : 'Suspend'}
                  </Button>
                </div>
              </div>
            ))}
            {!data.items.length && (
              <div className="px-[12px] py-[16px] text-[13px] opacity-70">
                No users match.
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
