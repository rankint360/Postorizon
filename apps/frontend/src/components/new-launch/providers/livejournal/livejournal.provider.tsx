'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { LivejournalSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/livejournal.settings.dto';
import { Input } from '@gitroom/react/form/input';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';

const LivejournalSettings: FC = () => {
  const form = useSettings();
  return (
    <>
      <Input label="Subject (optional)" {...form.register('title')} />
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: LivejournalSettings,
  CustomPreviewComponent: undefined,
  dto: LivejournalSettingsDto,
  maximumCharacters: 60000,
});
