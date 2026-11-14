import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { MicroblogSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/microblog.settings.dto';

/**
 * Postorizon Phase 2 — Web2 syndication pack: Micro.blog.
 * App-token auth (Micro.blog → Settings → App tokens). Publishing goes
 * through the Micropub endpoint; the created post URL comes back in the
 * Location response header.
 */
export class MicroblogProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'microblog';
  name = 'Micro.blog';
  isBetweenSteps = false;
  editor = 'markdown' as const;
  scopes = [] as string[];
  maxLength() {
    return 100000;
  }
  dto = MicroblogSettingsDto;

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async customFields() {
    return [
      {
        key: 'token',
        label: 'App token',
        hint: 'Micro.blog → Settings → App tokens',
        validation: `/^.{10,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString());
    try {
      const verify = await (
        await fetch('https://micro.blog/account/verify', {
          headers: {
            Authorization: `Bearer ${body.token}`,
          },
        })
      ).json();

      if (!verify?.username) {
        return 'Invalid credentials';
      }

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: body.token,
        id: verify.username,
        name: verify.name || verify.username,
        picture: verify.avatar_url || '',
        username: verify.username,
      };
    } catch (err) {
      return 'Invalid credentials';
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const { settings } = postDetails?.[0] || { settings: {} };

    const response = await this.fetch(`https://micro.blog/micropub`, {
      method: 'POST',
      body: JSON.stringify({
        type: ['h-entry'],
        properties: {
          ...(settings?.title ? { name: [settings.title] } : {}),
          content: [postDetails?.[0].message],
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status >= 400) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `Micro.blog publishing failed (${response.status}): ${errorBody.slice(0, 200)}`
      );
    }

    const releaseURL = response.headers.get('location') || '';
    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: releaseURL || postDetails?.[0].id,
        releaseURL,
      },
    ];
  }
}
