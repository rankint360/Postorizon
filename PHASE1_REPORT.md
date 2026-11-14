# Phase 1 Report — Postorizon MVP build (parity sweep, theme, CLI, approvals core)

_Date: 2026-11-14 · Repo: `~/workspace/dev/postorizon` · Branch: `postorizon/phase-1`
(from Phase 0 head `d1bb45e`) · Scope: MVP_SPEC §3.1 parity + §3.2 items 1 (approvals),
4 (reliability), 6 (best-time) · Nothing pushed — the parent agent handles GitHub._

## Commit list (on `postorizon/phase-1`, oldest → newest)

| Commit | Subject | Diff |
|---|---|---|
| `e63d6f0` | Phase 1: locale rebrand sweep — Postiz→Postorizon in translation values (keys untouched) | 16 files, 533 ± |
| `22ceb10` | Phase 1: app + API-docs rebrand sweep, legal links, honest auth/billing claims | 62 files, 255 + / 260 − |
| `4351e9c` | Phase 1: map Postorizon design tokens onto the app theme (colors.scss) | 1 file, 74 ± |
| `9773aa9` | Phase 1: standalone postorizon CLI (cli/, outside the pnpm workspace) | 3 files, 360 + |
| `e1f3563` | Phase 1: approval workflow core (schema + repository + service + API) | 7 files, 348 + |
| _(this report)_ | docs: Phase 1 report | — |

## 1. Rebrand completion sweep — DONE

Counting method (identical before/after): `git grep -i postiz` over tracked files.

| | Before Phase 1 | After Phase 1 |
|---|---|---|
| Lines containing `postiz` | 1,057 | 472 |
| Files containing `postiz` | 142 | 98 |

### 1a. Translation locales (values only)
- All 16 locale files under `libraries/react-shared-libraries/src/translation/locales/*/translation.json`:
  **533 value lines changed**; a scripted transform that only edits the value side of each
  `"key": "value"` line. The recursive key list was verified **byte-identical before/after**
  and every file still parses as JSON. Remaining `postiz` in locale files = the 10 key names
  per file (160 lines) — keys are lookup identifiers and were not touched.
- Honest-claim overrides applied as values in **every** locale (English text, pending native
  translation): the `join_10000_entrepreneurs_who_use_postiz` value now reads
  “Join creators, brands and agencies who use Postorizon”, and `billing_entrepreneurs_count`
  no longer carries the inherited 20,000+ figure.
- The `gitroom` display-name value → “Postorizon”.
- The open-source FAQ link now points at the Postorizon repo
  (`github.com/rankint360/Postorizon`) so the AGPL source offer resolves to our modified source.
- ⚠️ `i18n.lock` (external translation-sync lockfile, not referenced by any script/CI here) still
  holds checksums of the old values for changed keys — regenerate it on the next translation sync.

### 1b. In-app strings, developer/API docs, legal links
- Frontend components (onboarding, developer page, OAuth consent screen, connect-link pages,
  approved-apps, Farcaster sign-in, self-hosted connector, webhooks intro, manage-post dialogs,
  billing FAQ defaults, testimonials helper): brand prose and `t()` fallback defaults now say
  Postorizon. `libraries/react-shared-libraries/src/helpers/testomonials.tsx` quotes were
  name-swapped like everything else — **flag for the owner**: these are inherited upstream
  testimonials; consider replacing the section with real Postorizon testimonials instead.
- Public-API page (`components/public-api/public.component.tsx`): MCP client config examples now
  name the server `postorizon` in every client dialect (Claude/Cursor/Codex/Hermes/AMP/OpenClaw/
  ncl); CLI snippets use `npm install -g postorizon` and `POSTORIZON_API_KEY`, matching the new
  standalone CLI (§3). **Left pointing at real upstream artifacts** (changing them would fabricate
  packages/listings that don't exist under our name): `claude.ai/directory/postiz`,
  `cursor.com/marketplace/postiz`, `npx skills add gitroomhq/postiz-agent`,
  `npmjs.com/package/n8n-nodes-postiz`, and the Chrome Web Store extension listing URLs.
- Legal links: register page Terms/Privacy → `https://postorizon.com/terms` /
  `https://postorizon.com/privacy` (pages must exist on the domain — owner action from Phase 0);
  `docs.postiz.com` links → `docs.postorizon.com`; affiliate menu link →
  `https://postorizon.com/affiliates` (**the /affiliates page doesn't exist yet** — owner to
  create it or drop the menu item).
- Backend/libraries user-visible strings: agency approval emails + `postiz.com/agencies/*`
  links → postorizon.com (the hardcoded agency-alert recipient `nevo@postiz.com` →
  `nevo@postorizon.com` — **owner must route or replace that mailbox**), login-changed email,
  billing-cancellation copy, MCP relay prompts/errors (+ MCP client name “Postorizon Cloud”),
  MCP server display name “Postorizon MCP”, chat tool descriptions, provider error messages,
  Mastodon OAuth `client_name`, Tumblr/WordPress user-agents, listmonk welcome subject,
  orchestrator digest subject `[Postorizon]`, Swagger title, extension allowed-origin regex
  (now `*.postorizon.com`), SDK default API base → `https://api.postorizon.com`,
  `chatgpt-app-submission.json` manifest, `.env.example` comment prose + docs URL.
- FAQ ternaries `isGeneral ? 'Postiz' : 'Gitroom'`: the Postiz branch now reads Postorizon;
  the `Gitroom` (non-general/white-label) branch was left — see Phase 0 §5.7 (IS_GENERAL audit).

### 1c. The “20,000+ entrepreneurs” claim — replaced, no invented numbers
- `apps/frontend/src/app/(app)/auth/layout.tsx`: headline is now
  “Join creators, brands and agencies / scheduling with Postorizon”.
- Billing `JoinOver` (`first.billing.component.tsx`) no longer assembles the
  “Join Over 20,000+ Entrepreneurs who use …” fragments; it renders the honest join line
  (same translation key whose values were fixed in §1a). `billing.after.tsx` fallback matches.

### 1d. What the remaining 472 lines are (by design)
- **Translation keys** (~170 incl. `i18n.lock`): lookup identifiers.
- **`@gitroom/*` aliases & imports**: `gitroom` overall is 2,994 lines, of which 2,835 are
  `@gitroom/` path aliases (never rendered). Untouched per instructions.
- **Structural identifiers**: `POSTIZ_*` env vars, `x-postiz-org` / `x-postiz-include-deleted`
  headers, `postiz://` deep-link scheme (must match the backend default), Mastra agent id
  `postiz`, widget URIs `ui://postiz/*`, workspace package names (`postiz-frontend`, …),
  `@postiz/wallets`, `@postiz/node`, docker service/container names and the
  `ghcr.io/gitroomhq/postiz-app` image path, `com.postiz.mob.*` store ids in a comment.
- **Legal/attribution**: LICENSE (1 line — copyright), `OPEN_SOURCE.md`, README provenance,
  CCLA/ICLA/CONTRIBUTING/SECURITY (upstream legal texts), `PHASE0_REPORT.md` (historical record).
- **Repo plumbing**: `.github/` workflows (ghcr image names, `github.repository == 'gitroomhq/
  postiz-app'` guards that keep upstream-only workflows inert here, funding file pointing at
  upstream's accounts), issue templates (upstream Discord), `docker-compose*.yaml` service names
  and example DB credentials, historical code comments.
- **Real external URLs** listed in §1b.

## 2. Theme mapping — DONE

`apps/frontend/src/app/colors.scss` (the app's actual theme file), **values only** — applied via
an asserted mapping script (every variable replaced exactly once in its intended block):

- **Dark**: `--new-bgColor` → Ink `#0B0E1A`; `--new-bgColorInner`/`--new-bgLineColor`/
  `--new-table-header` → Panel `#141828`; settings/strips/hover/focused fills → Raised `#1D2237`;
  `--new-btn-primary` and `--new-table-text-focused` → Coral `#FF5A3C`; `--new-ai-btn` → Violet
  `#7A5AF8`; `--new-textColor` → `244 241 234`; muted text → `#9BA1B8`; borders/tables →
  `rgba(244,241,234,0.09)` (the `--pz` border-on-dark colour); popup scrim → Ink-based.
- **Light**: `--new-bgColor` → Paper `#FAF6F0`; cards/settings/headers → white; `--new-btn-primary`
  → Coral; `--new-ai-btn` → Violet; text → `20 24 40`; muted → `#5A6076`; borders →
  `rgba(11,14,26,0.09)`; backdrop → Ink; menu/preview shadows re-tinted from violet-gray
  `rgba(55,52,75,*)`/`rgba(38,32,64,*)` to Ink `rgba(11,14,26,*)`; `--new-boxFocused` → a derived
  Coral tint `rgba(255,90,60,0.12)`.
- **Aliases**: `--color-primary/-secondary/-third` → Ink/Panel (dark) and Paper (light);
  `--color-forth` → Coral; `--color-seventh` → Violet; `--color-text`, `--color-gray` mapped.
- **Untouched on purpose**: the per-network preview variables (`--linkedin-*`, `--facebook-*`,
  `--instagram-*`, `--tiktok-*`, `--youtube-*` — they mimic those platforms' own UIs) and the
  `--color-custom1..55` feature swatches. Fonts are not defined in `colors.scss` (the `--pz-*`
  font tokens are imported but not wired to a font variable — follow-up if wanted).
- The Dawn gradient is not forced anywhere: no existing chrome variable holds a gradient for
  primary actions, and inventing one would exceed “conservative remapping”.

## 3. Standalone CLI — DONE

New top-level `cli/` (outside the pnpm workspace globs `apps/*` + `libraries/*`; no root script
or lockfile changes, so CI is unaffected):

- `cli/package.json` — `postorizon-cli`, `bin: { postorizon: ./bin/postorizon.js }`, Node ≥ 18.
- `cli/bin/postorizon.js` — zero-dependency (global `fetch`), mirrors the `apps/sdk` surface:
  - `postorizon posts:create --text "…" --integration <id> [--integration <id>…] [--date <ISO>]
    [--type draft|schedule|now] [--shortlink]` — body matches `CreatePostDto`
    (`{type, shortLink, date, tags: [], posts: [{integration: {id}, value: [{content, image: []}]}]}`);
    draft without a date, scheduled with one.
  - `postorizon posts:list [--from] [--to] [--customer]` → `GET /public/v1/posts?startDate&endDate`
    (defaults 7 days back → 30 days ahead), one line per post.
  - `postorizon auth:login` — prints API-key setup (the in-app docs reference this command).
  - Config: `POSTORIZON_API_KEY` (required for API calls; missing → exit 2 with instructions),
    `POSTORIZON_API_URL` override, default `https://api.postorizon.com`.
- `cli/README.md` — usage + configuration.
- **Verified**: `node --check`; `--help` and `auth:login` with no network; missing-key guard;
  `posts:create` against a local stub server — method, path `/public/v1/posts`,
  `Authorization: <key>` header and DTO-shaped body all confirmed.

## 4. §3.2 items 1 / 4 / 6 — inspected; approvals core implemented

### 4a. Approvals (§3.2.1) — CORE IMPLEMENTED (`e1f3563`)
**Existed before:** nothing for posts — every “approv*” hit in the codebase is OAuth
“approved apps” or agency-directory approval. Post states were only QUEUE/PUBLISHED/ERROR/DRAFT.

**Implemented** (following the existing PrismaRepository/Service + DatabaseModule patterns):
- Schema (`schema.prisma`, +34 lines, purely additive): `ApprovalState` enum
  (`NOT_REQUIRED` default — inherited behaviour unchanged — `PENDING`, `APPROVED`,
  `CHANGES_REQUESTED`); `Post.approvalState` + `Post.approvalToken` (`@unique` — the shareable
  client-link token); new `PostApproval` audit model (state, comment, userId, `viaLink`,
  timestamps) related to Post and Organization.
- `libraries/nestjs-libraries/src/database/prisma/posts/post.approvals.repository.ts` and
  `post.approvals.service.ts`: request (issues token via the codebase's `makeId`), approve,
  request-changes, reset, state+history read, and the no-login link operations
  (`getLinkPost`, `approveViaLink`, `requestChangesViaLink`) — all transitions write audit rows.
- Wiring: providers added to `DatabaseModule` (its `exports` getter returns the providers list,
  so they're exported automatically); `PostApprovalsController`
  (`apps/backend/src/api/routes/post.approvals.controller.ts`) added to ApiModule's
  `authenticatedController` list: `GET /posts/:id/approvals`,
  `POST /posts/:id/approvals/request|approve|request-changes|reset`. DTO:
  `libraries/nestjs-libraries/src/dtos/posts/post.approval.dto.ts`.
- All new/edited TS files pass a TypeScript parse check; every referenced symbol was verified
  to exist (`PrismaRepository<'postApproval'>` follows the multi-model injection pattern used by
  PostsRepository; `ApprovalState` is a generated-client enum like its neighbours).

**Remains (precisely):**
1. Publish-path gating: the Temporal post workflow does not yet block/skip posts whose
   `approvalState` is PENDING/CHANGES_REQUESTED — needs a check in the posts service/orchestrator
   publish path plus a product decision (block vs warn).
2. No-auth binding for the link flow: a public controller (pattern:
   `no.auth.integrations.controller.ts`) + the matching auth-middleware exclusion for its route —
   the service methods are ready; only the HTTP binding is missing.
3. Frontend: calendar approval badges, post-editor approval panel, and the client approval page
   behind the link. 4. A Prisma migration/`prisma db push` at deploy time (repo flow already
   uses `prisma-db-push`).

### 4b. Reliability (§3.2.4) — substrate EXISTS upstream; surfacing remains
- **Retries**: every Temporal post workflow version (`apps/orchestrator/src/workflows/
  post-workflows/*`) configures activity retries (`maximumAttempts: 3`).
- **Duplicate protection**: publish workflows start with deterministic
  `workflowId: post_<postId>` and `workflowIdConflictPolicy: 'USE_EXISTING'`
  (`apps/orchestrator/src/activities/post.activity.ts:128`) — re-triggers coalesce.
- **Token expiry**: `Integration.tokenExpiration` is populated by the integration repository on
  connect/refresh; a dedicated `refresh.token.workflow.ts` refreshes against it, and
  `IntegrationService.checkAnalytics` / `PostsService.checkPostAnalytics` refresh-on-use when
  expired.
- **Failure records**: the `Errors` model (+ admin ErrorsService) stores per-post publish
  failures (message, platform, body) — the data for a “delivered first-try” view already exists.
- **Not implemented** (needs product/UI work, deliberately not stubbed): user-facing
  publish-status view over `Errors`/`Post.state`, token-expiry *early-warning* surfacing
  (data exists; no warning endpoint/UI consumes it — `refreshNeeded` is the internal flag),
  and per-network pre-flight validation beyond providers' own errors.

### 4c. Best-time scheduling (§3.2.6) — NOT implemented (blocked on data design)
- **Exists**: `Integration.postingTimes` (JSON queue times, default 120/400/700 minutes after
  midnight) — fixed queue slots, **not** engagement-derived. Analytics are fetched **live**
  per integration/post from providers (`AnalyticsController` → `checkAnalytics` /
  `checkPostAnalytics`); there is **no stored engagement time-series** in Prisma.
- `checkPostAnalytics` returns provider-shaped `AnalyticsData[]` (`{label, data: [{total, date}],
  percentageChange}`) with provider-specific metric labels, so an honest best-time engine needs:
  a per-provider engagement-metric choice, a bounded sampling job over published posts, and a
  cache table for aggregates. Shipping a generic aggregator on that shape would be speculative —
  left as a designed-but-unbuilt item rather than a stub.

## 5. Verification performed
- `git status`: clean after every commit; branch is exactly `d1bb45e` + the 5 Phase 1 commits
  + this report commit.
- Grep counts (§1 table) with an identical `git grep` method before/after; locale key-integrity
  and JSON-validity checks (§1a); `chatgpt-app-submission.json` re-validated as JSON.
- CLI: syntax + `--help` + stub-server end-to-end (see §3).
- New backend files: TypeScript parse check OK. **Not** run locally: full `pnpm install` /
  builds / `prisma validate` — this sandbox's Prisma engine download is broken (Phase 0 §4);
  CI (install → prisma-generate → frontend+backend build) is the verification gate, as in Phase 0.
  The schema change is additive-only and mirrors neighbouring models to minimise that risk.

## 6. Risks / unknowns
- `prisma-generate` in CI is the first real test of the new enum/model + `ApprovalState` import;
  if the generated client names differ from the assumed `postApproval` delegate, the approvals
  commit is the only one affected.
- Docs now reference an npm package `postorizon` and `POSTORIZON_API_KEY` for the CLI, but the
  CLI in `cli/` is not yet published to npm — docs and package must ship together.
- `postorizon.com/terms`, `/privacy`, `/affiliates` and `docs.postorizon.com` must exist before
  the in-app links pointing at them go live (owner tasks carried over from Phase 0).
- Testimonials (§1b) and the agency-alert mailbox (§1b) need owner decisions.
- Nothing in Phase 1 changes publish behaviour: approvals are additive and default to
  NOT_REQUIRED; the theme change is visual only.
