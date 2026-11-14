'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type Branding = {
  portalName: string | null;
  logoUrl: string | null;
  accentColor: string | null;
};

type Customer = { id: string; name: string };

/**
 * Postorizon Phase 3 — white-label agency v1 settings.
 * Branding (portal name, logo URL, accent colour) is applied to the
 * client-facing public pages (approval page, client report). Per-client
 * report links are managed here too: generating a link creates the
 * customer's report token; rotating invalidates the old link.
 */
const BrandingComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const loadBranding = useCallback(async () => {
    const res = await fetch('/settings/branding');
    return res.ok ? ((await res.json()) as Branding) : null;
  }, [fetch]);
  const { data: branding, mutate: mutateBranding } = useSWR(
    'org-branding',
    loadBranding,
    { revalidateOnFocus: false, revalidateOnMount: true, fallbackData: null }
  );

  const [portalName, setPortalName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  // Postorizon Phase 4 (6c): upload a logo through the same
  // /media/upload-simple flow the capture page uses, as an alternative
  // to pasting a URL — the returned path lands in the same logoUrl
  // field and is saved by the normal Save button.
  const uploadLogo = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) {
        return;
      }
      setLogoUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/media/upload-simple', {
          method: 'POST',
          body: formData,
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (data?.path) {
          setLogoUrl(data.path);
        } else {
          toaster.show(
            t('logo_upload_failed', 'Could not upload the logo'),
            'warning'
          );
        }
      } finally {
        setLogoUploading(false);
      }
    },
    [fetch, t, toaster]
  );

  useEffect(() => {
    if (branding) {
      setPortalName(branding.portalName || '');
      setLogoUrl(branding.logoUrl || '');
      setAccentColor(branding.accentColor || '');
    }
  }, [branding]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/settings/branding', {
        method: 'PUT',
        body: JSON.stringify({
          portalName: portalName || null,
          logoUrl: logoUrl || null,
          accentColor: accentColor || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toaster.show(
          typeof data?.message === 'string'
            ? data.message
            : t('branding_save_failed', 'Could not save branding'),
          'warning'
        );
        return;
      }
      await mutateBranding();
      toaster.show(t('settings_updated', 'Settings updated'), 'success');
    } finally {
      setSaving(false);
    }
  }, [fetch, portalName, logoUrl, accentColor, mutateBranding, t, toaster]);

  // ---- per-client report links ----
  const loadCustomers = useCallback(async () => {
    const res = await fetch('/integrations/customers');
    const json = res.ok ? await res.json() : [];
    return (Array.isArray(json) ? json : []) as Customer[];
  }, [fetch]);
  const { data: customers } = useSWR('branding-customers', loadCustomers, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    fallbackData: [],
  });

  const [customerId, setCustomerId] = useState('');
  const [reportLink, setReportLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);

  const loadToken = useCallback(async () => {
    if (!customerId) {
      return;
    }
    const res = await fetch(`/settings/customers/${customerId}/report-token`);
    const data = res.ok ? await res.json() : null;
    setReportLink(
      data?.token ? `${window.location.origin}/report/${data.token}` : ''
    );
  }, [fetch, customerId]);

  const ensureToken = useCallback(async () => {
    if (!customerId) {
      return;
    }
    setLinkBusy(true);
    try {
      const res = await fetch(
        `/settings/customers/${customerId}/report-token`,
        { method: 'POST' }
      );
      const data = res.ok ? await res.json() : null;
      if (data?.token) {
        setReportLink(`${window.location.origin}/report/${data.token}`);
      }
    } finally {
      setLinkBusy(false);
    }
  }, [fetch, customerId]);

  useEffect(() => {
    setReportLink('');
    if (customerId) {
      loadToken();
    }
  }, [customerId, loadToken]);

  return (
    <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">{t('branding_settings', 'Branding')}</div>
      <div className="text-[12px] text-customColor18">
        {t(
          'branding_settings_description',
          'Your logo, name and accent colour appear on client-facing pages: approval links and client reports. Leave fields empty to use the standard Postorizon look.'
        )}
      </div>
      <div className="flex flex-col gap-[12px]">
        <Input
          name="portalName"
          label={t('portal_name', 'Portal display name')}
          value={portalName}
          onChange={(e) => setPortalName(e.target.value)}
          placeholder="Acme Social"
          disableForm={true}
        />
        <Input
          name="logoUrl"
          label={t('logo_url', 'Logo URL')}
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://example.com/logo.png"
          disableForm={true}
        />
        <div className="flex items-center gap-[12px]">
          <label
            className={`text-[13px] underline ${
              logoUploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
            }`}
          >
            {logoUploading
              ? t('uploading', 'Uploading…')
              : t('upload_logo', 'or upload a logo')}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={uploadLogo}
              disabled={logoUploading}
            />
          </label>
          {!!logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="h-[32px] max-w-[120px] object-contain"
            />
          )}
        </div>
        <div className="flex items-end gap-[12px]">
          <div className="flex-1">
            <Input
              name="accentColor"
              label={t('accent_color', 'Accent colour')}
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#FF5A3C"
              disableForm={true}
            />
          </div>
          <input
            type="color"
            aria-label={t('accent_color', 'Accent colour')}
            value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#FF5A3C'}
            onChange={(e) => setAccentColor(e.target.value)}
            className="w-[44px] h-[44px] bg-transparent cursor-pointer"
          />
        </div>
        <div>
          <Button onClick={save} disabled={saving}>
            {t('save', 'Save')}
          </Button>
        </div>
      </div>

      <div className="border-t border-fifth pt-[20px] flex flex-col gap-[12px]">
        <div>{t('client_report_link', 'Client report link')}</div>
        <div className="text-[12px] text-customColor18">
          {t(
            'client_report_link_description',
            'A read-only, no-login report of a client\u2019s published posts and their engagement. Anyone with the link can view it; rotate the link to revoke it.'
          )}
        </div>
        <div className="w-[260px]">
          <Select
            name="reportCustomer"
            label=""
            disableForm={true}
            hideErrors={true}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">{t('select_client', 'Select a client')}</option>
            {(customers || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {!!customerId && !reportLink && (
          <div>
            <Button onClick={ensureToken} disabled={linkBusy}>
              {t('generate_report_link', 'Generate report link')}
            </Button>
          </div>
        )}
        {!!customerId && !!reportLink && (
          <div className="flex flex-col gap-[8px]">
            <div className="text-[13px] break-all bg-newBgColor rounded-[6px] p-[10px]">
              {reportLink}
            </div>
            <div>
              <Button
                onClick={async () => {
                  setLinkBusy(true);
                  try {
                    const res = await fetch(
                      `/settings/customers/${customerId}/report-token/rotate`,
                      { method: 'POST' }
                    );
                    const data = res.ok ? await res.json() : null;
                    if (data?.token) {
                      setReportLink(
                        `${window.location.origin}/report/${data.token}`
                      );
                      toaster.show(
                        t('report_link_rotated', 'Report link rotated'),
                        'success'
                      );
                    }
                  } finally {
                    setLinkBusy(false);
                  }
                }}
                disabled={linkBusy}
                secondary
              >
                {t('rotate_report_link', 'Rotate link')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BrandingComponent;
