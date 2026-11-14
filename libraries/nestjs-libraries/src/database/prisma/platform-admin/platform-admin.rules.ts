// Postorizon Phase 6 — pure decision logic for the platform admin
// console. This module intentionally has NO Nest/Prisma imports so the
// rules can be unit-executed against transpiled code (the Phase 5
// verification pattern) and reused identically by the API service and
// the CLI bootstrap commands.

// ---------------------------------------------------------------------------
// User-action safeguards
// ---------------------------------------------------------------------------

export interface AdminTargetUser {
  id: string;
  isPlatformAdmin: boolean;
  suspendedAt: Date | null;
}

export type GuardedUserAction = 'suspend' | 'revokeAdmin';

/**
 * Returns an error message when the action must be refused, else null.
 *
 * Rules (Phase 6 spec):
 * - an admin cannot suspend or demote THEMSELVES;
 * - the LAST active platform admin cannot be demoted or suspended
 *   (`activePlatformAdminCount` counts admins that are neither deleted
 *   nor suspended — a suspended admin cannot operate the console, so
 *   they do not count as a remaining operator).
 */
export function guardUserAction(params: {
  actorId: string;
  action: GuardedUserAction;
  target: AdminTargetUser;
  activePlatformAdminCount: number;
}): string | null {
  const { actorId, action, target, activePlatformAdminCount } = params;
  if (action === 'suspend') {
    if (target.id === actorId) {
      return 'You cannot suspend your own account.';
    }
    if (target.isPlatformAdmin && activePlatformAdminCount <= 1) {
      return 'This user is the last active platform admin and cannot be suspended.';
    }
    return null;
  }
  // revokeAdmin
  if (target.id === actorId) {
    return 'You cannot revoke your own platform admin access.';
  }
  if (target.isPlatformAdmin && activePlatformAdminCount <= 1) {
    return 'This user is the last active platform admin and cannot be demoted.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Integration health aggregation (input rows are IntegrationHealthService
// output — the derivation of tokenState / recentErrorCount stays there;
// this only aggregates, it does not fork the logic)
// ---------------------------------------------------------------------------

export interface IntegrationHealthLike {
  providerIdentifier: string;
  tokenState: 'ok' | 'expiring_soon' | 'expired' | 'unknown';
  recentErrorCount: number;
}

export interface ProviderHealthRollup {
  providerIdentifier: string;
  connected: number;
  errors30d: number;
  tokenStates: {
    ok: number;
    expiring_soon: number;
    expired: number;
    unknown: number;
  };
}

export function aggregateProviderHealth(
  rows: IntegrationHealthLike[]
): ProviderHealthRollup[] {
  const byProvider = new Map<string, ProviderHealthRollup>();
  for (const row of rows) {
    let entry = byProvider.get(row.providerIdentifier);
    if (!entry) {
      entry = {
        providerIdentifier: row.providerIdentifier,
        connected: 0,
        errors30d: 0,
        tokenStates: { ok: 0, expiring_soon: 0, expired: 0, unknown: 0 },
      };
      byProvider.set(row.providerIdentifier, entry);
    }
    entry.connected += 1;
    entry.errors30d += row.recentErrorCount || 0;
    entry.tokenStates[row.tokenState] += 1;
  }
  return [...byProvider.values()].sort((a, b) =>
    a.providerIdentifier.localeCompare(b.providerIdentifier)
  );
}

// ---------------------------------------------------------------------------
// Provider credential configuration (SET / UNSET only — never values)
//
// Social providers declare NO env-key list anywhere (validateEnvKeys
// exists only on the email providers). Each provider reads process.env
// inline in generateAuthUrl()/authenticate(). This map was derived by
// auditing those reads provider-by-provider (Phase 6 research); it must
// be updated when a provider's reads change. Providers with an empty
// list take per-user credentials (app passwords, user API tokens,
// per-site keys) and need no platform-level configuration.
// ---------------------------------------------------------------------------

export interface ProviderEnvKeys {
  keys: string[];
  // Alternative key set that also satisfies the provider (gmb falls
  // back to the YouTube Google app when its own keys are unset).
  fallbackKeys?: string[];
}

export const PROVIDER_ENV_KEYS: Record<string, ProviderEnvKeys> = {
  x: { keys: ['X_API_KEY', 'X_API_SECRET'] },
  linkedin: { keys: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'] },
  'linkedin-page': {
    keys: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  },
  reddit: { keys: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'] },
  instagram: { keys: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] },
  'instagram-standalone': {
    keys: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  },
  facebook: { keys: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] },
  threads: { keys: ['THREADS_APP_ID', 'THREADS_APP_SECRET'] },
  youtube: { keys: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'] },
  gmb: {
    keys: ['GOOGLE_GMB_CLIENT_ID', 'GOOGLE_GMB_CLIENT_SECRET'],
    fallbackKeys: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
  },
  tiktok: { keys: ['TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'] },
  'tiktok-business': {
    keys: ['TIKTOK_BUSINESS_CLIENT_ID', 'TIKTOK_BUSINESS_CLIENT_SECRET'],
  },
  pinterest: { keys: ['PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET'] },
  dribbble: { keys: ['DRIBBBLE_CLIENT_ID', 'DRIBBBLE_CLIENT_SECRET'] },
  discord: {
    keys: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN_ID'],
  },
  slack: { keys: ['SLACK_ID', 'SLACK_SECRET'] },
  kick: { keys: ['KICK_CLIENT_ID', 'KICK_SECRET'] },
  twitch: { keys: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'] },
  mastodon: {
    keys: ['MASTODON_URL', 'MASTODON_CLIENT_ID', 'MASTODON_CLIENT_SECRET'],
  },
  wrapcast: {
    keys: [
      'NEYNAR_CLIENT_ID',
      'NEYNAR_SECRET_KEY',
      'NEYNAR_APP_FID',
      'NEYNAR_APP_MNEMONIC',
      'NEYNAR_SPONSOR_SIGNERS',
    ],
  },
  telegram: { keys: ['TELEGRAM_TOKEN'] },
  vk: { keys: ['VK_ID'] },
  whop: { keys: ['WHOP_CLIENT_ID'] },
  mewe: { keys: ['MEWE_APP_ID', 'MEWE_API_KEY', 'MEWE_HOST'] },
  tumblr: { keys: ['TUMBLR_CLIENT_ID', 'TUMBLR_CLIENT_SECRET'] },
  // Per-user credentials only — no platform-level keys.
  bluesky: { keys: [] },
  lemmy: { keys: [] },
  nostr: { keys: [] },
  medium: { keys: [] },
  devto: { keys: [] },
  hashnode: { keys: [] },
  wordpress: { keys: [] },
  listmonk: { keys: [] },
  moltbook: { keys: [] },
  skool: { keys: [] },
  telegraph: { keys: [] },
  microblog: { keys: [] },
  ghost: { keys: [] },
  livejournal: { keys: [] },
};

export interface ProviderCredentialStatus {
  providerIdentifier: string;
  // null = no platform-level credentials exist for this provider
  configured: boolean | null;
  keys: { key: string; set: boolean }[];
}

export function deriveProviderCredentialStatus(
  providerIdentifier: string,
  env: Record<string, string | undefined>
): ProviderCredentialStatus {
  const entry = PROVIDER_ENV_KEYS[providerIdentifier] || { keys: [] };
  const keys = entry.keys.map((key) => ({ key, set: !!env[key] }));
  if (!entry.keys.length) {
    return { providerIdentifier, configured: null, keys };
  }
  let configured = keys.every((k) => k.set);
  if (!configured && entry.fallbackKeys?.length) {
    configured = entry.fallbackKeys.every((key) => !!env[key]);
  }
  return { providerIdentifier, configured, keys };
}

// ---------------------------------------------------------------------------
// Email / storage configuration status (names of missing keys only)
// ---------------------------------------------------------------------------

export interface ServiceConfigStatus {
  provider: string;
  configured: boolean;
  missingKeys: string[];
}

/**
 * Mirrors EmailService.sendEmailSync's real requirements: a selected
 * provider (not EmptyProvider), every key in that provider's own
 * validateEnvKeys, plus EMAIL_FROM_ADDRESS / EMAIL_FROM_NAME, without
 * which sendEmailSync silently returns without sending.
 */
export function deriveEmailConfigStatus(params: {
  providerName: string;
  validateEnvKeys: string[];
  env: Record<string, string | undefined>;
}): ServiceConfigStatus {
  const { providerName, validateEnvKeys, env } = params;
  const required = [...validateEnvKeys, 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'];
  const missingKeys = required.filter((key) => !env[key]);
  return {
    provider: providerName,
    configured: providerName !== 'no provider' && missingKeys.length === 0,
    missingKeys,
  };
}

// Key sets mirror UploadFactory.createStorage
// (libraries/nestjs-libraries/src/upload/upload.factory.ts).
export const STORAGE_CLOUDFLARE_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_ACCESS_KEY',
  'CLOUDFLARE_SECRET_ACCESS_KEY',
  'CLOUDFLARE_REGION',
  'CLOUDFLARE_BUCKETNAME',
  'CLOUDFLARE_BUCKET_URL',
];

export function deriveStorageConfigStatus(
  env: Record<string, string | undefined>
): ServiceConfigStatus {
  const provider = env.STORAGE_PROVIDER || 'local';
  if (provider === 'cloudflare') {
    const missingKeys = STORAGE_CLOUDFLARE_KEYS.filter((key) => !env[key]);
    return { provider, configured: missingKeys.length === 0, missingKeys };
  }
  if (provider === 'local') {
    const missingKeys = env.UPLOAD_DIRECTORY ? [] : ['UPLOAD_DIRECTORY'];
    return { provider, configured: missingKeys.length === 0, missingKeys };
  }
  // UploadFactory throws for anything else — report as not configured.
  return { provider, configured: false, missingKeys: [] };
}
