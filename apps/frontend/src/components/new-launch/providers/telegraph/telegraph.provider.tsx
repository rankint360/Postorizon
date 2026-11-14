'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TelegraphSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/telegraph.settings.dto';
import { Input } from '@gitroom/react/form/input';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';

const TelegraphSettings: FC = () => {
  const form = useSettings();
  return (
    <>
      <Input label="Title" {...form.register('title')} />
      <Input
        label="Backlink URL (optional)"
        {...form.register('backlinkUrl')}
      />
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TelegraphSettings,
  CustomPreviewComponent: undefined,
  dto: TelegraphSettingsDto,
  maximumCharacters: 60000,
});
