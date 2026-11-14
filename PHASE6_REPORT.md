# Postorizon — Phase 6 Build Report (platform admin dashboard v1)

- **Branch:** `postorizon/phase-6`, based on `postorizon/deployment-prep`
  (e4ee4e5, CI-green). **3 commits** — backend `7828e75`, frontend
  `a33fc73`, docs/report (this file). Local only at time of writing —
  the parent pushes, then CI is the authoritative compile check
  (see Verification).
- **Theme:** a cross-platform operator console for the platform owner:
  users, organizations, integrations/configuration and system status,
  behind a dedicated platform-admin flag — separate from per-org
  settings and from the upstream `isSuperAdmin` surface.
- **Rules kept:** no new dependencies; Prisma changes additive-only
  (3 columns + 1 model); `.github/workflows/ci.yml`, `pricing.ts` and
  entitlement amounts untouched; no secret value is ever returned by a
  new endpoint (user selects exclude password/tokens; provider
  configuration is set/unset booleans only — asserted in tests).

## Design decisions worth knowing first

1. **`isPlatformAdmin` is a NEW flag, deliberately not `isSuperAdmin`.**
   The codebase already has `User.isSuperAdmin`, gating upstream
   operator features (announcements, coupons, impersonation, the
   `/admin/errors` + `/admin/stats` pages). The Phase 6 console gets
   its own flag so neither surface silently unlocks the other.
2. **Suspension is a new `suspendedAt` column, NOT a reuse of
   `activated`.** `activated` is the email-activation gate (accounts
   start un-activated until the activation link is clicked).
   Overloading it would have made "reactivate a suspended user" also
   mark never-verified accounts as email-activated. `suspendedAt`
   (user + organization) keeps the states orthogonal; null = active.
3. **Page protection follows the app's real convention.** This Next
   version documents `notFound()` only for Server Components, Server
   Functions and Route Handlers, and the app has no server-side user
   resolution at all (the shell gates client-side on `/user/self`).
   The new pages therefore mirror the existing admin pages exactly:
   proxy redirect when logged out, client gate rendering the
   established "You do not have access to this page." treatment for
   non-admins, and — the actual enforcement — `PlatformAdminGuard`
   rejecting every API call. Nothing sensitive can be reached by
   viewing page source or calling the API directly.

## What was built

### Access & bootstrap ✅
- Schema: `User.isPlatformAdmin Boolean @default(false)`.
- `PlatformAdminGuard` (`apps/backend/src/services/auth/platform.admin.guard.ts`):
  a real Nest guard over the whole `PlatformAdminController`, reading
  the flag from the DB user `AuthMiddleware` resolved — never from
  token claims. Refusals mirror the existing `AdminController`
  idiom (`HttpException 'Unauthorized', 400`).
- Bootstrap: `admin:grant <email>` / `admin:revoke <email>` CLI
  commands (`apps/commands/src/tasks/platform.admin.ts`, nestjs-command
  `@Positional` — the library's documented API, first in-repo use),
  registered in `command.module.ts`, documented as DEPLOYMENT.md
  §10.4. Lookup uses the existing `UsersService.getUserByEmail`
  (local accounts, case-insensitive).
- Safeguards (pure rules in `platform-admin.rules.ts`, shared by API
  and CLI): self-suspend and self-demote refused; the **last active**
  platform admin (not deleted, not suspended) cannot be suspended or
  demoted through any path.

### Admin audit log ✅
- Schema: `AdminAuditLog` (adminUser FK to User; polymorphic
  targetType/targetId; `metadata Json?`; indexed by admin + date).
- Every mutating admin action writes exactly one row through
  `PlatformAdminService.record()` after the mutation succeeds:
  `user.suspend`, `user.reactivate`, `user.force_sign_out`,
  `user.grant_admin`, `user.revoke_admin`, `user.resend_activation`,
  `organization.suspend`, `organization.reactivate`,
  `organization.tier_override` (metadata `{from, to}`).
- Read endpoint `GET /admin/audit-log` — paginated, includes the
  acting admin's email/name via the schema relation.

### Users ✅
- `GET /admin/users` (search by email/name, `{items,total,page,limit,hasMore}`
  — the codebase's list shape), `GET /admin/users/:id` (memberships
  with org name/role/disabled + org suspension state, session epoch).
- Actions: **suspend/reactivate** (sets `suspendedAt` AND bumps the
  session epoch through the Phase 5 seam, so pre-suspension tokens
  can never revive after reactivation); **force sign-out** —
  `UsersService.incrementSessionEpoch`, the exact seam behind
  `POST /user/logout-all`, no duplication; **grant/revoke admin**
  (safeguards above); **resend activation** — wired to the existing
  `AuthService.resendActivationEmail` (the flow behind
  `POST /auth/resend-activation`); refused for already-activated
  accounts.
- **Enforcement seam:** `AuthMiddleware` rejects `user.suspendedAt`
  immediately after the Phase 5 epoch check and **before** the
  impersonation swap (auth.middleware.ts) — the real signed-in user is
  judged, and existing sessions die on their next request via the
  existing forbidden→401+cookie-clear path.

### Organizations ✅
- List (search by name, member/channel counts, tier, suspension) and
  detail (members, subscription row, integrations merged with
  `IntegrationHealthService.getOrgHealth` output by id).
- **Tier override** (`POST /admin/organizations/:id/tier`): tier only,
  amounts never touched. Paid tiers go through the existing
  `SubscriptionService.createOrUpdateSubscriptionByOrg` write path —
  side effects (channel disable/enable, team-member toggles) plus the
  row upsert — passing the row's **current provider** (or `stripe`
  when no row exists) so later Stripe/RevenueCat syncs keep managing
  the row, and the current identifier (`'admin-override'` when none).
  `FREE` runs the standard downgrade side effects
  (`modifySubscriptionByOrg`) and then soft-deletes the row — FREE is
  a virtual tier with no row, matching how subscription deletion
  already behaves. **Lifetime subscriptions are refused** (400)
  instead of being silently destroyed. Deliberate deviation, recorded:
  for FREE the provider guard in the stock delete path is bypassed —
  a platform-admin override is meant to supersede billing-provider
  state, and a later genuine checkout recreates a managed row through
  the customer-keyed upsert.
- **Suspend/reactivate** enforcement, at the most central seams that
  genuinely exist:
  - `AuthMiddleware`: suspended orgs are filtered out of the org
    candidate list, so one can never become `req.org`; members keep
    their other orgs; a user with only suspended orgs gets the same
    403 as an org-less user. The impersonation branch likewise
    refuses to swap into a suspended org.
  - `PublicAuthMiddleware`: the org's API key / OAuth token gets
    `403 {msg: 'Organization suspended'}`, including via the
    super-admin `x-postiz-org` override.
  - **What org suspension does NOT block** (precisely): work already
    inside the Temporal orchestrator (scheduled publishes/sampling
    run off stored rows, not HTTP middleware); the MCP tool server;
    the unauthenticated public token pages (client approval / report
    links — they key off unguessable tokens, not org context);
    billing webhooks. Closing those is a follow-up if the owner wants
    suspension to be a full freeze rather than an access cut-off.

### Integrations & configuration ✅ (`GET /admin/integrations`)
- Per-provider rollup: connected counts (Prisma `groupBy`) merged
  with 30-day error counts and token-state counts obtained by calling
  the existing `IntegrationHealthService.getOrgHealth` for every org
  and aggregating (`aggregateProviderHealth` — aggregation only, the
  tokenState/error derivation is not forked).
- Credential status: social providers declare no env-key list
  anywhere (only email providers have `validateEnvKeys`), so
  `PROVIDER_ENV_KEYS` in `platform-admin.rules.ts` was derived by
  auditing each provider's inline `process.env` reads (39 registry
  providers; `linkedin-page` inherits LinkedIn's keys; `gmb` accepts
  its YouTube fallback pair; per-user-credential providers —
  bluesky, lemmy, nostr, medium/devto/hashnode tokens, ghost, etc. —
  report `configured: null`). The endpoint returns key NAMES with
  `set: boolean` only; a test asserts the payload shape carries no
  value field. Known anomaly left as-is: `dribbble.provider.ts` also
  reads the Pinterest keys in one code path (upstream copy-paste);
  the map lists Dribbble's own keys.
- Token-encryption migration counts: integrations counted by the
  Phase 5 `enc:v1:` marker (`token startsWith`), with Skool reported
  separately as pre-encrypted-by-design (its stored value is provider
  ciphertext without the marker — Phase 5's exemption). Counted on
  the access-token field; the refresh token carries the same marker
  from the same write funnel.

### System ✅ (`GET /admin/system`)
- Derivable status only: **email** — provider selected with the same
  switch as `EmailService.selectProvider`, keys read off the real
  provider classes' `validateEnvKeys` (SES's list is env-dependent,
  evaluated live), plus `EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME`,
  without which `sendEmailSync` silently no-ops; **storage** —
  `STORAGE_PROVIDER` decision mirrored from `UploadFactory` with its
  key sets; **engagement sampling** — total `PostEngagementSnapshot`
  count + newest `capturedAt`; **backfill remaining** — the plaintext
  count from the integrations rollup. No invented probes.

### Overview ✅ (`GET /admin/overview`)
Counts: users, organizations, integrations (all non-deleted), posts
in the last 30 days, engagement snapshots total.

### Frontend ✅
- Pages at `(site)/admin/{overview,users,organizations,integrations,system,audit}`
  (URLs `/admin/…`), thin server pages mirroring `admin/stats`, each
  rendering a gated client component from `components/admin/platform-admin-*.tsx`.
  Shared gate/nav/cards/pager in `platform-admin-shared.tsx`.
- Users page: debounced search, paginated grid table (the
  admin-errors pattern), detail modal with memberships and every
  action; destructive/sensitive actions confirm via the existing
  `deleteDialog` (`areYouSure`) helper; self suspend/demote buttons
  disabled in the UI as well (API remains the authority).
- Organizations page: search, tier display, detail modal (members +
  per-channel health chips from the same health payload), tier
  override modal (tier select + confirm; FREE marked destructive),
  suspend/reactivate with confirm.
- Integrations page: migration-count cards + per-provider table
  (connected, errors, token-state chips, credential set/unset chips).
  System page: email/storage status rows + sampling/backfill cards.
  Audit page: paginated table (admin email, action, target, metadata).
- Menu: `TopMenu` gains an **Admin** entry (`/admin/overview`) via a
  new `platformAdminOnly` flag on `MenuItemInterface`, checked in both
  filter predicates against `user.isPlatformAdmin`. The org `role`
  filter cannot express this (every org owner is org-SUPERADMIN) —
  that trap is commented at the flag. The field reaches the frontend
  through the existing `GET /user/self` (`...user` spread of the DB
  row) — no payload change was needed.

## Out of scope (by spec, stated)
Impersonation (the upstream isSuperAdmin one is untouched), plan-amount
/ pricing editing, per-session (vs per-user) revocation, email
campaigns, content moderation.

## Verification
- **Executed functional tests** (transpiled repo code, stubbed module
  loading — the Phase 5 pattern): **34 assertions, all passing** —
  safeguard rules (self/last-admin across suspend + revoke, spare-admin
  allowed), health aggregation (sums, per-state counts, sorting),
  credential derivation (configured/unconfigured, gmb fallback,
  per-user `null`, and the payload-shape assertion that no key entry
  carries anything but `{key, set}`), email/storage status derivation
  (missing-key lists, EmptyProvider never "configured", unknown
  storage provider not configured), the real `PlatformAdminGuard`
  class (allows admin; rejects non-admin and anonymous with 400), and
  the audit-write data mapping on `PlatformAdminRepository` with a
  capturing fake model (exact field set, values, optional metadata).
- **Parse checks:** every touched/new TS and TSX file passes the repo
  TypeScript `transpileModule` check (11 backend, 14 frontend).
  Full type-checking happens in CI — the sandbox cannot generate the
  Prisma client (the known, stated limit; the new schema fields exist
  in the schema CI generates from).
- **Relation audit:** every Prisma relation used was verified
  field-by-field in schema.prisma: `User.organizations`,
  `UserOrganization.organization`, `Organization.users`,
  `Organization.Integration`, `Organization.subscription`,
  `AdminAuditLog.adminUser` (new, defined both sides). Post/Integration
  counts use scalar fields only (`deletedAt`, `createdAt`, `token`,
  `providerIdentifier`).
- **Hook/context audit:** no hook or context return shapes changed.
  Frontend additions read `useUser()` fields that already exist on
  its type (`id`, and `isPlatformAdmin` via the Prisma `User` type
  once generated). `TopMenu`'s two filter predicates were both
  updated; `useMenuItem` consumers get the new flag inertly.
- **Bare-array sweep:** zero `: [],`-style literals in this phase's
  added frontend lines (checked over the new files); backend object
  literals with array fields are explicitly typed (`PageParams`
  flows, Prisma inputs).
- **DI audit:** `PlatformAdminRepository`/`PlatformAdminService`
  added to `DatabaseModule` providers (its `exports` getter mirrors
  providers); service injects only DatabaseModule-provided services
  (UsersService, IntegrationHealthService, SubscriptionService) —
  acyclic. `PlatformAdminController` added to `authenticatedController`
  (so AuthMiddleware applies) and `PlatformAdminGuard` to ApiModule
  providers in `api.module.ts` — both re-read after editing.
  `AdminGrant`/`AdminRevoke` added to `command.module.ts` providers.
  Grep confirms no spec/test constructs any of the new classes
  manually.
- **Route-collision audit:** the new controller's paths
  (`/overview`, `/audit-log`, `/users*`, `/organizations*`,
  `/integrations`, `/system`) do not overlap the upstream
  AdminController's `/errors`, `/errors/platforms`, `/stats`.

## Risks / residuals (honest list)
1. **CI is the first true compile** of this branch (as with every
   phase) — including the regenerated Prisma client with the new
   columns/model, which the frontend `User` type and all new queries
   depend on.
2. **The CLI positional argument is the library's documented API but
   a first in-repo use.** The command classes follow
   `nestjs-command`'s `@Command({command: 'admin:grant <email>'})` +
   `@Positional` exactly as its type definitions specify, and the
   underlying service methods are the same code the API exercises —
   but the commands app could not be executed in the sandbox (no
   generated Prisma client / live DB), so the first real run is at
   deploy time (§10.4). If yargs positional wiring misbehaves there,
   the fallback is a one-line `@Argv` parse in the same classes.
3. **Rollup cost:** `GET /admin/integrations` calls `getOrgHealth`
   once per organization (each loads that org's integrations + up to
   5,000 error rows). Fine at current scale; if org counts grow large
   this endpoint wants a cached/aggregated variant.
4. **Suspended-admin accounting:** the last-admin safeguard counts
   admins who are neither deleted nor suspended. Suspending the
   second-to-last admin therefore makes the remaining one
   un-demotable until someone is reactivated or granted — intended,
   but worth knowing before suspending admins casually.
5. **Login still mints a (useless) token for suspended users:**
   enforcement is at the per-request seam per spec — every API call
   403s and the frontend's forbidden handling signs them out — but
   `routeAuth` itself does not special-case `suspendedAt`. A login
   gate is a small follow-up if the owner wants the error at sign-in.
6. **Org suspension is an access cut-off, not a freeze** — see the
   precise does-not-block list under Organizations above.
7. Everything on the parked list stays parked; pricing untouched.
