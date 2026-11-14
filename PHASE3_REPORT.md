# Postorizon — Phase 3 Report

**Branch:** `postorizon/phase-3`, created from Phase 2 head `194cd60` (the two CI fixes included; remote equivalent `3a252625`).
**This branch was NOT pushed** — the parent agent pushes and runs CI verification.
**Totals:** 8 item commits + this report commit; 34 files changed vs `194cd60`, +3,266 / −18 (before this report).
**Rules honoured:** additive-only Prisma changes (the schema diff contains zero removed lines); no new dependencies; `pnpm-lock.yaml` untouched; no prices and no per-tier entitlements changed anywhere (`pricing.ts` untouched); nothing faked — every number shown anywhere is computed from real persisted data, and every surface has an honest not-enough-data state.

## Exact commit list

| Commit | Item |
| --- | --- |
| `a86eb81` | 1 — Engagement persistence: `PostEngagementSnapshot`, sampling service, read API + best-time API |
| `9ab53cf` | 2 — Best-time scheduling UI: suggested-time chips in the composer (API landed in `a86eb81`) |
| `13f1ed2` | 3 — Agent feedback loop closure: weekly plan learns from persisted engagement |
| `46d8d36` | 4 — Prescriptive analytics v1: rule-based "what to post next" API + analytics page section |
| `09626da` | 5 — White-label agency v1: org branding, branded approval page, public client report |
| `bf39259` | 7 — Reliability surfacing: per-channel health API + warning badge in the channel list |
| `2bbaae5` | 6 — Inbox frontend page |
| `a88a3ab` | 8 — Mobile capture v1 (web) + nav entries for Inbox and Capture |
| (this report) | PHASE3_REPORT.md |

---

## Item 1 — Engagement persistence (foundation)

**What existed:** analytics were live-only. `PostsService.checkPostAnalytics(orgId, postId, date)` and `IntegrationService.checkAnalytics` call the provider's `postAnalytics`/`analytics` per request and cache in Redis for an hour; nothing was ever written to the database (Phase 1 finding, and the documented blocker for best-time, the agent loop and prescriptive analytics).

**Implemented:**
- **Schema (additive):** `PostEngagementSnapshot` — org/post/integration ids + denormalized `providerIdentifier` and `publishDate`, `capturedAt`, normalized metric columns (`views`, `reach`, `likes`, `comments`, `shares`, `saves`, `clicks`, `quotes` — all nullable: null means "provider did not report it", which is not a reported zero), a computed `engagement` total, `metrics` (JSON, the normalized buckets) and `raw` (JSON, the provider `AnalyticsData[]` exactly as returned, so no provider detail is lost). Back-relations added on `Organization`, `Post`, `Integration`.
- **Normalization** (`engagement.service.ts`): provider labels were collected from the actual `postAnalytics` implementations (X: Impressions/Likes/Retweets/Replies/Quotes/Bookmarks; Instagram: Views/Reach/Saved/Likes/Comments/Shares; etc.) and mapped to canonical buckets. Synonym rule: when two labels map to one bucket the **largest** value wins — summing synonyms (e.g. Views + Impressions for the same count) would double-count. `engagement` = likes+comments+shares+saves+clicks+quotes, falling back to a provider-reported engagement total only when no components exist.
- **Sampling** (`EngagementService.samplePost` / `sampleOrganization`): calls the **same** `PostsService.checkPostAnalytics` path the analytics controller serves (token refresh, `RefreshToken` retry and the `{missing: true}` case all inherited). Candidates = the org's `PUBLISHED`, non-deleted posts with a `releaseId`, published within the window (default 30 days, newest first, default cap 50, max 200). Per-post failures are isolated and counted (`sampled`/`skipped`/`failed`); a snapshot is only written when the provider returned at least one metric series.
- **Trigger:** `POST /engagement/sample` (authenticated, org-scoped; `SampleEngagementDto` bounds days 1–365, limit 1–200). The analytics page's "Update data" button (Item 4) calls it too.
- **Read API** (`apps/backend/src/api/routes/engagement.controller.ts`, registered in the authenticated controller list): `GET /engagement/posts/:postId` (time series), `GET /engagement/integrations/:integrationId` (snapshots across a channel's posts, with post context). Aggregates always use the **latest snapshot per post** (provider post metrics are cumulative lifetime totals — summing snapshots would double-count); the dedupe lives in `EngagementService.latestPerPost`.

**Remains (documented, not faked):**
- **No recurring schedule.** Temporal schedules live in the orchestrator app and are registered per workflow at worker boot; adding a sampling workflow + schedule registration there is a separate, careful change (new workflow, activity, schedule registration, deploy ordering). Until then sampling is on-demand via the endpoint/button. This is the single biggest remain of the phase.
- Sampling is sequential per post (provider rate limits make naive parallelism unsafe); a batch of 50 can take a while when token refreshes occur (`refreshWait` providers sleep 10s). A queue/worker split belongs with the scheduling work above.

## Item 2 — Best-time scheduling (§3.2.6)

**Implemented:**
- `EngagementService.getBestTimes`: from latest-per-post snapshots (optionally per integration), bucket engagement by weekday/hour of `publishDate`. **Timezone:** publish timestamps are stored in UTC and `Organization` carries no timezone field, so the offset is a client input (`tzOffset` query param, minutes east of UTC) and is **returned in the payload** rather than hidden; the frontend sends the offset of the app's selected timezone (`getTimezone()` + an Intl-based offset computation). Bucketing is plain UTC math on the shifted instant — no dayjs plugin dependency.
- **Minimum-sample rule (stated in the API):** fewer than **8 distinct sampled posts** → `{ insufficientData: true, postsSampled, minimumRequired: 8, slots: [] }`. Ranked buckets additionally need ≥ 2 posts each; top 5 returned with `avgEngagement` and the post count behind each.
- **Endpoint:** `GET /engagement/best-times?integrationId=&tzOffset=`.
- **Frontend** (`components/new-launch/best.time.chips.tsx`): up to 3 chips ("Tue 14:00") in the composer footer next to the `DatePicker` in `manage.modal.tsx`; clicking sets the picker to the next occurrence of that weekday/hour via the existing `setPickerDate` (constructed with `newDayjs()`, so the app's timezone system is respected); the tooltip carries the average and sample size. With insufficient data the component renders **nothing** — the composer is byte-identical for users without data.

**Remains:** chips are desktop-footer only (the mobile date sheet is untouched); per-integration filtering is API-only (the chips use org-wide data, which is the common case for a multi-channel composer).

## Item 3 — Agent feedback loop closure (§3.2.2 completion)

**Implemented:** `WeeklyPlanService` now injects `EngagementService` and, per run, loads `getPerformanceSummary(orgId, customerId)` — the customer group's latest-per-post snapshots reduced to: top 5 posts by measured engagement (provider, engagement total, content excerpt), average engagement, and the group's best weekday/hour slots (same bucketing as Item 2). When a summary exists it is added to the generation prompt as a distinct section ("Measured performance of this brand's recent posts… lean into these topics and formats, do not copy them"), and the result gains `performancePostsUsed`. **When no snapshots exist for the group, the prompt and behaviour are exactly Phase 2's** (content history + brand voice only) — verified by construction: the performance section is only appended when the summary is non-null.

**Signals fed in, exactly:** top-post excerpts with per-post engagement totals; group average engagement; top-3 weekday/hour slots with their average engagement. Nothing else — no follower counts, no per-provider benchmarks, no invented trends.

**Remains:** plan *placement* still uses the Phase 2 fixed 10:00 + 2h slot ladder — the best slots inform the model's copy, not the calendar placement (placement by best-slot is a natural follow-up once slot data is denser). The loop's quality is bounded by sampling coverage (Item 1 remain: no recurring sampling yet).

## Item 4 — Prescriptive analytics v1 ("what to post next")

**Implemented:** `GET /engagement/recommendations?tzOffset=` (`EngagementService.getRecommendations`) + a "What to post next" section at the bottom of the existing analytics page (`components/platform-analytics/recommendations.component.tsx`, rendered by `PlatformAnalytics`).

Rules — all over the org's own real aggregates, each recommendation carrying its underlying numbers in `data` and in its detail text:
- **Best time:** the top weekday/hour slot (same rule/engine as Item 2).
- **Content patterns:** media-vs-no-media, question-vs-no-question, short (<100 chars)-vs-long — a pattern is only reported when **both** sides have ≥ 3 sampled posts **and** the stronger side's average engagement is ≥ 1.25× the weaker side's.
- **Strongest recent post:** the top post by engagement, quoted as a format template (a fact, labelled as such).
- **Cadence gaps:** published-post counts over the last 4×7 days from the posts table (independent of sampling): nothing in 28 days, a silent last week, or last week below half the prior 3-week pace each produce a specific, numbered recommendation; a healthy cadence produces none.

**Honest states:** below the 8-post minimum the engagement-derived recommendations are suppressed and the payload says `insufficientEngagementData: true` with the counts (cadence can still fire — it needs no engagement data). The section header always shows the sampled-post count, and its **"Update data"** button runs `POST /engagement/sample` and refetches, so the page is usable end-to-end. No AI generation anywhere in this item.

**Remains:** patterns are univariate (no interaction effects, no per-provider normalization — cross-network engagement scales differ, which is why no provider-vs-provider recommendation is emitted); cadence uses calendar weeks of 7 days ending today, not ISO weeks.

## Item 5 — White-label agency v1

**Implemented:**
- **(a) Branding storage:** additive `OrganizationBranding` model (one row per org: `logoUrl`, `accentColor`, `portalName`), following the org-settings pattern of the Phase 2 AI settings. Service validates the accent colour as `#RRGGBB` server-side. API (admin-gated, same `Sections.ADMIN` policy as `/settings/ai-keys`): `GET/PUT /settings/branding` (`apps/backend/src/api/routes/branding.controller.ts`, `BrandingDto`). Settings UI: `components/settings/branding.component.tsx`, registered in `GlobalSettings` — fields + colour picker, plus the report-link manager below.
- **(b) Approval page branding:** the public approvals endpoint now also returns the post-org's branding (display fields only, org id never exposed); `approve/[token]/page.tsx` renders the logo, the portal name under the title, and an accent top-border; the accent also colours the Approve button via a new optional `accentColor` prop on `ApprovalActions`. No redesign — with no branding set the page is unchanged.
- **(c) Public client report:** `Customer.reportToken` (additive, unique, nullable — the `Post.approvalToken` pattern). Token management (admin): `GET/POST /settings/customers/:customerId/report-token` (ensure — never rotates implicitly) and `POST …/report-token/rotate`. Public read-only endpoint `GET /public/reports/:token?from=&to=` (`PublicClientReportController`, registered outside the authenticated list, `ThrottlerRealIpGuard` + 60/hour throttle like the approval link) returns: branding, period (default last 30 days), the client's published posts in the period (via its channels), per-post engagement from the latest snapshots, totals, and top 5 posts. **Unsampled posts report `engagement: null`** — nothing is estimated. Page: `app/(app)/(preview)/report/[token]/` mirroring the approve page (server component + `internalFetch` + `PreviewWrapper` layout), with totals cards, an explicit "engagement shown for X of Y posts" note when sampling is partial, top posts and the full list with release-URL links.

**Remains:** branding applies to the approval page and the report page only (not to emails or the public post preview `p/[id]`); the logo is a URL (no upload flow — the media library could back one later); there is no per-customer branding override (branding is org-wide, matching how a white-label agency presents itself); the report period is URL parameters — the page offers no period picker UI yet.

## Item 6 — Inbox frontend page

**Implemented:** `app/(app)/(site)/inbox/page.tsx` + `components/inbox/inbox.component.tsx` over the Phase 2 API, plus an **Inbox** entry in the main menu (`top.menu.tsx`). Queue list with source filter tabs (All / Comments / Approvals — client-side, since the API has no source filter; noted in a code comment), an unread-only toggle that refetches with `unreadOnly=true`, cursor "load more", per-item: source badge, channel icon/name, post excerpt + state, author (with "via link" marking), approval-state chip, read/unread styling, **Mark read/unread** and **Assign to me / Unassign** wired to `PATCH /inbox/:sourceType/:sourceId/state` (current user from `useUser()`), assignee display ("Assigned to you" / "Assigned"). Comment items get a reply box posting to the existing thread passthrough (`POST /inbox/comments/:id/reply`) and a **Suggest reply** button that calls `POST /inbox/comments/:id/suggest-reply` and inserts the result into the reply draft with a "review before sending" caption — **never auto-sent**, and the failure state tells the user to check their AI key. Approval items explain that decisions happen in the calendar's approval modal. Honest empty/loading/error states included.

**Remains:** no assignee picker (assign-to-me/unassign only — there is no user-directory endpoint in the API to pick from); no bulk actions; external platform comments/DMs remain impossible (no provider read API exists upstream — unchanged from Phase 2).

## Item 7 — Reliability surfacing

**Implemented:** `IntegrationHealthService` (`libraries/.../integrations/integration.health.service.ts`) + `GET /integrations/health` (declared before `/:id` in `IntegrationsController`, same placement rule as `/list`). Per non-deleted channel of the org: `tokenExpiration`, `tokenState` (`ok` / `expiring_soon` / `expired` / `unknown` when no expiry is recorded), `daysUntilExpiration`, `refreshNeeded`, `disabled`, and publish-error stats from the `Errors` table over the trailing **30 days** (count + latest, joined through the error's post — the `Errors.post` relation that exists in the schema). **Threshold, stated:** expiring soon = expiry within **7 days**. Frontend: `ChannelHealthBadge` in the calendar's channel list (`launches.component.tsx`, next to the channel name in `MenuComponent`) — amber "!" for expiring soon, red for expired or any errors in the window, with a combined tooltip; healthy channels render nothing. The badge hook shares one SWR key across all rows, so the list makes exactly one health request.

**Remains — display layer only, by design:** no new retry/refresh machinery (the Temporal refresh workflow already owns renewal; `refreshNeeded` reconnect UX already existed); no proactive notifications (email/in-app alerts on expiring tokens would ride the existing notifications service — a small follow-up); the publish-status view from §3.2.4 ("delivered first-try per network") is only partially answered — error counts are surfaced, a per-post delivery timeline is not.

## Item 8 — Mobile capture v1 (web)

**Implemented:** `app/(app)/(site)/capture/page.tsx` + `components/capture/capture.component.tsx`, plus a **Capture** menu entry. Mobile-first single column (max 640px, large touch targets): textarea with character count, optional media-URL field, channel checkbox list from the existing `useIntegrationList` (first non-disabled channel pre-selected), and Save → `POST /posts` with the proven draft payload shape (same body the server-side agent and the debug-import modal use: `type: 'draft'`, one entry per selected channel sharing one cross-post `group`, minimal `__type` settings, media URL as a `MediaDto`-shaped `{ id, path }` entry). Success clears the text and keeps the channel selection; validation messages from the API are surfaced. The page copy states plainly that this is **web capture that saves a draft** — not a native app.

**Remains:** this is responsive web, **not** a native or installable app (no share-sheet integration, no offline queue); media is by URL only (no upload from the capture page — the media library upload flow remains the composer's); drafts land unassigned with no customer-group pre-selection beyond the channels chosen.

## Out of scope (unchanged blockers, not attempted)

- **TikTok/WhatsApp/Reddit external inbox ingestion:** no provider in this codebase exposes a read API for external comments/DMs; needs per-platform read methods + the developer-app programme (DEV_APPS.md).
- **Webflow/Wix/Shopify/Mailchimp channels:** need registered OAuth developer apps.
- **Native mobile apps:** §3.3 keeps the MVP on responsive web + extension.
- **Pricing:** untouched, per the owner's standing deferral.

---

## Verification performed

- Every new/edited TS/TSX file parse-checked with the repo's TypeScript (`transpileModule`, diagnostics): all OK.
- **Prisma relation audit (the Phase 2 CI-failure class):** every `include`/`select`/relation filter in new code was checked field-by-field against `schema.prisma` — `Post.integration`, `PostEngagementSnapshot.{post,integration,organization}`, `Errors.post`, `Customer` (scalar `reportToken` only, no invented relations), `OrganizationBranding.organization`. Author-style resolution-by-id is used wherever a relation does not exist.
- **Hook/context audit (the other CI-failure class):** no existing hook or context value was extended; the only existing-component edits are additive renders (`BestTimeChips` in the composer footer guarded by `{!dummy && …}`, `ChannelHealthBadge` in the channel row, `RecommendationsComponent` in the analytics pane, `BrandingComponent` in `GlobalSettings`, two menu entries) plus one optional prop (`accentColor`) added to `ApprovalActions`' props type and both of its call sites (the single existing one) updated.
- **DI audit:** new providers (`EngagementRepository`, `EngagementService`, `BrandingRepository`, `BrandingService`, `IntegrationHealthService`) all registered in `DatabaseModule` (whose `exports` getter returns the full provider list); new controllers registered in `ApiModule` (authenticated list for `EngagementController`/`BrandingController`, non-auth list for `PublicClientReportController`, mirroring `PublicPostApprovalsController`). Dependency graph checked acyclic: `EngagementService → PostsService`; `WeeklyPlanService → EngagementService`; `BrandingService → EngagementService`; no back-edges (PostsService's constructor takes none of the new services). No spec/test file constructs the changed services manually.
- **Route-order check:** `GET /integrations/health` is declared before `GET /integrations/:id` (the same reason `/list` works); the engagement controller's literal routes (`best-times`, `recommendations`) cannot collide with its `:postId`/`:integrationId` routes (different first segments).
- Schema diff reviewed line-by-line: additive only (2 new models, 1 new scalar field, 4 back-relation lines, comments); `git diff` for the schema shows **zero removed lines**. `pricing.ts` and all entitlement code untouched.
- `git status` clean at every commit boundary; one commit per item.
- **Not verifiable in this sandbox (same limitation as Phases 0–2):** full type-check/build and `prisma validate`/`generate` — the Prisma engine download fails here, so CI (install → prisma-generate → frontend+backend build) is the authoritative check, as it was for Phases 1–2.

## Risks

1. **CI is the first full compile.** Transpile checks catch syntax, not type errors. Highest-risk spots, in order:
   - **Prisma-typed snapshot writes/reads** (`engagement.repository.ts`): the `metrics`/`raw` JSON fields are cast `as any` on write (the proven Phase 2 pattern), but the typed `create`/`findMany` shapes and the nested relation filter `post: { integration: { customerId } }` in `listForAggregation` are first-compile surface. The relation chain exists in the schema (verified), so this should generate cleanly.
   - **`BrandingService.getClientReport`'s `sum` helper typing** (`(typeof reportPosts)[number]['engagement']` with `NonNullable`) — plain TS, but the most intricate type expression in the phase.
   - **`getPerformanceSummary` return shape** consumed by `WeeklyPlanService` (`topPosts[].excerpt`, `bestSlots`) — both sides are in-repo types written in this phase; a mismatch would surface as a backend build error in `weekly.plan.service.ts`.
   - **DI wiring of the five new services** (all in `DatabaseModule`, see Verification) and the two controllers whose constructors gained a dependency (`IntegrationsController`, `PublicPostApprovalsController`) — a missing provider would fail at runtime boot, not at build; the registrations were re-read after editing to confirm.
2. **Live provider behaviour of sampling** is untested against real accounts (no credentials in the sandbox): `checkPostAnalytics` is the app's own proven path, but providers with `refreshWait` make batch sampling slow, and any provider whose `postAnalytics` throws outside its internal try/catch would count as `failed` for that post (isolated by design).
3. **Best-time semantics:** buckets use the *publish instant shifted by the viewer's current offset* — DST transitions mean a post published in another DST phase can land an hour off its wall-clock slot. Acceptable for v1 ranking; noted here so it is a known simplification, not a surprise.
4. **Report/approval pages** render branding from user-supplied URLs (logo) and a validated hex colour; the logo URL is rendered as an `<img src>` only (no HTML injection surface), and the accent colour is regex-validated server-side before it is ever interpolated into a style.
