# Postorizon — Phase 5 Build Report (security hardening)

- **Branch:** `postorizon/phase-5`, based on `postorizon/phase-4` (d22a441,
  CI-green). **2 code commits** — Item A `fc8d442` (6 files), Item B
  `d4044d2` (8 files) — plus this report and the SECURITY_AUDIT.md
  addendum. Local only at time of writing — the parent pushes, then CI is
  the authoritative compile check (see Verification).
- **Theme:** close the two structural flags from Phase 4's
  SECURITY_AUDIT.md — (b) integration tokens stored plaintext, and
  (a) Flag 1, session tokens that never expire and cannot be revoked.
- **Rules kept:** no new dependencies; the only schema change is one
  additive column (`User.sessionEpoch`); `pricing.ts`/entitlements and
  `.github/workflows/ci.yml` untouched; no frontend files changed.

## Corrections to the Phase 4 audit's evidence

Phase 5 research (two read-only sweeps, verified first-hand before
building) found the audit's *verdicts* right but several of its file
attributions wrong. Recorded here because the seam map below depends on
them:

- There is **no `cookies.service.ts`** and **no function named `canUse`**
  on the auth path: cookie setting is inlined in `auth.controller.ts`,
  and the session signer is the backend `AuthService.jwt()`.
- There is **no `password.service.ts` and no logged-in change-password
  flow at all** — the only password-write seam is the reset path
  (`UsersRepository.updatePassword`). Item B hooks revocation there.
- The token-writing OAuth callback is
  `no.auth.integrations.controller.ts:connectSocialMedia`, not
  `integrations.controller.ts` (which only reads). **No
  `stripe.integration.service.ts` exists**; Stripe rotation uses the
  generic refresh funnel.
- There are **zero bare `new PrismaClient()`** in source: all data access
  wraps one shared `PrismaService`. The audit's "~30 bare consumers"
  mechanism was wrong — which is exactly why a repository-level boundary
  (Item A) is feasible. `IntegrationManager` holds no token logic either.

---

## Item A — Integration tokens encrypted at rest · ✅ BUILT (`fc8d442`)

### Seam map (verified exhaustively before building)

**Writes — all direct Prisma writes live in one file,**
`libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts`:

| # | Site | Notes |
|---|---|---|
| W1 | `createOrUpdateIntegration` upsert (create :389 / update :421, post-change lines) | THE funnel: connect (OAuth callback), extension cookie-refresh, token refresh, bulk refresh CLI all reach the DB here via `IntegrationService.createOrUpdateIntegration` |
| W2 | same method, `oneTimeToken` sibling `updateMany` (:453) | propagates the same token to all rows sharing `rootInternalId` — encrypts from the same stored values as W1 |
| W3 | `updateIntegration` (:166ff) | generic spread write; only caller is `saveProviderPage` (`integration.service.ts:451`) passing a page-scoped token. Its internal `fresh.refreshToken` copy-forward (:228 pre-change) is a **stored-form** value and is explicitly not re-encrypted |
| W4 | `deleteIntegrationsForAccount` | md5 anonymisation on account deletion — not a credential write; excluded from migration (rows are soft-deleted) |

**Value shapes reaching W1** (from `authenticate()` results): raw OAuth
tokens (majority); the raw OAuth `code`/form body (Ghost, LiveJournal,
WordPress); raw user API keys (dev.to, Hashnode, Medium, micro.blog,
Telegraph, Listmonk basic-auth blob, Telegram chat id, Farcaster signer
uuid); composite strings (X `token:secret`, VK `refresh&&&&device_id`,
Instagram `a___b`); a **signed JWT** (Nostr — the password wrapped by
`signJWT`); and **already-encrypted ciphertext** (Skool, §below).
Consequence: encryption is whole-string and provider-agnostic.

**Reads — providers never load rows; callers hand them the Integration
object and/or the token string.** Funnels covered: publish/comment/status
via orchestrator `post.activity` (Post-include loads, R1), refresh
(`refresh.integration.service.ts` — including its rotation-race
comparison at :106-118, which compares a re-read stored row against the
in-memory one, so **both sides must be the same representation**:
decrypted), analytics, dashboard functions/mentions, public-API and
agent/MCP tool triggers, page fetch, plugs. Several providers ignore the
string argument and read `integration.token` off the object (X,
LinkedIn Page, Threads), so decryption is applied to the **loaded row
object**, not at call sites.

### Design

- **Storage format:** `enc:v1:` + `AuthService.fixedEncryption(value)`
  (the repo's existing AES-256-CBC helper — same one protecting BYOK
  keys, OAuth secrets, org API keys). The prefix makes rows
  self-describing, which is what makes lazy migration safe: the helper's
  bare-hex output alone could not be distinguished from plaintext.
  Boundary module:
  `…/integrations/integration.token.crypto.ts:25-95`.
- **Encrypt-on-write** in W1/W2 (one computation feeding upsert +
  sibling propagation, repository :376-463) and in W3 for
  caller-supplied params only (repository :228-243; provider resolved
  from params → existing row → fresh row). Write methods return
  **decrypted** rows, restoring the exact pre-Phase-5 in-memory contract
  for every caller.
- **Decrypt-on-read** in the repository getters that return full rows —
  `getIntegrationById` (:575), `getIntegrationByInternalId` (:278),
  `needsToBeRefreshed` (:466), `getIntegrationsList` (:713), `getPlug`'s
  included integration (:141) — and in `PostsRepository` where posts are
  loaded with `integration: true`: `getPostsByGroup`, `getPost`,
  `getPostById` (posts.repository.ts:437, 494, 918). Narrow-select
  readers (channel health, admin stats, weekly-plan groups,
  webhook/since post lists) never select the token and are untouched.
  Decryption failure (e.g. JWT_SECRET rotated) returns the stored value
  instead of throwing, so one bad row cannot 500 every read.
- **Skool:** `skool.provider.ts:122` already returns
  `fixedEncryption(JSON cookies)` as its access token, and Skool never
  reads `Integration.token` (it decrypts `customInstanceDetails`).
  `encryptIntegrationToken` exempts provider `skool`: the value is
  stored byte-identical to today and, being unprefixed, passes through
  reads untouched — **no double-encryption, no behaviour change**.
  Nostr's JWT and the composite tokens are encrypted as whole strings
  and returned verbatim after one decrypt (verified in tests).

### Migration behaviour (honest)

- **Organic:** any connect / refresh / page-save re-stores that row's
  tokens encrypted. Active channels migrate on their next refresh —
  most within their token lifetime.
- **Backfill:** `IntegrationRepository.encryptPlaintextIntegrationTokens()`
  (:488) sweeps all non-deleted rows, encrypting whatever is still
  unprefixed; idempotent (re-runs are no-ops). Exposed via
  `IntegrationService.encryptStoredIntegrationTokens()` and a new
  `nestjs-command` task following the codebase's one-off job pattern:
  `apps/commands/src/tasks/encrypt.tokens.ts`, registered in
  `command.module.ts` — run once as **`integrations:encrypt-tokens`**
  after deploying Phase 5.
- **Until one of those runs, a dormant channel's tokens remain
  plaintext.** That is the accepted lazy-migration trade-off, stated
  plainly: encryption at rest is complete only after the backfill.

---

## Item B — Session expiry + revocation · ✅ BUILT (`d4044d2`)

### The trap the design had to avoid

One signer served two masters: backend `AuthService.jwt()`
(`apps/backend/src/services/auth/auth.service.ts`, pre-change :372-376)
signs the **whole User row** and its output was used both as the session
cookie **and** as the emailed activation-link token (registration), while
`signJWT` also mints reset / invite / extension / discount / enterprise
tokens and the Nostr integration credential. Two of those **depend on
having no `exp`**: the Chrome-extension token (stored in the extension,
replayed by a daily alarm) and the Nostr token (stored credential,
`expiresIn` advertised as 200 years). Any change inside `signJWT` or
`jwt()` itself would have broken them or silently time-limited
activation links (which today never expire).

### What was built

- **`signJWT` gains an optional `options` parameter**
  (`libraries/helpers/src/auth/auth.service.ts:46`). All 7 pre-existing
  call sites pass none and produce **byte-identical** tokens (verified:
  no `exp` claim, verification unchanged).
- **New session-only signer** `sessionJwt()` (backend auth.service.ts:399):
  same claim set as `jwt()` (user row minus password) **plus**
  `sessionEpoch` and `expiresIn: SESSION_TOKEN_TTL_SECONDS` (30 days,
  named constant, auth.service.ts:19). Used at all five session issuance
  sites: local login, provider login, OAuth `checkExists`, the
  registration return value, and the activation return value.
- **The registration/activation split:** the activation **email link**
  still carries the `jwt()` one-shot token (registration branch,
  resend-activation — byte-for-byte unchanged); only the value returned
  for the cookie is a session token. When activation is required the
  controller discards the returned token, so the split is invisible
  there. `activate()` signs the session token **from the fresh DB row**,
  not from the decoded activation payload — a password reset landing
  between registration and activation bumps the epoch, and signing from
  the payload (no claim → 0) would have minted a stillborn session.
- **Schema (additive only):** `User.sessionEpoch Int @default(0)`
  (schema.prisma, User model).
- **Enforcement:** `AuthMiddleware` (auth.middleware.ts:66), immediately
  after the existing user/activated gates and **before** the
  impersonation swap (so it always judges the real signed-in user):
  `(payload.sessionEpoch ?? 0) !== (user.sessionEpoch ?? 0)` → the
  existing `HttpForbiddenException` path (401 + cookie cleared by the
  exception filter — which the frontend already turns into a signed-out
  redirect; the frontend never parses the JWT, verified by grep).
  Pre-Phase-5 tokens have no claim → treated as epoch 0 → they keep
  working until the user's first revocation event.
- **Revocation hooks:**
  - `UsersRepository.updatePassword` now increments `sessionEpoch`
    atomically with the hash write (users.repository.ts:224). This is
    the sole password-write seam — it serves the reset flow today, and
    any future logged-in change-password flow that routes through it
    inherits revocation. (Account creation placeholders and the
    `switchUserCredentials` support swap deliberately do not hook it.)
  - **`POST /user/logout-all`** (users.controller.ts, beside `/logout`):
    increments the caller's epoch via
    `UsersService.incrementSessionEpoch`, then runs the normal logout
    (clears this device's cookies too). Every other device fails the
    middleware check on its next request and self-clears.
- **Cookie alignment:** the `auth` cookie's `expires` now matches the
  30-day token lifetime at all four set sites in auth.controller.ts
  (register, login, activate, OAuth-exists). The `showorg` cookies keep
  365 days — they carry an org id, not a credential.

---

## Verification

- **Parse checks:** every touched TS file passes the repo TypeScript
  `transpileModule` check (Item A: 6 files; Item B: 7 files; schema
  edit regex-verified as present and additive). Full type-checking
  happens in CI — the sandbox cannot generate the Prisma client (the
  known, stated limit; the new `sessionEpoch` field exists in the
  schema CI generates from).
- **Functional tests (real repo code, transpiled and executed):**
  - Item A crypto — 14 assertions passed: prefix format, no plaintext in
    ciphertext, round-trip, legacy passthrough, encrypt idempotency,
    Skool verbatim storage + passthrough, composite-token round-trips
    (`a:b`, `r&&&&device`, `a___b`), null/empty handling, row-level
    decrypt, corrupt-prefixed-value fallback without throwing.
  - Item B tokens — 10 assertions passed: one-shot token has **no**
    `exp` and verifies; session token carries `sessionEpoch` and
    `exp − iat = 30 days`; an expired session token is rejected with
    `TokenExpiredError`; epoch comparison semantics (missing claim → 0,
    null DB → 0, match/mismatch).
- **Relation audit:** Item B uses no Prisma relations (scalar column +
  atomic increment only); Item A uses no new relations (field-level
  transforms on rows the queries already loaded; the one extended
  `select` in `updateIntegration` adds `providerIdentifier`, an existing
  scalar on Integration).
- **Hook/context audit:** no frontend files changed; no hook or context
  return shapes touched. Backend return contracts preserved by design
  (write funnels return decrypted rows; getters return the same shapes,
  now decrypted).
- **Bare-array sweep:** no frontend code in this phase; no untyped
  object literals with array fields introduced (the sweep's `data`
  object is explicitly typed).
- **DI audit:** one new provider (`EncryptTokens` command task)
  registered in `command.module.ts`, mirroring `RefreshTokens`; it
  injects `IntegrationService`, already provided by `DatabaseModule` in
  that module. No other new injectables. Grep confirms no spec/test
  constructs `AuthService`, `AuthMiddleware`, `UsersController`,
  `IntegrationRepository` or `PostsRepository` manually.
- **Registration re-read:** `command.module.ts` providers/exports
  re-read after editing; module lists coherent.
- **Call-site census after the change:** `this.jwt(` remains at exactly
  the two one-shot sites (registration email, resend-activation);
  `signJWT(` appears at the 7 historical sites + the new `sessionJwt`
  call; the four `auth`-cookie sites use the TTL constant (the three
  remaining `24 * 365` expressions are the `showorg` cookies).

## Risks / residuals (honest list)

1. **Item A is a repository boundary, not a Prisma client extension.**
   Verified today: no code outside `IntegrationRepository` /
   `PostsRepository` reads or writes full Integration rows (remaining
   direct model access uses narrow, token-free selects). Future code
   that queries the model directly would bypass both directions —
   the systemic fix (a client extension on the shared `PrismaService`)
   remains a possible follow-up.
2. **`getIntegrationsList` returns decrypted tokens in memory**, exactly
   as it returned plaintext before Phase 5; current consumers strip
   credential fields before responding. A future caller returning rows
   raw would expose plaintext over the wire (pre-existing exposure —
   the at-rest store is what this phase fixes).
3. **The shared helper itself is unchanged:** deterministic AES-256-CBC
   with a fixed IV derived from `JWT_SECRET` (equal tokens → equal
   ciphertexts), and rotating `JWT_SECRET` makes stored tokens
   undecryptable (reads fall back to the stored ciphertext; affected
   channels need a re-connect). Same properties as the BYOK/OAuth-secret
   encryption already in production use; a rotatable key scheme is a
   separate project.
4. **Backfill sweep loads all non-deleted integrations** (4 columns) in
   one pass — fine at current scale; chunk it if the table grows very
   large. Soft-deleted (md5-anonymised) rows are excluded by design.
5. **Pre-Phase-5 session tokens are not retroactively expired.** They
   carry no `exp` and no epoch claim, so they remain valid until the
   user resets their password, uses sign-out-everywhere, or the cookie
   dies (≤365 days). **Recommended deploy cutover:** a one-time
   all-users `sessionEpoch` increment at deploy time, which logs
   everyone out once and puts every live session on Phase 5 tokens.
   Deliberately NOT done in code — forcing a global logout is the
   owner's call.
6. **Revocation is per-user, not per-session** (by design): there is no
   session list or per-device sign-out. That requires a session table —
   a clean follow-up now that the epoch seam exists.
7. `UsersController.getRequestUserId` (impersonation switch) still
   extracts the admin id without an epoch check; it only identifies the
   admin inside an already middleware-authenticated request, and `exp`
   is now enforced there by `verifyJWT` itself.
8. In `NOT_SECURED` dev mode the frontend still mirrors the token into
   a 365-day JS cookie; the token inside now dies at 30 days
   regardless. Cosmetic mismatch in a dev-only mode.
9. Everything on the parked list stays parked; `/copilot/chat` brand
   voice, deployment execution, and the launch gate are unchanged by
   this phase.
