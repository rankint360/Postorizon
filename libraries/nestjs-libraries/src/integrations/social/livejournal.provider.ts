import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { createHash } from 'crypto';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { LivejournalSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/livejournal.settings.dto';

const md5 = (value: string) =>
  createHash('md5').update(value).digest('hex');

const xmlValue = (xml: string, name: string): string | undefined => {
  const match = xml.match(
    new RegExp(
      `<name>${name}</name>\\s*<value>(?:<string>|<int>|<i4>)?([^<]+)`
    )
  );
  return match?.[1];
};

/**
 * Postorizon Phase 2 — Web2 syndication pack: LiveJournal.
 * LiveJournal's API predates OAuth: login is validated with the XML-RPC
 * challenge-response flow (md5(challenge + md5(password))), and posting
 * uses the documented flat protocol (mode=postevent) with the md5-hashed
 * password. Like WordPress, the connection fields travel in the
 * integration token (the base64 payload from the custom-fields flow).
 */
export class LivejournalProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'livejournal';
  name = 'LiveJournal';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [] as string[];
  maxLength() {
    return 60000;
  }
  dto = LivejournalSettingsDto;

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
        key: 'username',
        label: 'Username',
        validation: `/^.{3,}$/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Password',
        validation: `/^.{6,}$/`,
        type: 'password' as const,
      },
    ];
  }

  private async xmlRpc(method: string, struct: Record<string, string>) {
    const members = Object.entries(struct)
      .map(
        ([key, value]) =>
          `<member><name>${key}</name><value><string>${value}</string></value></member>`
      )
      .join('');
    const response = await fetch('https://www.livejournal.com/interface/xmlrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params><param><value><struct>${members}</struct></value></param></params></methodCall>`,
    });
    return response.text();
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString());
    try {
      const challengeXml = await this.xmlRpc('LJ.XMLRPC.getchallenge', {});
      const challenge = xmlValue(challengeXml, 'challenge');
      if (!challenge) {
        return 'Invalid credentials';
      }

      const loginXml = await this.xmlRpc('LJ.XMLRPC.login', {
        username: body.username,
        auth_method: 'challenge',
        auth_challenge: challenge,
        auth_response: md5(challenge + md5(body.password)),
        ver: '1',
      });
      if (loginXml.indexOf('faultString') > -1) {
        return 'Invalid credentials';
      }
      const fullname = xmlValue(loginXml, 'fullname');
      const userid = xmlValue(loginXml, 'userid');
      if (!fullname && !userid) {
        return 'Invalid credentials';
      }

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        // WordPress precedent: the connection fields are the token.
        accessToken: params.code,
        id: userid || body.username,
        name: fullname || body.username,
        picture: '',
        username: body.username,
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
    const { settings } = postDetails?.[0] || { settings: {} };
    const now = dayjs();

    const form = new URLSearchParams({
      mode: 'postevent',
      user: body.username,
      hpassword: md5(body.password),
      event: postDetails?.[0].message || '',
      subject: settings?.title || '',
      year: now.format('YYYY'),
      mon: now.format('MM'),
      day: now.format('DD'),
      hour: now.format('HH'),
      min: now.format('mm'),
      security: 'public',
    });

    const responseText = await (
      await this.fetch('https://www.livejournal.com/interface/flat', {
        method: 'POST',
        body: form.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    ).text();

    const result: Record<string, string> = {};
    for (const line of responseText.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }

    if (result.success !== 'OK') {
      throw new Error(
        `LiveJournal publishing failed: ${result.errmsg || 'unknown error'}`
      );
    }

    const itemId = parseInt(result.itemid || '0', 10);
    const anum = parseInt(result.anum || '0', 10);
    const username = body.username.replace(/_/g, '-');
    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: String(itemId),
        releaseURL: `https://${username}.livejournal.com/${itemId * 256 + anum}.html`,
      },
    ];
  }
}
