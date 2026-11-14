# Postorizon — Deploying on Render

> **Status: UNVERIFIED BY EXECUTION.** `render.yaml` is a translation of
> `docker-compose.yaml`, assembled by static inspection and validated
> against Render's official Blueprint JSON schema. No deploy has been
> run yet — treat the first one as a verification exercise and walk
> DEPLOYMENT.md §8 (smoke checklist) afterwards. DEPLOYMENT.md remains
> the platform-neutral runbook; this file covers only what's
> Render-specific.

## 1. What gets created

| Render resource | Type / plan | Replaces (compose) |
|---|---|---|
| `postorizon` | Web service, Docker (`Dockerfile.dev`), plan `2c-4g` (2 CPU / 4 GB), 1 instance, 10 GB persistent disk at `/uploads`, custom domain `app.postorizon.com` | `postiz` |
| `postorizon-db` | Render Postgres, plan `0.1c-256mb`, PostgreSQL 17 | `postiz-postgres` |
| `postorizon-redis` | Render Key Value, plan `256mb`, persistence `journal-snapshot`, eviction `noeviction`, no public access (`ipAllowList: []`) | `postiz-redis` |
| `postorizon-temporal` | Private service, prebuilt image `temporalio/auto-setup:1.28.1`, plan `1c-2g` (1 CPU / 2 GB) | `temporal` |
| `postorizon-temporal-db` | Render Postgres, plan `0.1c-256mb`, PostgreSQL 16 | `temporal-postgresql` |
| `postorizon-core` | Environment group (non-secret literals: URLs, `RUN_CRON`, storage paths) | part of `postiz.environment` |

Deliberately **not** created: Elasticsearch (Temporal runs with its
standard SQL visibility store — see §6), Temporal UI, Temporal admin
tools, the Sentry `spotlight` sidecar, and a `/config` disk (see §6).

Plan reasoning, briefly: the app container runs frontend + backend +
orchestrator + nginx in one box (DEPLOYMENT.md §1), so it gets the
4 GB class; Temporal's server alone fits the 2 GB class; both
databases start on the smallest paid Postgres tier and can be resized
upwards in the dashboard without recreating them; Key Value starts on
its smallest *persistent* paid tier (the free tier does not persist —
unacceptable for queues). Slugs were verified against Render's
official Blueprint YAML reference on 2026-11-14; Render renames plans
occasionally, and some surfaces still show this Postgres tier under
its legacy name `basic-256mb` — same tier if you ever see it.

Two translations worth understanding before you deploy:

- **The `$PORT` seam.** nginx inside the container listens on the
  fixed port 5000 that compose publishes, but Render assigns `$PORT`
  and routes traffic there. `Dockerfile.dev`'s start command now
  rewrites nginx's single `listen 5000;` to `$PORT` *only when `$PORT`
  is set*; under compose (no `$PORT`) the config is untouched and
  behaviour is byte-identical to before.
- **Secrets.** Owner-filled secrets are `sync: false` entries on the
  web service (Render prompts for them at Blueprint creation). They
  are *not* in the `postorizon-core` env group, because Render ignores
  `sync: false` inside groups. `JWT_SECRET` is `generateValue: true`
  — Render creates it once; **treat it as permanent** (it roots the
  BYOK encryption helpers and all sessions; rotating it invalidates
  both).

## 2. Click-path

Prerequisites: a Render account with a payment method on file (every
resource here is a paid plan), and this repo pushed to GitHub with
`render.yaml` on the branch you'll deploy from.

1. **Render Dashboard → New + → Blueprint.** Connect GitHub if asked,
   select the Postorizon repository, then the branch that contains
   `render.yaml` (services inherit that branch). Name the Blueprint
   instance anything (e.g. `postorizon`).
2. **Review the resource list.** Render reads `render.yaml` and shows
   the five resources + env group from §1. If it reports a validation
   error on a plan slug, pick the equivalently sized plan it offers
   and tell whoever maintains this file.
3. **Answer the secret prompts.** One prompt per `sync: false`
   variable, in file order: email → Stripe → channels → AI. Guidance:
   - **Leave everything blank that you don't already have.** Every
     value can be added later under the web service's **Environment**
     tab (prompts happen only at creation). Empty channel credentials
     simply mean that network can't be connected yet.
   - **Stripe: all three keys or none.** While `STRIPE_PUBLISHABLE_KEY`
     is empty, the no-subscription fallback is a top tier — right for
     a private staging. Setting only the publishable key flips every
     organisation to FREE limits (DEPLOYMENT.md §3.4).
   - **Email: blank is survivable, briefly.** With no provider set, no
     mail is sent and new accounts auto-activate (§3.3). Fine for the
     first boot; fill `EMAIL_PROVIDER` + credentials before anyone
     else registers.
4. **Apply / Create.** Render provisions the databases and Key Value,
   builds the app image from `Dockerfile.dev` (a full monorepo build —
   expect it to take a while; see §6), pulls the Temporal image, and
   starts everything. The app is reachable at
   `postorizon.onrender.com` once the web service is live.
5. **DNS — do this immediately after creation.** At the DNS provider
   for `postorizon.com`, add:
   - `app` → **CNAME** → `postorizon.onrender.com`
   
   The custom domain is already declared in the Blueprint; once the
   CNAME resolves, Render provisions the TLS certificate
   automatically. Do the smoke tests against
   `https://app.postorizon.com`, not the `onrender.com` hostname —
   `MAIN_URL`/`FRONTEND_URL`/`NEXT_PUBLIC_BACKEND_URL` all point at
   the custom domain, so OAuth callbacks and browser API calls assume
   it. (The apex `postorizon.com` and the marketing homepage are a
   separate static deploy, not part of this Blueprint.)
6. **First boot checks** (in the web service's logs): the
   `prisma db push` step runs automatically at container start,
   followed by the ConfigurationChecker output (warnings are expected
   for every provider you left blank). Then register the owner
   account at the live URL — you need it for §3.

## 3. Post-deploy one-offs (Render Shell)

Open the **`postorizon` web service → Shell** tab. These translate
DEPLOYMENT.md §10; the only change is that Render Shell replaces
`docker compose exec postiz …`:

```bash
# 3a. Verify RUN_CRON reached the apps (§10.3)
printenv RUN_CRON
#   → must print: true
curl -s localhost:3002/health/status
#   → orchestrator health: it connects to Temporal and describes
#     the namespace. There is no Temporal UI in v1 — this endpoint
#     plus the service logs are the substitute for smoke check §8 #11.

# 3b. Encrypt stored channel tokens — Phase 5 backfill (§10.1)
#     Moot on a brand-new deployment with no channels connected yet;
#     run it after the first channels exist, and any time later —
#     it is idempotent.
cd /app && pnpm --filter ./apps/commands run build \
  && node ./apps/commands/dist/apps/command/src/main.js integrations:encrypt-tokens
#   expected: "Scanned N integrations, encrypted tokens on M"

# 3c. Grant the first platform admin (§10.4) — DO THIS
#     (register your owner account in the app first; the email must
#     be an existing account)
cd /app && pnpm --filter ./apps/commands run build \
  && node ./apps/commands/dist/apps/command/src/main.js admin:grant you@example.com
#   the /admin console has no admins until this runs — by design.
```

- **Session cutover (§10.2): not applicable here.** That decision
  concerns pre-Phase-5 session tokens in an existing database; a
  Render deployment starts with an empty one.
- **Locking registration:** after creating the owner account, set
  `DISABLE_REGISTRATION` to `"true"` in the web service's Environment
  tab (it redeploys) if this deployment should stay private
  (DEPLOYMENT.md §7 step 5). Revert it from the same place.

## 4. Day-2 notes

- **Deploys** follow the linked branch automatically. Every deploy
  rebuilds the image, restarts the single app container (brief
  downtime — uploads persist on the disk; database, Key Value and
  Temporal are managed services and are unaffected), and re-runs
  `prisma db push` at start.
- **The Meta data-deletion callback URL** for the Facebook app
  settings is `https://app.postorizon.com/api/public/meta/data-deletion`
  (DEPLOYMENT.md §3.5).
- **Back up before schema changes:** `db push` is not a versioned
  migration and can be destructive on renames/drops (§6). Render
  Postgres includes point-in-time recovery on paid tiers — know where
  the database's **Backups** tab is before you need it.

## 5. Gaps and watch items

1. **First-build duration is unknown.** The image build runs
   `pnpm install` + all three app builds; the compose flow never
   measured it against Render's build limits. If the first build
   times out, the fix is a larger Render build instance (dashboard →
   service → Settings) or pre-building the image to GHCR and
   switching the service to pull `ghcr.io/rankint360/postorizon:latest`
   (the tag compose already produces).
2. **No Elasticsearch → SQL visibility.** Workflow listing works, but
   Elasticsearch-only advanced-visibility features are unavailable,
   and there is no Temporal UI to inspect workflows with. v1 accepts
   this; verification is the orchestrator health endpoint (§3a) and
   logs. Adding a `temporalio/ui` private service later is a small,
   purely additive step if debugging ever demands it.
3. **Temporal dynamic config is not mounted.** Compose mounts
   `./dynamicconfig/development-sql.yaml`; a prebuilt-image private
   service has no repo mount, so Temporal runs with its defaults.
   The file's two settings are tuning-only: `limit.maxIDLength: 255`
   *is* Temporal's default, and
   `system.forceSearchAttributesCacheRefreshOnRead: true` is marked
   "dev setup only" in the file itself. One cosmetic consequence:
   after a restart, the custom search attributes the backend
   registers at boot (`organizationId`, `postId` — DEPLOYMENT.md §5)
   can take up to the server's cache-refresh interval to become
   listable. Nothing to fix unless that ever bites.
4. **Temporal database creation.** The auto-setup image creates its
   `temporal` and `temporal_visibility` databases on
   `postorizon-temporal-db` at first boot. Render Postgres supports
   additional databases on an instance (per Render's docs), so this
   is expected to work — if the Temporal service's first logs instead
   show database-creation permission errors, that's the thing that
   failed, and the fallback is a private-service Postgres mirroring
   compose. Also: the tier's connection ceiling (100) is shared by
   Temporal's connection pools — fine at v1 scale; if the Temporal
   logs show pool exhaustion, resize that database first.
5. **`TEMPORAL_ADDRESS` wiring.** It is set from the Temporal
   service's `hostport` property. After creation, confirm in the web
   service's Environment tab that it resolved to
   `postorizon-temporal:7233`; if it didn't, set that literal value
   manually (private-network DNS names equal service names, and
   Temporal always listens on 7233).
6. **`/config` is a watch item, not a disk.** Compose mounts a
   `postiz-config` volume at `/config`, but a repo-wide grep (code,
   scripts, pm2 configs, Docker files) finds **no consumer** of that
   path — only `docker-compose.yaml` itself mentions it. So no disk
   is provisioned. If anything ever writes there in future, it will
   land on the container's ephemeral filesystem and vanish on
   redeploy; that's the moment to revisit (a service can attach only
   one disk — the likely move then is uploads to Cloudflare R2
   storage per DEPLOYMENT.md §3.2, freeing the disk for `/config`).
7. **One instance, by construction.** The uploads disk pins the web
   service to a single instance; horizontal scaling requires moving
   uploads to object storage first (same R2 note as above).
8. **Never set `NOT_SECURED`** in the dashboard — it strips cookie
   and CORS protections (DEPLOYMENT.md §3.6). It is deliberately
   absent from the Blueprint.
