'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { MicroblogSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/microblog.settings.dto';
import { Input } from '@gitroom/react/form/input';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';

const MicroblogSettings: FC = () => {
  const form = useSettings();
  return (
    <>
      <Input label="Title (optional)" {...form.register('title')} />
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: MicroblogSettings,
  CustomPreviewComponent: undefined,
  dto: MicroblogSettingsDto,
  maximumCharacters: 100000,
});
