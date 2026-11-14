'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { PlatformIcon } from '@gitroom/frontend/components/ui/platform.icon.component';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import clsx from 'clsx';

const GROUP_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const generateGroup = () => {
  let group = '';
  for (let i = 0; i < 10; i++) {
    group += GROUP_CHARS.charAt(
      Math.floor(Math.random() * GROUP_CHARS.length)
    );
  }
  return group;
};

export const CaptureComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: integrations, isLoading } = useIntegrationList();

  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploadedMedia, setUploadedMedia] = useState<{
    id: string;
    path: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const hasAutoSelected = useRef(false);

  const channels = useMemo<any[]>(
    () => (integrations || []).filter((ch: any) => !ch.disabled),
    [integrations]
  );

  const groups = useMemo<{ id: string; name: string }[]>(() => {
    const seen = new Map<string, string>();
    for (const ch of channels) {
      if (ch.customer?.id && ch.customer?.name && !seen.has(ch.customer.id)) {
        seen.set(ch.customer.id, ch.customer.name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [channels]);

  const displayedChannels = useMemo<any[]>(
    () =>
      groupFilter
        ? channels.filter((ch: any) => ch.customer?.id === groupFilter)
        : channels,
    [channels, groupFilter]
  );

  const handleGroupChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setGroupFilter(value);
      if (value) {
        setSelectedIds(
          channels
            .filter((ch: any) => ch.customer?.id === value)
            .map((ch: any) => ch.id as string)
        );
      }
    },
    [channels]
  );

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/media/upload-simple', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        if (response.ok && data?.id && data?.path) {
          setUploadedMedia({ id: data.id, path: data.path });
        } else {
          toaster.show(
            t('capture_upload_failed', 'Upload failed. Please try again.'),
            'warning'
          );
        }
      } catch {
        toaster.show(
          t('capture_upload_failed', 'Upload failed. Please try again.'),
          'warning'
        );
      } finally {
        setUploading(false);
        e.target.value = '';
      }
    },
    [fetch, toaster, t]
  );

  // Select the first available channel once, when the list first loads.
  useEffect(() => {
    if (!hasAutoSelected.current && channels.length > 0) {
      hasAutoSelected.current = true;
      setSelectedIds([channels[0].id]);
    }
  }, [channels]);

  const toggleChannel = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }, []);

  const handleSave = useCallback(async () => {
    const selectedChannels = channels.filter((ch: any) =>
      selectedIds.includes(ch.id)
    );
    if (!text.trim() || selectedChannels.length === 0 || submitting) {
      return;
    }

    const genericError = t(
      'capture_save_failed',
      'Failed to save draft. Please try again.'
    );

    setSubmitting(true);
    try {
      const group = generateGroup();
      const trimmedMediaUrl = mediaUrl.trim();
      const image: { id: string; path: string }[] = uploadedMedia
        ? [uploadedMedia]
        : trimmedMediaUrl
          ? [{ id: trimmedMediaUrl, path: trimmedMediaUrl }]
          : ([] as { id: string; path: string }[]);
      const payload = {
        type: 'draft',
        date: new Date().toISOString(),
        shortLink: false,
        tags: [] as { value: string; label: string }[],
        posts: selectedChannels.map((ch: any) => ({
          group,
          integration: { id: ch.id },
          settings: {
            __type: ch.identifier,
            title: text.slice(0, 80),
            tags: [] as any[],
            subreddit: [] as any[],
          },
          value: [
            {
              id: '',
              content: text,
              delay: 0,
              image,
            },
          ],
        })),
      };

      const response = await fetch('/posts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = genericError;
        try {
          const data = await response.json();
          if (data && typeof data.message === 'string') {
            message = data.message;
          }
        } catch {
          // keep the generic message
        }
        toaster.show(message, 'warning');
        return;
      }

      toaster.show(t('capture_draft_saved', 'Draft saved'), 'success');
      setText('');
      setMediaUrl('');
      setUploadedMedia(null);
    } catch {
      toaster.show(genericError, 'warning');
    } finally {
      setSubmitting(false);
    }
  }, [
    channels,
    selectedIds,
    text,
    mediaUrl,
    uploadedMedia,
    submitting,
    fetch,
    toaster,
    t,
  ]);

  const isDisabled = submitting || !text.trim() || selectedIds.length === 0;

  return (
    <div className="w-full max-w-[640px] mx-auto p-[16px] sm:p-[24px] flex flex-col gap-[20px]">
      <div className="flex flex-col gap-[8px]">
        <h1 className="text-[24px] font-[600] text-textColor">
          {t('quick_capture', 'Quick capture')}
        </h1>
        <p className="text-[14px] text-customColor18">
          {t(
            'quick_capture_description',
            'This saves a draft to the selected channels. It is web capture, not a native app — you can edit or schedule the draft later from the calendar.'
          )}
        </p>
      </div>

      <div className="flex flex-col gap-[8px]">
        <label
          htmlFor="capture-text"
          className="text-[14px] font-[500] text-textColor"
        >
          {t('capture_post_text', 'Post text')}
        </label>
        <textarea
          id="capture-text"
          className="w-full min-h-[140px] p-[12px] rounded-[8px] bg-input border border-tableBorder text-textColor text-[16px] resize-y"
          placeholder={t(
            'capture_post_text_placeholder',
            'Write your post...'
          )}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="text-[12px] text-customColor18 text-right">
          {text.length} {t('capture_characters', 'characters')}
        </div>
      </div>

      <div className="flex flex-col gap-[8px]">
        <label
          htmlFor="capture-media-url"
          className="text-[14px] font-[500] text-textColor"
        >
          {t('capture_media_url', 'Media URL')}
        </label>
        <input
          id="capture-media-url"
          type="text"
          inputMode="url"
          className="w-full h-[48px] px-[12px] rounded-[8px] bg-input border border-tableBorder text-textColor text-[16px]"
          placeholder={t(
            'capture_media_url_placeholder',
            'https://example.com/image.jpg (optional)'
          )}
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
        />
        <div className="flex items-center gap-[12px]">
          <label
            htmlFor="capture-media-upload"
            className="inline-flex items-center justify-center h-[40px] px-[16px] rounded-[8px] border border-tableBorder text-[14px] font-[500] text-textColor cursor-pointer hover:border-textColor/30"
          >
            {uploading
              ? t('loading', 'Loading...')
              : t('capture_upload_media', 'Upload media')}
          </label>
          <input
            id="capture-media-upload"
            type="file"
            accept="image/*,video/mp4"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </div>
        {uploadedMedia ? (
          <div className="flex items-center gap-[12px]">
            <img
              src={uploadedMedia.path}
              className="h-12 w-12 object-cover rounded"
              alt=""
            />
            <button
              type="button"
              className="text-[14px] font-[500] text-textColor cursor-pointer"
              onClick={() => setUploadedMedia(null)}
            >
              {t('capture_remove_media', 'Remove')}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-[8px]">
        <div className="text-[14px] font-[500] text-textColor">
          {t('capture_channels', 'Channels')}
        </div>
        {groups.length > 1 ? (
          <div className="flex flex-col gap-[8px]">
            <label
              htmlFor="capture-group"
              className="text-[14px] font-[500] text-textColor"
            >
              {t('capture_group', 'Client group')}
            </label>
            <select
              id="capture-group"
              className="w-full h-[48px] px-[12px] rounded-[8px] bg-input border border-tableBorder text-textColor text-[16px]"
              value={groupFilter}
              onChange={handleGroupChange}
            >
              <option value="">
                {t('capture_all_groups', 'All groups')}
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {isLoading ? (
          <div className="text-[14px] text-customColor18 animate-pulse">
            {t('loading', 'Loading...')}
          </div>
        ) : channels.length === 0 ? (
          <div className="p-[16px] rounded-[8px] bg-sixth border border-fifth text-[14px] text-customColor18">
            {t(
              'capture_no_channels',
              'No channels connected yet. Connect a channel first, then come back here to save a draft.'
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {displayedChannels.map((ch: any) => {
              const selected = selectedIds.includes(ch.id);
              return (
                <label
                  key={ch.id}
                  className={clsx(
                    'flex items-center gap-[12px] min-h-[52px] p-[12px] rounded-[8px] border cursor-pointer transition-all',
                    selected
                      ? 'border-forth bg-forth/10'
                      : 'border-tableBorder hover:border-textColor/30'
                  )}
                >
                  <input
                    type="checkbox"
                    className="w-[20px] h-[20px] shrink-0 cursor-pointer"
                    checked={selected}
                    onChange={() => toggleChannel(ch.id)}
                  />
                  {ch.picture ? (
                    <img
                      src={ch.picture}
                      className="w-[32px] h-[32px] rounded-full shrink-0"
                      alt=""
                    />
                  ) : null}
                  <span className="text-[15px] text-textColor flex-1 min-w-0 truncate">
                    {ch.name}
                  </span>
                  <PlatformIcon
                    identifier={ch.identifier}
                    size={18}
                    className="shrink-0"
                    iconClassName="w-[18px] h-[18px] rounded-[4px]"
                  />
                </label>
              );
            })}
          </div>
        )}
      </div>

      <Button
        onClick={handleSave}
        loading={submitting}
        disabled={isDisabled}
        className="rounded-[8px] w-full"
      >
        {t('capture_save_draft', 'Save draft')}
      </Button>
    </div>
  );
};
