'use client';

import React, { FC } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  AdminCard,
  PlatformAdminGate,
  statusChip,
} from '@gitroom/frontend/components/admin/platform-admin-shared';

interface ProviderRollup {
  providerIdentifier: string;
  connected: number;
  errors30d: number;
  tokenStates: {
    ok: number;
    expiring_soon: number;
    expired: number;
    unknown: number;
  };
  credentials: {
    configured: boolean | null;
    keys: { key: string; set: boolean }[];
  };
}

interface IntegrationsResponse {
  providers: ProviderRollup[];
  tokenEncryption: {
    total: number;
    encrypted: number;
    plaintext: number;
    preEncrypted: number;
  };
}

export const PlatformAdminIntegrationsComponent: FC = () => {
  const fetch = useFetch();
  const { data, error } = useSWR<IntegrationsResponse>(
    '/admin/integrations',
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load integrations');
      return res.json();
    }
  );

  return (
    <PlatformAdminGate>
      {error ? (
        <div className="text-textColor">Failed to load integrations.</div>
      ) : !data ? (
        <LoadingComponent />
      ) : (
        <div className="flex flex-col gap-[16px]">
          <div className="grid grid-cols-2 tablet:grid-cols-4 custom:grid-cols-2 gap-[12px]">
            <AdminCard
              label="Stored channel tokens"
              value={data.tokenEncryption.total}
            />
            <AdminCard
              label="Encrypted at rest"
              value={data.tokenEncryption.encrypted}
              sub="Phase 5 enc:v1: marker"
            />
            <AdminCard
              label="Still plaintext"
              value={data.tokenEncryption.plaintext}
              sub="Backfill remaining — run integrations:encrypt-tokens"
            />
            <AdminCard
              label="Pre-encrypted (Skool)"
              value={data.tokenEncryption.preEncrypted}
              sub="Provider ciphertext by design, exempt"
            />
          </div>

          <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
            <div className="grid grid-cols-[150px_90px_90px_1fr_1fr] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
              <div>Provider</div>
              <div>Connected</div>
              <div>Errors 30d</div>
              <div>Token states</div>
              <div>Platform app credentials</div>
            </div>
            {data.providers.map((provider) => (
              <div
                key={provider.providerIdentifier}
                className="grid grid-cols-[150px_90px_90px_1fr_1fr] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
              >
                <div>{provider.providerIdentifier}</div>
                <div>{provider.connected}</div>
                <div>{provider.errors30d}</div>
                <div className="flex flex-wrap gap-[4px]">
                  {provider.tokenStates.ok > 0
                    ? statusChip(`ok ${provider.tokenStates.ok}`, 'ok')
                    : null}
                  {provider.tokenStates.expiring_soon > 0
                    ? statusChip(
                        `expiring ${provider.tokenStates.expiring_soon}`,
                        'warn'
                      )
                    : null}
                  {provider.tokenStates.expired > 0
                    ? statusChip(`expired ${provider.tokenStates.expired}`, 'bad')
                    : null}
                  {provider.tokenStates.unknown > 0
                    ? statusChip(
                        `unknown ${provider.tokenStates.unknown}`,
                        'muted'
                      )
                    : null}
                  {!provider.connected && (
                    <span className="opacity-60">—</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-[4px] items-start">
                  {provider.credentials.configured === null ? (
                    <span className="opacity-70">
                      Per-user credentials — no platform keys
                    </span>
                  ) : (
                    <>
                      {provider.credentials.configured
                        ? statusChip('Configured', 'ok')
                        : statusChip('Not configured', 'bad')}
                      {provider.credentials.keys.map((key) => (
                        <span
                          key={key.key}
                          className="inline-flex px-[8px] py-[2px] rounded-[6px] text-[12px] bg-boxFocused opacity-80"
                        >
                          {key.key}: {key.set ? 'set' : 'unset'}
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[12px] opacity-70">
            Credential status shows environment key names and set/unset only —
            values are never read or displayed.
          </div>
        </div>
      )}
    </PlatformAdminGate>
  );
};
