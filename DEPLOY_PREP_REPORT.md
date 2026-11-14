# Postorizon — Deployment-Prep Pass Report

- **Branch:** `postorizon/deployment-prep`, based on `postorizon/phase-5`
  (1c2cb11, CI-green). **5 item commits** (a283f4d…06321d6) plus this
  report. **8 files changed, +369 / −52** (before this report). Local
  only — the parent pushes; CI is the authoritative compile check.
- **Rules kept:** `.github/workflows/ci.yml` untouched; no new
  dependencies; **zero Prisma changes**; `pricing.ts`/entitlements
  untouched; no frontend files changed.
- **Verification level:** this sandbox has **no Docker** — nothing here
  was executed end-to-end. Verification is static (file/YAML/parse
  checks, evidence greps) plus one genuinely executed functional test
  (Item 4's controller, transpiled and run against crafted inputs).
  The first real deployment remains a verification exercise, exactly as
  DEPLOYMENT.md's header warns.

---

## Item 1 — D2 resolved: compose builds our own image · ✅ DONE (`a283f4d`)

- `docker-compose.yaml`: the `postiz` service's
  `image: ghcr.io/gitroomhq/postiz-app:latest` is replaced by
  `build: { context: ., dockerfile: Dockerfile.dev }` with
  `image: ghcr.io/rankint360/postorizon:latest` naming the built result
  (push-ready). All Phase 4 compose fixes verified intact after the
  edit (RUN_CRON `'true'`, `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY`,
  `depends_on` incl. temporal — re-checked by parsing the YAML).
- **Dockerfile.dev static verification — no corrections needed:**
  Node 22.23.4 + pnpm 10.6.1 match the root `packageManager`
  (pnpm@10.6.1); the root `build` and `pm2` scripts it invokes exist, as
  do all three apps' `pm2` scripts (`pm2 start pnpm --name <app> --
  start`); `var/docker/nginx.conf` exists and listens on 5000 proxying
  3000/4200; `.dockerignore` excludes `node_modules`, `dist`, `.next`,
  `.git`. Single-stage combined-image architecture preserved as-is.
- DEPLOYMENT.md: the D2 caveat block at the top now reads "RESOLVED IN
  REPO" with the exact commands (`docker compose build postiz`;
  standalone `docker build -f Dockerfile.dev -t
  ghcr.io/rankint360/postorizon:latest .`; optional `docker push`);
  §2 table row and §7 step 1 updated to match.

## Item 2 — Remaining DEPLOYMENT.md gaps (D1, D3–D9) · ✅ DONE (`bc50d7a`)

Note: DEPLOYMENT.md defines **D1–D9 only — there is no D10.**

- **D1 FIXED (values owner-side):** prod compose gained the email
  passthrough block with clearly-marked empty placeholders
  (`EMAIL_PROVIDER`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`,
  `RESEND_API_KEY` active; nodemailer/SES sets commented). Variable
  names verified against the providers' own code (`validateEnvKeys`;
  selection logic in `email.service.ts` — anything but
  resend/nodemailer/ses, including empty, selects `EmptyProvider`, so
  the placeholders change no behaviour until filled). §3.3 updated:
  without values, no email is sent and **accounts auto-activate**.
- **D3 FIXED:** `var/docker/docker-build.sh` rewritten — it passed
  `--target dist` / `--target devcontainer` to a single-stage
  Dockerfile and failed as written; now a single plain build, with the
  reasoning in the script header.
- **D4 FIXED:** `var/docker/docker-create.sh` now publishes
  `4007:5000` (nginx) instead of the internal 3000/4200; reasoning in
  the script header.
- **D5 FIXED:** the inert `TEMPORAL_ADDRESS` was removed from the dev
  compose *postgres* service.
- **D6 RESOLVED BY DOCUMENTATION:** `apps/commands` is a one-shot CLI,
  not a service — no compose service / root-build / pm2 entry added,
  deliberately. Its deploy-time run path is documented in §10.1.
- **D7 OPEN (accepted):** no healthcheck exists inside the
  `temporalio/auto-setup` image to hang a compose healthcheck on;
  start-only ordering + auto-setup retries stand. Revisit only for a
  managed/external Temporal.
- **D8 REVIEWED, retained deliberately:** dead compose vars
  (`FEE_AMOUNT`, `STRIPE_SIGNING_KEY_CONNECT`, `SLACK_SIGNING_SECRET`)
  kept for upstream parity; harmless, and the names the code reads are
  present alongside.
- **D9 PARTIALLY FIXED:** prod `temporal-ui` CORS origin →
  `http://localhost:4007` (matches the app origin); dev Redis gained
  the `/data` volume + `redis-cli ping` healthcheck. Left: dev Postgres
  user difference (aligning would invalidate existing dev volumes) and
  dev temporal-ui CORS (host-dev origins vary).
- §9 of DEPLOYMENT.md was rewritten with these per-gap statuses.

## Item 3 — YouTube least-privilege scope cut · ✅ DONE (`075d319`)

- `youtube.provider.ts` `scopes`: **removed**
  `https://www.googleapis.com/auth/youtube` (broad umbrella) and
  `https://www.googleapis.com/auth/youtubepartner` (Content ID/partner
  operations). **Remaining** (the pack's exact recommended set):
  `userinfo.profile`, `userinfo.email`, `youtube.force-ssl`,
  `youtube.readonly`, `youtube.upload`, `yt-analytics.readonly`.
  Only the scope array (+ an explanatory comment) changed; no other
  scope references exist anywhere in the codebase (grep-verified).
- **Feature-surface risk, stated plainly:** anything that silently
  relied on the umbrella scope's full read/write access to the YouTube
  Data API beyond readonly+upload+force-ssl would now be denied by
  Google. Static surface check: the provider only constructs
  `google.youtube` v3 and `google.youtubeAnalytics` v2 clients, and no
  partner client exists in the file (`contentDetails` hits are the
  `part` parameter of `videos.list`, not the partner API) — so the
  expected impact is nil, but this is **NOT live-verified**.
- **Owner-side remains:** re-connect a real Google account and re-test
  connect → upload/publish → analytics before submitting the app for
  Google verification.

## Item 4 — Meta data-deletion callback · ✅ DONE (`569a9e6`)

- **New** `apps/backend/src/api/routes/public.meta.data.deletion.controller.ts`:
  `POST /public/meta/data-deletion`, registered in ApiModule's
  non-authenticated controller list (visually re-verified after edit —
  it is NOT in `authenticatedController`, so `AuthMiddleware` never
  runs), with the public controllers' exact throttle pattern
  (`ThrottlerRealIpGuard` + `@Throttle` 60/hour).
- **Externally reachable** as `POST /api/public/meta/data-deletion` on
  the app origin (nginx strips `/api`) — e.g.
  `https://app.postorizon.com/api/public/meta/data-deletion`. That is
  the URL to enter as Meta's Data Deletion Request Callback.
- **Verification of Meta's `signed_request`:** split on `.`,
  HMAC-SHA256 over the payload part keyed with the app secret,
  `timingSafeEqual` comparison, `algorithm` pinned to `HMAC-SHA256`.
  The secret is `process.env.FACEBOOK_APP_SECRET` — read directly from
  env exactly as the Facebook provider itself does
  (`facebook.provider.ts`); the env var already exists in the compose
  environment and DEPLOYMENT.md §3.5, which now documents the callback,
  its URL, and the secret dependency (unset secret → 500 + error log).
- **Response:** Meta's expected JSON — `{ url, confirmation_code }`,
  with `url = <MAIN_URL>/data-deletion?code=<code>` (the pack's
  instructions/status page; `MAIN_URL` defaults to
  `https://postorizon.com`).
- **Recording (documented limitation):** no schema change and no new
  table. The request is logged (Meta `user_id` + confirmation code),
  and the code is deterministically HMAC-derived from
  `user_id + issued_at`, so support can re-derive/trace any code from
  the logs. There is **no persisted deletion-request record and no
  per-code status lookup** — if Meta review or support load ever
  requires one, add a model and store `{code, userId, receivedAt}` at
  the marked spot in the controller.
- **Functional test (executed, real transpiled controller, Nest deps
  stubbed): 10/10 assertions passed** — valid request returns the
  expected deterministic code + URL; determinism across calls;
  tampered signature → 401; wrong secret → 401; malformed → 400;
  missing field → 400; payload without `user_id` → 400; wrong
  algorithm → 400; secret unset → 500.

## Item 5 — First-deploy one-offs documented · ✅ DONE (`06321d6`)

DEPLOYMENT.md gained **§10 "First-deploy one-offs"**:

- **§10.1 Token backfill:** run `integrations:encrypt-tokens` once
  after first boot — exact in-container commands (build `apps/commands`,
  run `node ./apps/commands/dist/apps/command/src/main.js
  integrations:encrypt-tokens`), expected output line, idempotency, and
  the warning that dormant channels stay plaintext until it runs.
- **§10.2 Session cutover — marked OWNER'S DECISION:** pre-Phase-5
  tokens carry no `exp`/epoch claim (epoch 0) and stay valid until a
  revocation hook fires; the recommended one-time all-users bump
  (`UPDATE "User" SET "sessionEpoch" = "sessionEpoch" + 1;` via the
  compose Postgres — table name verified: model `User`, no `@@map`)
  vs accepting natural roll-off, with the mechanism named
  (`AuthMiddleware`, `UsersRepository.updatePassword`,
  `UsersService.incrementSessionEpoch`).
- **§10.3 RUN_CRON verification:** `printenv RUN_CRON` inside the app
  container, the orchestrator health endpoint, and the Temporal-UI
  workflow check — tied to smoke checklist §8 #11, with the restart
  note (fixed workflow ids make a late start duplicate-safe).

---

## Verification sweep (whole branch)

- **Relation audit:** no new Prisma usage except none at all — zero
  schema diff on the branch; the controller reads only env + body.
- **Hook/context audit:** no frontend files touched; no hook/context
  return shapes changed.
- **Bare-array sweep:** no frontend code in this pass; the one new TS
  file introduces no untyped object literals with array fields.
- **DI audit:** one new controller, no new providers/injectables (it
  depends only on env, `Logger`, and Node crypto). Registration re-read
  after editing; grep confirms no spec/test constructs the new
  controller manually.
- **Parse checks:** `api.module.ts`, the new controller, and
  `youtube.provider.ts` all pass the repo TypeScript `transpileModule`
  check. Both compose files parse as valid YAML; both shell scripts
  pass `bash -n`; script exec bits preserved.
- **Guard checks:** branch diff contains no `.github/workflows/ci.yml`,
  no `pricing.ts`/entitlements, no `*.prisma` changes, no new
  dependencies (`package.json`/lockfile untouched).

## Owner-side remains (nothing here can close them)

1. **First real deployment itself** — host, DNS, HTTPS, real secrets
   values (incl. the D1 email values and `JWT_SECRET`), then §10's
   one-offs and the §8 smoke checklist by execution.
2. **Session cutover choice** (§10.2) — bump-all vs natural roll-off.
3. **YouTube live re-test** with a real Google account before Google
   verification submission (Item 3).
4. **Meta portal entry:** paste the callback URL
   (`https://app.postorizon.com/api/public/meta/data-deletion`) as the
   Data Deletion Request Callback when submitting the Meta app — the
   pack (§1) also allows launching with the instructions URL and adding
   the callback before public launch; the endpoint now exists either
   way.
5. Unchanged from before: developer-app approvals, the 4 channel-icon
   uploads, trademark search, and pricing (parked until after testing
   + approvals).
