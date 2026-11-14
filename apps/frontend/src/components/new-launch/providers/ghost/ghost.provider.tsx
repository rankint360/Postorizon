'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { GhostSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/ghost.settings.dto';
import { Input } from '@gitroom/react/form/input';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { Canonical } from '@gitroom/react/form/canonical';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';

const GhostSettings: FC = () => {
  const form = useSettings();
  const { date } = useIntegration();
  return (
    <>
      <Input label="Title" {...form.register('title')} />
      <Canonical
        date={date}
        label="Canonical Link"
        {...form.register('canonical')}
      />
      <MediaComponent
        label="Cover picture"
        description="Add a cover picture"
        {...form.register('main_image')}
      />
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: GhostSettings,
  CustomPreviewComponent: undefined,
  dto: GhostSettingsDto,
  maximumCharacters: 100000,
});
