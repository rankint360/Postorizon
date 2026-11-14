import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';

/**
 * Meta data-deletion request callback (DEVELOPER_APPS_PACK.md §1/§11).
 *
 * When a user removes Postorizon from their Facebook/Instagram settings,
 * Meta POSTs a `signed_request` form field here. The signature is
 * HMAC-SHA256 over the payload part, keyed with the app secret — read
 * from `FACEBOOK_APP_SECRET`, the exact env var and access pattern the
 * Facebook provider itself uses (facebook.provider.ts). Verified
 * requests get Meta's expected JSON back: a status-page URL (the
 * /data-deletion instructions page) and a confirmation code.
 *
 * Recording is deliberately minimal: the request is logged (Meta user
 * id + confirmation code) and the code is deterministically derived from
 * the signed payload (user_id + issued_at) via HMAC with the app secret,
 * so support can re-derive and trace a code from the logs without a
 * database table. LIMITATION: there is no persisted deletion-request
 * record and no per-code status lookup — the status page is the static
 * instructions page. If per-request tracking is ever required, add a
 * model and store { code, userId, receivedAt } here.
 *
 * Registered outside the authenticated controller list in ApiModule,
 * like the other public controllers, so AuthMiddleware never runs.
 * Externally reachable (via nginx's /api strip) as
 * POST /api/public/meta/data-deletion — that is the URL to enter as the
 * Data Deletion Request Callback in the Meta app settings.
 */
@ApiTags('Meta data deletion (public callback)')
@Controller('/public/meta')
@UseGuards(ThrottlerRealIpGuard)
@Throttle({ default: { limit: 60, ttl: 3600000 } })
export class PublicMetaDataDeletionController {
  private readonly _logger = new Logger(
    PublicMetaDataDeletionController.name
  );

  @Post('/data-deletion')
  async dataDeletion(@Body('signed_request') signedRequest?: string) {
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      this._logger.error(
        'Meta data-deletion callback hit but FACEBOOK_APP_SECRET is not set'
      );
      throw new HttpException(
        'Data deletion callback is not configured',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    if (!signedRequest || typeof signedRequest !== 'string') {
      throw new HttpException(
        'Missing signed_request',
        HttpStatus.BAD_REQUEST
      );
    }

    const payload = this._parseAndVerify(signedRequest, appSecret);
    const userId = payload?.user_id;
    if (!userId) {
      throw new HttpException(
        'signed_request payload has no user_id',
        HttpStatus.BAD_REQUEST
      );
    }

    const confirmationCode = createHmac('sha256', appSecret)
      .update(`data-deletion:${userId}:${payload.issued_at ?? ''}`)
      .digest('hex')
      .slice(0, 32);

    this._logger.log(
      `Meta data-deletion request: user_id=${userId} confirmation_code=${confirmationCode}`
    );

    const mainUrl = (
      process.env.MAIN_URL || 'https://postorizon.com'
    ).replace(/\/$/, '');
    return {
      url: `${mainUrl}/data-deletion?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }

  /**
   * Meta signed_request format:
   *   <base64url(HMAC-SHA256 signature)>.<base64url(JSON payload)>
   * The signature is computed over the payload part exactly as received.
   * Returns the decoded payload, or throws 401/400.
   */
  private _parseAndVerify(signedRequest: string, appSecret: string) {
    const parts = signedRequest.split('.');
    if (parts.length !== 2) {
      throw new HttpException(
        'Malformed signed_request',
        HttpStatus.BAD_REQUEST
      );
    }
    const [encodedSignature, encodedPayload] = parts;

    const expectedSignature = createHmac('sha256', appSecret)
      .update(encodedPayload)
      .digest();
    let actualSignature: Buffer;
    try {
      actualSignature = Buffer.from(encodedSignature, 'base64url');
    } catch {
      throw new HttpException(
        'Malformed signed_request signature',
        HttpStatus.BAD_REQUEST
      );
    }
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new HttpException(
        'signed_request signature verification failed',
        HttpStatus.UNAUTHORIZED
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8')
      );
    } catch {
      throw new HttpException(
        'Malformed signed_request payload',
        HttpStatus.BAD_REQUEST
      );
    }
    if (payload?.algorithm !== 'HMAC-SHA256') {
      throw new HttpException(
        'Unexpected signed_request algorithm',
        HttpStatus.BAD_REQUEST
      );
    }
    return payload;
  }
}
