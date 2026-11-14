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
import { TelegraphSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/telegraph.settings.dto';

/**
 * Postorizon Phase 2 — Web2 syndication pack: Telegraph (telegra.ph).
 * API-token auth: the user pastes an access token from the Telegraph API
 * (https://telegra.ph/api). Pages are created with the public createPage
 * endpoint; post text is converted to Telegraph paragraph nodes.
 */
export class TelegraphProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'telegraph';
  name = 'Telegraph';
  isBetweenSteps = false;
  editor = 'markdown' as const;
  scopes = [] as string[];
  maxLength() {
    return 60000;
  }
  dto = TelegraphSettingsDto;

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
        key: 'accessToken',
        label: 'Access token',
        hint: 'Create one via the Telegraph API (createAccount) and paste the access_token here',
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
      const account = await (
        await fetch(
          `https://api.telegra.ph/getAccountInfo?access_token=${encodeURIComponent(
            body.accessToken
          )}&fields=${encodeURIComponent(
            JSON.stringify(['short_name', 'author_name'])
          )}`
        )
      ).json();

      if (!account?.ok) {
        return 'Invalid credentials';
      }

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: body.accessToken,
        id: account.result.short_name,
        name: account.result.author_name || account.result.short_name,
        picture: '',
        username: account.result.short_name,
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

    const content: any[] = (postDetails?.[0].message || '')
      .split(/\n{2,}/)
      .map((p: string) => p.trim())
      .filter(Boolean)
      .map((paragraph: string) => ({
        tag: 'p',
        children: [paragraph.replace(/\n/g, ' ')],
      }));

    if (settings?.backlinkUrl) {
      content.push({
        tag: 'p',
        children: [
          'Originally published at ',
          {
            tag: 'a',
            attrs: { href: settings.backlinkUrl },
            children: [settings.backlinkUrl],
          },
        ],
      });
    }

    const result = await (
      await this.fetch(`https://api.telegra.ph/createPage`, {
        method: 'POST',
        body: JSON.stringify({
          access_token: accessToken,
          title: settings.title,
          content: JSON.stringify(content),
          return_content: false,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      })
    ).json();

    if (!result?.ok) {
      throw new Error(
        `Telegraph publishing failed: ${result?.error || 'unknown error'}`
      );
    }

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: result.result.path,
        releaseURL: result.result.url,
      },
    ];
  }
}
