# Postorizon — Deployment Runbook (Phase 4)

> **Status: UNVERIFIED BY EXECUTION.** This runbook was assembled by static
> inspection of the repo (compose files, Dockerfiles, package scripts and a
> `process.env` harvest across `apps/` and `libraries/`). The build sandbox
> has no Docker, so no step here has been run. Treat the first deployment as
> a verification exercise: walk the smoke checklist (§8) and fix what it
> finds before calling any environment "staging".

> **Image decision (D2) — RESOLVED IN REPO (deployment-prep pass):**
> `docker-compose.yaml` no longer pulls the upstream Postiz image. The
> `postiz` service now **builds Postorizon's own image from this repo**
> (`build: context: . / dockerfile: Dockerfile.dev`) and tags it
> `ghcr.io/rankint360/postorizon:latest`. Exact commands:
> `docker compose build postiz` (or standalone:
> `docker build -f Dockerfile.dev -t ghcr.io/rankint360/postorizon:latest .`),
> then optionally `docker push ghcr.io/rankint360/postorizon:latest` for
> multi-host deploys; on a single host, `docker compose up -d` builds and
> runs it in place. `Dockerfile.dev` is single-stage (builds the whole
> monorepo, runs everything in one container) and was statically verified
> against this codebase in the deployment-prep pass: Node 22.23.4 and
> pnpm 10.6.1 match the root `packageManager`, the root `build`/`pm2`
> scripts it invokes exist (as do all three apps' `pm2` scripts), the
> nginx config it copies exists at `var/docker/nginx.conf`, and
> `.dockerignore` keeps `node_modules`/`dist`/`.git` out of the build
> context. No Dockerfile corrections were needed. The `var/docker` helper
> scripts' known defects (D3/D4) are fixed — see §9.

---

## 1. Architecture in one paragraph

One application container runs everything: **nginx** (port 5000, the only
published port) fronts the **backend** (NestJS, port 3000), the **frontend**
(Next.js, port 4200) and the **orchestrator** (Temporal worker host, health
endpoint on port 3002), supervised by **pm2**. Postgres and Redis are
dedicated services; Temporal has its own stack (server + its own Postgres +
Elasticsearch + UI). At container start, `pm2-run` applies the Prisma schema
(`prisma db push`) before launching the apps — there is no migrations folder
(§6).

## 2. Compose services (`docker-compose.yaml`)

| Service | Image | Ports | Notes |
|---|---|---|---|
| `postiz` | **built from this repo** (`Dockerfile.dev`) → tagged `ghcr.io/rankint360/postorizon:latest` (D2 resolved) | `4007:5000` | The app (all processes). Volumes `postiz-config:/config/`, `postiz-uploads:/uploads/` |
| `postiz-postgres` | `postgres:17-alpine` | — | App database; healthcheck `pg_isready` |
| `postiz-redis` | `redis:7.2` | — | Queues/throttling; healthcheck `redis-cli ping` |
| `temporal` | `temporalio/auto-setup:1.28.1` | `7233:7233` | Namespace `default`; dynamic config from `./dynamicconfig` |
| `temporal-postgresql` | `postgres:16` | — | Temporal's own database |
| `temporal-elasticsearch` | `elasticsearch:7.17.27` | — | Temporal visibility |
| `temporal-admin-tools` | `temporalio/admin-tools:1.28.1…` | — | `tctl`/CLI against the server |
| `temporal-ui` | `temporalio/ui:2.34.0` | `8080:8080` | Workflow inspection UI |
| `spotlight` | `ghcr.io/getsentry/spotlight:latest` | `8969:8969` | Sentry dev sidecar (optional) |

`docker-compose.dev.yaml` provides **infrastructure only** (same services,
ports published to the host); in dev the apps run on the host via
`pnpm run dev` reading the repo-root `.env` (see `.env.example`).

## 3. Configuration — required environment

The `postiz` service's environment is the app's configuration. Boot is
checked by `ConfigurationChecker` at the end of backend startup (it warns,
does not crash); Prisma hard-requires `DATABASE_URL`.

### 3.1 Core (must be set, per service `postiz`)

| Var | Compose value | Notes |
|---|---|---|
| `MAIN_URL` | `http://localhost:4007` | Public origin. Set to the real domain in production |
| `FRONTEND_URL` | `http://localhost:4007` | CORS origin, OAuth redirects, email links |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:4007/api` | Browser-visible API base (nginx strips `/api` → backend :3000) |
| `BACKEND_INTERNAL_URL` | `http://localhost:3000` | Server-side frontend→backend fetch (same container) |
| `JWT_SECRET` | placeholder in file | **Replace.** Long random value; also the root of legacy key derivation (auth.service) and the BYOK encryption helpers |
| `DATABASE_URL` | `postgresql://postiz-user:…@postiz-postgres:5432/postiz-db-local` | Must match `postiz-postgres` env |
| `REDIS_URL` | `redis://postiz-redis:6379` | If unset the code silently falls back to an in-memory mock — single-process only, breaks throttling/queues across processes. Treat as required |
| `TEMPORAL_ADDRESS` | `temporal:7233` | Defaults in code match the compose stack |
| **`RUN_CRON`** | `'true'` (added Phase 4, fix F1) | **See §5 — without it, no recurring workflow ever starts** |
| `IS_GENERAL` | `true` | |
| `DISABLE_REGISTRATION` | `false` | Set `true` after creating the owner account on a private staging |

### 3.2 Storage

| Var | Notes |
|---|---|
| `STORAGE_PROVIDER` | `local` (default) or `cloudflare` |
| `UPLOAD_DIRECTORY` | `/uploads` for local (backed by the `postiz-uploads` volume) |
| `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY` | `/uploads` — **note the `_STATIC_`**: the code reads only this name (the compose file previously set a non-existent `NEXT_PUBLIC_UPLOAD_DIRECTORY`; fixed Phase 4, F2) |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY`, `CLOUDFLARE_SECRET_ACCESS_KEY`, `CLOUDFLARE_BUCKETNAME`, `CLOUDFLARE_BUCKET_URL`, `CLOUDFLARE_REGION` | Only when `STORAGE_PROVIDER=cloudflare`; all are asserted non-null in that mode. Present as comments in the compose file |

### 3.3 Email — compose passthrough added with empty placeholders (D1, fixed)

`docker-compose.yaml` now carries the full email variable set as **empty
placeholders** (deployment-prep pass). Empty/unset still means the mail
service uses `EmptyProvider`: **no email is ever sent and new accounts are
auto-activated**. The passthrough is wired; the *values* are owner-side —
set a real provider before any public staging:

| Var | Notes |
|---|---|
| `EMAIL_PROVIDER` | `resend` \| `nodemailer` \| `ses` |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | Required for sending at all |
| `RESEND_API_KEY` | When `EMAIL_PROVIDER=resend` (code falls back to a dummy key if unset — sends will fail) |
| `EMAIL_HOST/PORT/SECURE/USER/PASS` | nodemailer set |
| `SES_REGION`, `SES_ACCESS_KEY`, `SES_SECRET_ACCESS_KEY` | SES set |

### 3.4 Payments — the Stripe publishable key is a behaviour switch

Billing is gated on the **presence of `STRIPE_PUBLISHABLE_KEY`** (verified in
`users.controller.ts`, `organization.service.ts`, `permissions.service.ts`,
`stripe.service.ts`):

- **Unset/empty** → the no-subscription fallback is a top tier
  (ULTIMATE/PRO, 10,000 channels): correct for a private self-hosted staging.
- **Set** → the fallback becomes the **FREE** tier with its limits, and paid
  plans/checkout activate.

The compose file ships all Stripe vars empty (`STRIPE_PUBLISHABLE_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_SIGNING_KEY`). For production: set all three
together; `STRIPE_SIGNING_KEY` is the webhook signing secret used to verify
`/stripe` events before processing (see SECURITY_AUDIT.md §c). Setting only
the publishable key flips every org to FREE limits — don't do it by accident.

### 3.5 Channel credentials (optional, per provider)

One client id/secret pair per social channel, e.g. `X_API_KEY/X_API_SECRET`,
`LINKEDIN_CLIENT_ID/SECRET`, `FACEBOOK_APP_ID/SECRET`, `THREADS_APP_ID/SECRET`,
`YOUTUBE_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_ID/SECRET`, `PINTEREST_*`,
`REDDIT_*`, `GITHUB_*`, `DISCORD_*`, `SLACK_ID/SLACK_SECRET`,
`MASTODON_URL/CLIENT_ID/SECRET`, plus `BEEHIIVE_API_KEY/PUBLICATION_ID`.
The compose file pre-lists most of them as empty strings. Each provider is
exercised only when its credentials are present. These come from the
developer apps (see DEV_APPS.md) — most are still owner-pending.

**Meta data-deletion callback (deployment-prep pass):** the backend now
serves Meta's signed data-deletion callback at
`POST /api/public/meta/data-deletion` (externally, on the app origin —
e.g. `https://app.postorizon.com/api/public/meta/data-deletion`; enter
that as the Data Deletion Request Callback URL in the Meta app). It
verifies the `signed_request` HMAC with **`FACEBOOK_APP_SECRET`** — the
same env var the Facebook provider reads, already in the compose
environment above. With the secret unset the endpoint answers 500 and
logs an error. Verified requests are logged (Meta user id + a
deterministic confirmation code) and answered with the status URL
`<MAIN_URL>/data-deletion?code=…`; there is deliberately no persisted
deletion-request table (see the controller's header comment for the
documented limitation).

### 3.6 Other feature env (optional)

`OPENAI_API_KEY` (platform AI fallback; orgs can bring their own keys —
Phase 2 BYOK), `API_LIMIT` (throttler, compose sets 30), short-link
providers (`DUB_*`, `SHORT_IO_SECRET_KEY`, `KUTT_*`, `LINK_DRIP_*`),
`REVENUECAT_SECRET_KEY`/`REVENUECAT_WEBHOOK_SECRET` (mobile IAP),
`NOT_SECURED` (**never set in production** — it strips cookie/CORS
protections, see SECURITY_AUDIT.md §a), RunPod/Deepgram/Fal keys for media
features. Full harvest is in the Phase 4 working notes; `.env.example` is
the host-dev reference for most of them.

## 4. Build & start order

- **Install:** `pnpm install` (Node 22, pnpm 10.6.1) — `postinstall` runs
  `prisma-generate`, producing the Prisma client.
- **Build (root `build` script):** sequential `pnpm -r` over
  `apps/frontend` (`next build`) → `apps/backend` (`nest build`) →
  `apps/orchestrator` (`nest build`). CI runs the same three builds
  (orchestrator added in Phase 4).
- **Container start:** `nginx` → `pnpm run pm2` → `pm2-run`:
  1. `pm2 delete all || true`
  2. **`pnpm run prisma-db-push`** — schema applied before any app starts
  3. `pm2` starts backend (3000), frontend (4200), orchestrator (3002) in
     parallel; each app's `start` reloads `../../.env` via dotenv (in the
     container, the compose `environment:` values are inherited).

## 5. Temporal notes — read this before debugging "nothing happens"

- **Workers live only in the orchestrator app** (`apps/orchestrator`), built
  from `require.resolve('./workflows')` → `apps/orchestrator/src/workflows/`
  (post workflows, autopost, clipping, digest, **engagement.sampling**,
  missing.post, refresh.token, send.email, …). The **backend is client-only**
  (`getTemporalModule(false)`), except that it registers the namespace
  search attributes (`organizationId`, `postId`) at boot.
- **Task queues:** `main` (the only workflow queue) + one activity-only queue
  per provider + `email`/`email-bulk`. `EXCLUDE_QUEUE` can trim queues.
- **`RUN_CRON` gates the recurring workflows.** Two `OnModuleInit` registers
  start long-running workflows only when `RUN_CRON` is set:
  `missingPostWorkflow` (backend) and `engagementSamplingWorkflow`
  (**orchestrator** — Phase 3's recurring engagement sampling + the
  token-expiry notifications ride on these paths). The compose file did not
  set it anywhere — in a compose deployment **neither workflow would ever
  have started**. Fixed in Phase 4 (F1): `RUN_CRON: 'true'` on the `postiz`
  service; the single-container model means one flag covers both processes.
  If the apps are ever split into separate services, set `RUN_CRON` on
  **both** the backend and the orchestrator service — and on exactly one
  replica of each if scaled, since the registers start the workflows on
  boot (Temporal de-dupes by workflow id, but don't rely on racing starts).
- Health: orchestrator `GET /health/status` on port 3002 connects to
  Temporal and describes the namespace.
- The app now waits for Temporal to *start* before booting (Phase 4, F3:
  `depends_on: temporal: service_started` — the temporal service defines no
  healthcheck, so this is the strongest condition available).

## 6. Database schema ("migrations")

There is **no migrations directory**. The schema
(`libraries/nestjs-libraries/src/database/prisma/schema.prisma`) is applied
with **Prisma db push**:

- Root scripts: `pnpm run prisma-generate`, `pnpm run prisma-db-push`
  (both invoke `prisma@6.5.0` via `pnpm dlx` against the schema path).
- In the container this runs automatically at every start (§4). For a
  manual/host deployment: run `prisma-db-push` against the target
  `DATABASE_URL` **before** starting the apps, after every schema change.
- `db push` is not a versioned migration: it converges the database to the
  schema and can be destructive on renames/drops. Back up the database
  before deploying schema changes to production.

## 7. First-deploy sequence

1. Build the Postorizon image: `docker compose build postiz` (D2 is
   resolved in the repo — the compose file builds `Dockerfile.dev` and no
   longer pulls the upstream image). Optionally
   `docker push ghcr.io/rankint360/postorizon:latest`.
2. Copy `docker-compose.yaml`; replace `JWT_SECRET`, the Postgres password
   (both in `DATABASE_URL` and `postiz-postgres` env), and the public URLs
   (`MAIN_URL`, `FRONTEND_URL`, `NEXT_PUBLIC_BACKEND_URL`) with the real
   domain.
3. Decide the Stripe posture (§3.4) and email (§3.3) before first boot if
   the environment is reachable by anyone else.
4. `docker compose up -d` — watch the `postiz` logs for the prisma-db-push
   step and the ConfigurationChecker output.
5. Open the app (host port 4007), register the owner account, then set
   `DISABLE_REGISTRATION: 'true'` and restart if the staging is private.
6. Connect channels (developer apps permitting), then run the smoke
   checklist (§8).

## 8. Smoke checklist — mapped to MVP_SPEC §7 success criteria

§7's formal targets (publish success ≥99% first-try on the top-8 networks
in beta; connect-3-channels + approve-an-agent-week + scheduled in <15
minutes; an agency client managed entirely via link approvals) need real
accounts and beta traffic — they cannot be proven in a smoke test. The
checks below prove the *prerequisites* on a fresh deployment:

| # | Check | §7 link |
|---|---|---|
| 1 | App loads at the public URL; register + login work; session survives reload | foundation |
| 2 | Email arrives (activation or test) — proves §3.3 is configured; if accounts auto-activate with no mail, email is still EmptyProvider | foundation |
| 3 | Connect one channel end-to-end (OAuth round-trip returns, channel appears with picture/name) | "connect 3 channels" prerequisite |
| 4 | Compose a post, schedule it ≥10 min out; it appears in the calendar with the right time/timezone | "<15 minutes to scheduled" |
| 5 | The post publishes; the statistics modal's **Delivery Timeline** shows Published with the live link and "Delivered first try" | "≥99% first-try" instrumentation |
| 6 | Force a failure (e.g. revoke the channel token, post again): the timeline records the failure with the provider's message, and the integration health view shows the channel degraded | §3.2.4 reliability |
| 7 | Submit a post for approval; open the public approval link **logged out**; approve via the link; the audit event appears in the post's timeline marked "via client link" | "agency client via link approvals" |
| 8 | Agent: with an org AI key (BYOK) set, ask the weekly-plan agent for drafts; drafts land in the approval queue and **nothing publishes without approval** | "approve an AI-planned week" |
| 9 | Client report link opens logged out, shows the period's posts; presets and the custom range both change the period | white-label/reporting |
| 10 | Wait one sampling interval (or trigger a sample): engagement numbers appear on a published post; best-time chips show data-backed suggestions in the composer | analytics loop |
| 11 | Temporal UI (:8080) shows `engagementSamplingWorkflow` and `missingPostWorkflow` running — proves `RUN_CRON` reached the apps | §5 |
| 12 | Restart the `postiz` container: db-push is a no-op success, all three apps return, scheduled posts survive | operability |

## 9. Known gaps — status after the deployment-prep pass

(Phase 4 flagged D1–D9; there is no D10. Statuses below are current.)

- **D1 — FIXED (values owner-side).** Compose now passes the full email
  variable set through with clearly-marked empty placeholders (§3.3).
  Until the owner sets a real provider + credentials, mail stays
  `EmptyProvider` and accounts auto-activate.
- **D2 — RESOLVED IN REPO.** Compose builds Postorizon's own image from
  `Dockerfile.dev` (see the note at the top). Nothing owner-side remains
  except optionally pushing the image to the registry.
- **D3 — FIXED.** `var/docker/docker-build.sh` rewritten for the
  single-stage `Dockerfile.dev` (it previously passed `--target dist` /
  `--target devcontainer`, stages that don't exist, and failed as
  written).
- **D4 — FIXED.** `var/docker/docker-create.sh` now publishes
  `4007:5000` (nginx) instead of the internal 3000/4200.
- **D5 — FIXED.** The inert `TEMPORAL_ADDRESS` was removed from the dev
  compose *postgres* service (host-run apps read the root `.env`, where
  the correct value is `localhost:7233`).
- **D6 — RESOLVED BY DOCUMENTATION.** `apps/commands` is a one-shot CLI
  (nestjs-command), not a service: it deliberately gets **no** compose
  service, root-build entry or pm2 script. It is built and run manually
  at deploy time — the exact commands are in §10 ("First-deploy
  one-offs"), which is also where its Phase 5 backfill task belongs.
- **D7 — OPEN (accepted).** The Temporal stack has no healthchecks;
  app→Temporal ordering is start-only (F3). The `temporalio/auto-setup`
  image ships no reliable in-image health probe to hang a healthcheck
  on, and its startup retries cover the gap in practice. Revisit only
  if Temporal is ever replaced by a managed/external deployment.
- **D8 — REVIEWED, retained deliberately.** Dead vars in prod compose
  (set, never read by code): `FEE_AMOUNT`, `STRIPE_SIGNING_KEY_CONNECT`
  (the code reads `STRIPE_SIGNING_KEY`), `SLACK_SIGNING_SECRET` (code
  reads `SLACK_SECRET`, which is present alongside). Harmless; kept for
  upstream parity so future upstream merges stay clean.
- **D9 — PARTIALLY FIXED.** Prod `temporal-ui` CORS origin now matches
  the app origin (`http://localhost:4007`); dev Redis gained the
  `/data` volume and `redis-cli ping` healthcheck it lacked, at parity
  with prod. Left as-is, deliberately: the dev Postgres user differs
  from prod's (aligning it would invalidate existing dev volumes;
  cosmetic only), and the dev `temporal-ui` CORS origin (host-dev
  origins vary by setup).

## 10. First-deploy one-offs (run once, in this order, after first boot)

These belong to the Phase 5 deploy specifically. None of them is
automated — each is a deliberate, one-time operator action.

### 10.1 Encrypt the stored channel tokens (Phase 5 backfill) — DO THIS

Phase 5 encrypts integration tokens at rest, but lazily: a channel's
tokens are re-stored encrypted on its next connect/refresh/page-save.
Dormant channels stay plaintext until the one-off backfill sweeps them.
Run it once after the first boot on Phase 5+ code (it is idempotent —
re-runs are no-ops):

```bash
# inside the running app container (compose deployment):
docker compose exec postiz sh -c "cd /app && pnpm --filter ./apps/commands run build && node ./apps/commands/dist/apps/command/src/main.js integrations:encrypt-tokens"
# expected output: "Scanned N integrations, encrypted tokens on M"
```

(On a host checkout with a populated `.env`, run the same two commands
from the repo root instead.) The task is the `nestjs-command` one-off
`integrations:encrypt-tokens` (`apps/commands`, see D6). Until this has
run, treat the database as still holding some plaintext channel
credentials.

### 10.2 Session cutover — OWNER'S DECISION (not done in code)

Phase 5 gave session tokens a 30-day expiry and revocation, enforced by
`AuthMiddleware` comparing the token's `sessionEpoch` claim against
`User.sessionEpoch` (revocation hooks: `UsersRepository.updatePassword`
and `POST /user/logout-all` → `UsersService.incrementSessionEpoch`).
**Pre-Phase-5 tokens carry no `exp` and no epoch claim**, so they are
treated as epoch 0 and keep working until the user resets their
password, signs out everywhere, or the cookie dies (≤365 days).

At cutover the owner picks one:

- **(Recommended) One-time global epoch bump** — logs every user out
  once; every live session afterwards is a Phase 5 (30-day) token:
  ```bash
  docker compose exec postiz-postgres psql -U postiz-user -d postiz-db-local \
    -c 'UPDATE "User" SET "sessionEpoch" = "sessionEpoch" + 1;'
  ```
  (Table name verified against `schema.prisma`: model `User`, no
  `@@map`.) Existing sessions fail the middleware check on their next
  request and self-clear — no restart needed.
- **Natural roll-off** — do nothing. Old tokens age out via the hooks
  above; the last stragglers persist up to the 365-day cookie lifetime.
  Acceptable for a fresh deployment with no pre-Phase-5 users (in which
  case this whole item is moot).

Deliberately NOT automated: forcing a global logout is the owner's
call, per the Phase 5 report.

### 10.3 Verify RUN_CRON actually reached the apps

§8 check #11 covers the symptom; verify the cause directly on first
boot, before trusting recurring sampling or token-expiry notifications:

```bash
docker compose exec postiz printenv RUN_CRON        # must print: true
docker compose exec postiz curl -s localhost:3002/health/status   # orchestrator ↔ Temporal OK
```

Then confirm in the Temporal UI (:8080) that `engagementSamplingWorkflow`
and `missingPostWorkflow` are running. If `RUN_CRON` is missing, neither
register starts and nothing recurring ever runs — set it on the `postiz`
service (it is in the compose file since Phase 4's F1) and restart; the
registers use fixed workflow ids, so a later start is clean and
duplicate-safe.

## Appendix — Phase 4 compose fixes (already applied)

- **F1** `RUN_CRON: 'true'` added to the `postiz` service (§5).
- **F2** `NEXT_PUBLIC_UPLOAD_DIRECTORY` → `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY`
  (the name the code actually reads; §3.2).
- **F3** `postiz` `depends_on` gained `temporal: service_started` (§5).
