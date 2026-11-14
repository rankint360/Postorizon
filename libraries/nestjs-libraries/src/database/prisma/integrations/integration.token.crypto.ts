import { AuthService } from '@gitroom/helpers/auth/auth.service';

// Phase 5 — integration tokens encrypted at rest (SECURITY_AUDIT.md (b)).
//
// Integration.token / Integration.refreshToken were stored as plaintext on
// every write path. They are now stored as:
//
//     enc:v1:<fixedEncryption hex>
//
// using the repo's existing AES-256-CBC helper (the same one that already
// protects BYOK AI keys, OAuth-app secrets and org API keys). The prefix
// makes stored values self-describing, which is what makes the migration
// lazy and safe:
//
// - writes encrypt (IntegrationRepository.createOrUpdateIntegration /
//   updateIntegration are the only write funnels),
// - reads decrypt ONLY prefixed values and pass legacy plaintext through
//   unchanged, so un-migrated rows keep working,
// - any write/refresh of a legacy row re-stores it encrypted, so rows
//   migrate organically; IntegrationRepository
//   .encryptPlaintextIntegrationTokens() backfills whatever is left.
//
// Providers receive plaintext in memory exactly as before: repository read
// methods return decrypted rows, and only the database holds ciphertext.
export const INTEGRATION_TOKEN_ENCRYPTION_PREFIX = 'enc:v1:';

// Providers whose authenticate() already returns fixedEncryption ciphertext
// as the access token. Skool is the known case (skool.provider.ts encrypts
// the cookie blob itself); the provider never reads Integration.token — it
// decrypts customInstanceDetails instead. Encrypting such a value again
// would double-encrypt it, so it is stored exactly as returned and, having
// no prefix, passes through reads untouched.
const PRE_ENCRYPTED_TOKEN_PROVIDERS = new Set(['skool']);

export function encryptIntegrationToken(
  providerIdentifier: string | undefined,
  value: string | null | undefined
): string | null | undefined {
  if (!value) {
    return value;
  }
  if (value.startsWith(INTEGRATION_TOKEN_ENCRYPTION_PREFIX)) {
    return value;
  }
  if (
    providerIdentifier &&
    PRE_ENCRYPTED_TOKEN_PROVIDERS.has(providerIdentifier)
  ) {
    return value;
  }
  return (
    INTEGRATION_TOKEN_ENCRYPTION_PREFIX + AuthService.fixedEncryption(value)
  );
}

export function decryptIntegrationToken(
  value: string | null | undefined
): string | null | undefined {
  if (!value || !value.startsWith(INTEGRATION_TOKEN_ENCRYPTION_PREFIX)) {
    return value;
  }
  try {
    return AuthService.fixedDecryption(
      value.slice(INTEGRATION_TOKEN_ENCRYPTION_PREFIX.length)
    );
  } catch (err) {
    // A prefixed value that does not decrypt (e.g. JWT_SECRET was rotated)
    // must not take down every integration read with it. Return the stored
    // value, matching the pre-Phase-5 behaviour for that row; the provider
    // call then fails as an ordinary auth error instead of a 500 here.
    console.error('Could not decrypt integration token', err);
    return value;
  }
}

export function isEncryptedIntegrationToken(
  value: string | null | undefined
): boolean {
  return !!value && value.startsWith(INTEGRATION_TOKEN_ENCRYPTION_PREFIX);
}

// Decrypts token/refreshToken of a loaded Integration row in place and
// returns it, so read funnels can hand providers the plaintext object they
// have always received.
export function decryptIntegrationTokens<
  T extends { token?: string | null; refreshToken?: string | null }
>(integration: T | null | undefined): T | null | undefined {
  if (!integration) {
    return integration;
  }
  if (typeof integration.token === 'string') {
    integration.token = decryptIntegrationToken(integration.token);
  }
  if (typeof integration.refreshToken === 'string') {
    integration.refreshToken = decryptIntegrationToken(
      integration.refreshToken
    );
  }
  return integration;
}
