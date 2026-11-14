# Postorizon — Phase 4 Build Report (launch readiness)

- **Branch:** `postorizon/phase-4`, based on `postorizon/phase-3-remediation`
  (790fb53 = remote f5345010, CI-green). **14 commits (incl. this report),
  24 files, ~+1,300 / −30.** Local only at time of writing — the parent pushes, then CI
  is the authoritative compile check (see Verification).
- **Theme:** verification, visibility, hardening. All six items were built —
  nothing was cut. The parked list (OAuth Web2 four, external inbox
  ingestion, live channel tests, Mastra/media BYOK redesign, pricing) is
  untouched, as is `pricing.ts`/entitlements. No new dependencies; no Prisma
  schema changes at all this phase.
- **Method note:** two read-only research subagents gathered evidence for
  items 4 and 5 (audit seams; deployment facts); all fixes and documents
  were written and verified by the coordinator.

---

## Item 1 — CI covers the orchestrator · ✅ BUILT (`35063de`)

`.github/workflows/ci.yml` gained a **Build orchestrator** step
(`pnpm --filter ./apps/orchestrator run build` — the app's own script,
`cross-env NODE_ENV=production nest build`) after Build backend. The
existing install + `prisma-generate` steps precede it, which the
orchestrator needs (its services use the generated client).

**What the new step proves:** the orchestrator — including the Phase 3
engagement-sampling workflow/register/activity and the remediation's
token-expiry path — type-checks against the real generated Prisma client,
which it never has before. **What it does not prove:** runtime behaviour —
that workflows register and run still needs `RUN_CRON` set and a real
deployment (Item 5), and Temporal bundling executes inside `nest build`'s
output, not a live worker boot.

**Local verification (as far as the sandbox allows):** parse checks pass on
all orchestrator Phase 3/remediation files. A full local `nest build` was
attempted: it runs out of the default heap; with a raised heap it produces
552 errors, **every one downstream of this sandbox's stub `@prisma/client`**
(no engine download available here) — and **zero errors in the Phase
3/remediation orchestrator files** beyond the same stub-`TS2305` import
class that hits every file importing the client. This is the known sandbox
limit, stated plainly: the new CI step is the first real compile check.

## Item 2 — Per-post delivery timeline (§3.2.4 completion) · ✅ BUILT (`4fc1f36`)

The missing per-post publish-status view, built **only from persisted
fields** — no synthesised attempts, no invented timestamps:

- **Backend:** new `PostDeliveryService`
  (`libraries/nestjs-libraries/src/database/prisma/posts/post.delivery.service.ts`,
  registered in `DatabaseModule`) behind authenticated
  `GET /posts/:id/delivery` (org-scoped, 404 for foreign/missing posts —
  the `BrandVoiceService` pattern). Events: `created` (Post.createdAt),
  one per `PostApproval` audit row (state, comment, via-link flag), 
  `scheduled` (Post.publishDate, the planned time), one per `Errors` row
  (provider message + platform — the recorded publish failures), and
  `published` (state + releaseURL) **with `at: null`**: no persisted field
  records when publishing completed, and `Post.updatedAt` moves on later
  edits, so showing it would fabricate a time. `deliveredFirstTry` is
  computed from the recorded rows (PUBLISHED with zero Errors rows).
- **Frontend:** `DeliveryTimeline` section at the bottom of the existing
  statistics modal — visible in both the normal and missing-release states,
  carrying its own SWR load, rendering the first-try / after-N-failures
  summary, timestamps ("Time not recorded" for the published event), error
  messages and the live-post link.

## Item 3 — Brand voice via the agent seam · ✅ BUILT (`95ef303`)

The R-034 remain, closed the documented way — `/copilot/chat` untouched
(no seam, no customer context there — still a product decision):

- **Backend:** `POST /copilot/agent` now reads `forwardedProps.customerId`;
  when present, it resolves the customer's profile via
  `BrandVoiceService.getProfile(authenticatedOrgId, customerId)` — which
  validates org membership and throws for foreign/unknown customers; any
  failure leaves the context unset — and sets the rendered
  `voicePromptFragment` on the AG-UI `RequestContext` (new optional
  `brandVoice` key on `ChannelsContext`). `LoadToolsService`'s agent
  instructions append the fragment as a brand-voice section when present
  (the same context read pattern as the existing `ui` key). **No
  customerId → instructions byte-identical to before.**
- **Frontend:** the agent page's channel selection already knows each
  channel's customer group (`/integrations/list` embeds it). When **every**
  selected channel belongs to one group, `AgentChat` forwards that
  `customerId` alongside `integrations`; mixed/empty selections forward
  nothing. No global customer switcher was invented.

## Item 4 — Security audit + targeted fixes · ✅ BUILT (audit `e9f00e4`; fixes `df1b0a2`, `1f08cb8`, `f97db78`, `7c05006`, `c407f0e`)

Full evidence and verdicts in **SECURITY_AUDIT.md**. Headline:
**1 seam ok · 5 fixes · 2 structural flags.**

- **(a) Auth/session:** bcrypt(10), httpOnly+secure cookie-only sessions,
  per-request DB re-resolution — sound within a **flagged design**: session
  JWTs have no expiry/revocation and share `signJWT` with one-shot tokens
  (auth redesign — flagged, not rewritten). **Fixed:** credential endpoints
  (register/login/forgot/reset) had no enforced throttling → 30/hour/IP via
  the controller's own established guard pattern.
- **(b) Integration tokens at rest: FLAGGED** — `token`/`refreshToken` are
  stored plaintext on every write path; no decrypt seam exists (~30 bare
  `PrismaClient` consumers) and Skool already receives ciphertext, so a
  safe fix needs a boundary + migration design. (BYOK keys, OAuth secrets,
  org API keys *are* encrypted — ok.)
- **(c) Webhooks: OK** — Stripe verifies `constructEvent` on the raw body
  before processing, fail-closed; RevenueCat shared-secret check
  fail-closed with server-side re-fetch.
- **(d) Public token endpoints: FIXED** — throttling/rotation were already
  sound, but tokens were minted with `Math.random` → new CSPRNG
  `makeSecureId` at all three minting sites (same alphabet/length;
  `makeId` untouched for its ~80 non-security callers); and the
  unauthenticated post preview leaked the full Post row **including
  `approvalToken`** → four capability/internal fields stripped
  (`organizationId` deliberately kept — the preview's comment-moderation
  check needs it and it authorises nothing; reasoning documented in the
  audit).
- **(e) Uploads: FIXED** — the streamed path was already sound; the R2
  multipart *completion* never verified assembled size → head-object check
  against the shared caps with delete-on-oversize; and both backends'
  `uploadSimple` buffered whole bodies uncapped → per-type caps applied
  (audio takes the 10 MB image cap; `getMaxSize` has no audio branch by
  design).

## Item 5 — Deployment readiness pack · ✅ BUILT (`3c58957`)

**DEPLOYMENT.md**: services/ports of the compose stack, per-service env
tables (core, storage, email, Stripe, channels), the db-push schema flow
(no migrations folder), build/start order, Temporal worker notes, and a
12-point smoke checklist mapped to MVP_SPEC §7. It states up front that it
is **unverified by execution** (no Docker in this sandbox) and flags the
headline caveat: **the inherited compose file pulls the upstream Postiz
image — deploying Postorizon needs an image/build decision first (D2)**,
plus nine more documented gaps (D1: no email config in compose, so accounts
silently auto-activate; D3/D4: broken `var/docker` helper scripts; D5–D9).

**Compose fixes applied** (statically evident defects only, each verified
against the code): **F1** `RUN_CRON: 'true'` on the app service — both
recurring workflow registers gate on it and it was set nowhere, so neither
`missingPostWorkflow` nor `engagementSamplingWorkflow` would ever start in
a compose deployment; **F2** `NEXT_PUBLIC_UPLOAD_DIRECTORY` →
`NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY` (the only name the code reads; the
old one had zero reads); **F3** app `depends_on` gains
`temporal: service_started` (no healthcheck exists on temporal).

## Item 6 — Completeness set · ✅ ALL THREE BUILT

- **6a Per-integration best-time chips** (`103b6b8`): `BestTimeChips` gains
  an optional `integrationId` (channel-scoped SWR key + the API's existing
  filter); `ManageModal` passes it at both call sites (desktop + mobile
  sheet) only when exactly one channel is targeted.
- **6b Report custom range** (`3be89fb`): a plain GET form with two date
  inputs beside the 7/30/90 presets on the public report page — the API
  already accepted `from`/`to`; no client JS needed.
- **6c Branding logo upload** (`5d8ae38`): an upload alternative beside the
  logo URL field using the existing `/media/upload-simple` flow; the
  returned path lands in the same `logoUrl` state and persists via the
  normal Save (the DTO accepts any string). The settings form did not fight
  back — no skip needed.

---

## Verification (this phase)

- **Relation audit:** `PostDeliveryService` uses only schema-verified
  fields — Post (state/approvalState/publishDate/releaseId/releaseURL/
  error/createdAt/deletedAt + `integration` select id/name/
  providerIdentifier/picture), Errors (message/platform/createdAt),
  PostApproval (state/comment/viaLink/createdAt), all checked field-by-field
  in `schema.prisma`. No Prisma schema change was needed or made.
- **Hook/return audit:** no hook or context return shapes changed. The two
  signature changes are additive-optional: `BestTimeChips`'
  `integrationId?` (both call sites updated in the same commit) and
  `ChannelsContext.brandVoice?` (backend type only; read with the existing
  `as never` pattern).
- **Bare-array sweep:** zero `: [],` in this phase's added frontend lines
  (checked over `git diff` of the branch); no new untyped object literals
  with array fields were introduced.
- **DI audit:** `PostDeliveryService` added to `DatabaseModule` providers
  (its `exports` getter mirrors providers) and injected as
  `PostsController`'s 4th dependency; `BrandVoiceService` was already a
  `DatabaseModule` provider and is now also injected into
  `CopilotController` (same ApiModule pattern as `ai.settings.controller`).
  Greps confirm no spec/test constructs `PostsController`,
  `CopilotController` or `PostDeliveryService` manually.
- **Parse checks:** every touched TS/TSX file passes the repo's TypeScript
  `transpileModule` check. Full type-checking happens in CI (the sandbox
  cannot generate the Prisma client — the known, stated limit; Item 1
  documents the local orchestrator build attempt and its stub-only errors).
- **Doc cross-checks:** every env var, service and defect in DEPLOYMENT.md
  traces to the static harvest (§ references in the working notes);
  SECURITY_AUDIT.md verdicts trace to file/line evidence gathered before
  any fix was written.

## Risks / remains

1. **CI is the first true compile** of this branch (as with every phase) —
   including the first-ever orchestrator build. Expect the usual possibility
   of a stub-masked type error surfacing there; the three known failure
   classes were specifically swept (see Verification).
2. **The two security FLAGS remain open by design:** session
   expiry/revocation (auth redesign) and plaintext integration tokens
   (needs a decrypt boundary + migration, Skool double-encryption hazard).
   Both have recommended follow-ups in SECURITY_AUDIT.md. Until (b) lands,
   the database holds every connected channel's credentials — treat it as
   sensitive.
3. **Deployment itself is unexecuted:** DEPLOYMENT.md is a static runbook;
   the image decision (D2) and a first real boot are owner-side. The
   pre-launch gate (LAUNCH_GATE_CHECKLIST) stays parked until after
   deployment, per the user's instruction.
4. **`/copilot/chat` brand voice** remains unbuilt — it needs the product
   decision on what customer context the chat surface carries; the AG-UI
   agent seam (Item 3) is the supported path meanwhile.
5. **Delivery timeline honesty limit:** publish *completion* time is not
   persisted anywhere; if product later wants it, the publish workflow
   needs a `publishedAt` write (additive schema change, deliberately not
   smuggled into this phase).
6. Everything on the parked list stays parked (OAuth Web2 four, external
   inbox ingestion, live channel tests, icon uploads, Mastra/media BYOK
   redesign, pricing).
