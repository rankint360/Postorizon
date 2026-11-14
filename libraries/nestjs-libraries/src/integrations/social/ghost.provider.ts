import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { createHmac } from 'crypto';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { GhostSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/ghost.settings.dto';

/**
 * Postorizon Phase 2 — Web2 syndication pack: Ghost (Admin API).
 * Auth: the site's Admin API key (id:secret) from Ghost Admin →
 * Settings → Integrations. Requests are authenticated with a short-lived
 * HS256 JWT signed with the key secret (Ghost's documented scheme),
 * built here with Node's crypto — no new dependencies. Like WordPress,
 * the connection fields travel in the integration token (the base64
 * payload produced by the custom-fields flow).
 */
export class GhostProvider extends SocialAbstract implements SocialProvider {
  identifier = 'ghost';
  name = 'Ghost';
  isBetweenSteps = false;
  editor = 'html' as const;
  scopes = [] as string[];
  maxLength() {
    return 100000;
  }
  dto = GhostSettingsDto;

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
        key: 'siteUrl',
        label: 'Site URL',
        hint: 'e.g. https://yourblog.ghost.io',
        validation: `/^https?:\\/\\/.{3,}$/`,
        type: 'text' as const,
      },
      {
        key: 'adminApiKey',
        label: 'Admin API key',
        hint: 'Ghost Admin → Settings → Integrations → custom integration (looks like id:secret)',
        validation: `/^[a-f0-9]{24}:[a-f0-9]{64}$/`,
        type: 'password' as const,
      },
    ];
  }

  private siteRoot(siteUrl: string) {
    return siteUrl.replace(/\/+$/, '');
  }

  private adminToken(adminApiKey: string): string {
    const [keyId, secret] = adminApiKey.split(':');
    const now = Math.floor(Date.now() / 1000);
    const encode = (obj: object) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT', kid: keyId })}.${encode(
      { iat: now, exp: now + 300, aud: '/admin/' }
    )}`;
    const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(unsigned)
      .digest('base64url');
    return `${unsigned}.${signature}`;
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString());
    try {
      const root = this.siteRoot(body.siteUrl);
      const response = await fetch(`${root}/ghost/api/admin/site/`, {
        headers: {
          Authorization: `Ghost ${this.adminToken(body.adminApiKey)}`,
        },
      });
      if (!response.ok) {
        return 'Invalid credentials';
      }
      const { site } = await response.json();

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        // WordPress precedent: the connection fields are the token.
        accessToken: params.code,
        id: root,
        name: site?.title || root,
        picture: site?.icon || site?.logo || '',
        username: root.replace(/^https?:\/\//, ''),
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
    const body = JSON.parse(Buffer.from(accessToken, 'base64').toString());
    const root = this.siteRoot(body.siteUrl);
    const { settings } = postDetails?.[0] || { settings: {} };

    const response = await (
      await this.fetch(`${root}/ghost/api/admin/posts/?source=html`, {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              title: settings.title,
              html: postDetails?.[0].message,
              status: 'published',
              ...(settings?.main_image?.path
                ? { feature_image: settings.main_image.path }
                : {}),
              ...(settings?.canonical
                ? { canonical_url: settings.canonical }
                : {}),
            },
          ],
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Ghost ${this.adminToken(body.adminApiKey)}`,
        },
      })
    ).json();

    const created = response?.posts?.[0];
    if (!created?.id) {
      throw new Error(
        `Ghost publishing failed: ${
          response?.errors?.[0]?.message || 'unknown error'
        }`
      );
    }

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: String(created.id),
        releaseURL: created.url,
      },
    ];
  }
}
