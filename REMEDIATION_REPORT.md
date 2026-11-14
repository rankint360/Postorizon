# Postorizon — Phase 3 Remediation Report

**Branch:** `postorizon/phase-3-remediation`, created from Phase 3 head `71636de` (remote equivalent `bdd2aafa`, CI-green).
**This branch was NOT pushed** — the parent agent pushes and runs CI verification.
**Totals:** 7 item commits + this report commit; 18 files changed vs `71636de`, +720 / −28. **Zero Prisma schema changes** (no item needed one) and `pricing.ts` / all entitlement code untouched. No new dependencies.

## Exact commit list

| Commit | Item |
| --- | --- |
| `da30b6c` | 1 + 6 — Recurring engagement sampling (orchestrator workflow) + token-expiry notifications riding the same run |
| `444a108` | 2 — Agent placement by best slot |
| `12b89c4` | 3 — Inbox assignee picker |
| `05d8104` | 4 — Client report period picker |
| `650c5a8` | 5 — Branding on the public post preview |
| `467f999` | 7 — Best-time chips in the mobile date sheet |
| `28977eb` | 8 — Capture completeness (media upload + group pre-selection) |
| (this report) | REMEDIATION_REPORT.md |

Item 9 (stretch) was investigated and **not built** — see its section for the precise blocker.

---

## Item 1 — Recurring engagement sampling ✅ built

**Finding first:** this codebase has **no Temporal Schedule registrations anywhere** (grep-verified: no `ScheduleClient`/`schedules.create`, and no `@nestjs/schedule`/`@Cron` either). Periodic work is done the Postiz way: infinite `sleep` + `continueAsNew` workflows (`missingPostWorkflow`, `autoPostWorkflow`, …) started once by an `OnModuleInit` register gated on `RUN_CRON` (`InfiniteWorkflowRegister`). The implementation mirrors those patterns exactly rather than introducing a second, foreign scheduling mechanism.

**Implemented:**
- **Workflow** (`apps/orchestrator/src/workflows/engagement.sampling.workflow.ts`, exported from `workflows/index.ts`): `engagementSamplingWorkflow` — sweeps immediately, then sleeps `ENGAGEMENT_SAMPLING_INTERVAL_HOURS` (**6 hours**, a named exported constant in the workflow file) between sweeps, `continueAsNew` after ≥24 loops or history > 1000 (the `missingPostWorkflow` shape, behind a `patched()` guard). Activities proxied with `taskQueue: 'main'`, 30-minute start-to-close, 3 attempts.
- **Activity** (`apps/orchestrator/src/activities/engagement.activity.ts`): `EngagementActivity` — a thin Nest activity (the `AutopostActivity` shape) delegating to library services resolved through the orchestrator's existing `DatabaseModule` import. Registered in `apps/orchestrator/src/app.module.ts`'s single `activities` array (which feeds both `providers` and `activityClasses`).
- **Sweep** (`EngagementService.sampleAllOrganizations`, + `EngagementRepository.listOrganizationIds`): iterates all non-deleted organizations in creation order and calls the existing `sampleOrganization` per org — so per-org bounds are exactly the on-demand ones (30-day window, 50-post cap, sequential per post). Per-organization failures are isolated and counted (`organizationsFailed`); the sweep returns aggregate `{ organizations, organizationsFailed, sampled, skipped, failed }`.
- **Registration (how the "schedule" is created, deterministically):** `EngagementSamplingRegister` (`libraries/nestjs-libraries/src/temporal/engagement.sampling.register.ts`, a line-for-line mirror of `InfiniteWorkflowRegister`, exported via `EngagementSamplingRegisterModule`) is imported by the **orchestrator** `AppModule`. At orchestrator boot, when `RUN_CRON` is set, it starts `engagementSamplingWorkflow` under the fixed workflow id `engagement-sampling-workflow` with `USE_EXISTING` conflict policy — restarts and extra replicas can never create a second sweep. **Deployment action (one line): set `RUN_CRON` on the orchestrator service** — the same flag that today gates `missingPostWorkflow`'s registration on the backend service. Without it, sampling stays on-demand only (the Phase 3 behaviour); nothing else changes.

**Remains:** sampling inside an org is still sequential per post (unchanged from Phase 3 — a 50-post batch with `refreshWait` providers can take minutes; the 30-minute activity timeout and the 6-hour cadence absorb this at current scale). If a future deployment prefers real Temporal Schedules, the migration is: delete the register, `client.schedule.create` with a 6-hour interval spec targeting the same workflow id — the workflow itself needs no change.

## Item 6 — Token-expiry notifications ✅ built (rides Item 1's workflow)

**Implemented** (`IntegrationHealthService.notifyTokenExpiryForAllOrganizations`, called by `EngagementActivity.notifyTokenExpiry` in the same workflow run, after sampling):
- Sweeps all organizations; reuses `getOrgHealth` unchanged, so the states are exactly the surfaced ones (`expiring_soon` = expiry ≤ **7 days**, `expired`).
- For each affected channel, creates **one in-app notification** via the existing `NotificationService.inAppNotification(orgId, subject, message, sendEmail=false, digest=false, 'info')`. **Honest scoping:** the notifications system is org-scoped — the `Notifications` model has no recipient/user column — so "for the org's admins" is realized as an org-level in-app notification visible to the org's members (the same way the existing refresh-error notifications work). **No email** is sent: `sendEmail=true` would fan out to *all* org users via `sendEmailsToOrg`, not just admins, so in-app-only is the correct conservative choice.
- **Dedupe rule (as specified):** at most one notification per integration per state per **7 days** (`TOKEN_EXPIRY_NOTIFICATION_DEDUPE_DAYS`). Mechanism: the notification content ends with a stable marker, `tokenExpiryNotificationMarker(id, state)` = `[token-health:<integrationId>:<state>]`; before creating, the sweep scans the org's last-7-days notifications (via the previously-dead `NotificationsRepository.getNotificationsSince`, now used) for that marker and skips duplicates. The marker doubles as a support reference in the message text. State transitions (expiring_soon → expired) produce a new notification because the marker differs.
- Per-organization failures isolated; returns `{ organizations, organizationsFailed, checked, notified, duplicates }`.

**Remains:** notifications are not per-admin targeted (model limitation above); the marker is visible in the notification text (deliberate — it's the only dedupe key the free-text model supports; an additive typed model would be the cleaner long-term fix if notification types proliferate).

## Item 2 — Agent placement by best slot ✅ built

`WeeklyPlanService` (`weekly.plan.service.ts`):
- When `performance.bestSlots` is non-empty, each idea first tries the ranked slots: the plan-week day whose `day()` matches the slot's weekday, if that day is under the per-day cap and the (day, hour) slot hasn't been used this run → placed at `slot.hour:00`. Ideas that fit no slot fall back to the ladder for that idea. The **per-day cap counting** (`countPostsOnDay` load array) and the **banned-topic guardrail** are byte-for-byte the existing code paths — slot placements increment the same `load[]`.
- When there is no slot data, the slot loop iterates zero times and the ladder executes **exactly** as before (same earliest-day-first, `10 + (slotInDay % 5) * 2`).
- **Honest payload:** `WeeklyPlanResult` gains `placementMode: 'best-slots' | 'ladder'` (`'best-slots'` iff ≥1 idea was slot-placed) and `slotPlacements: number`.
- **Convention note (unchanged from Phase 3):** best slots come from `getPerformanceSummary` at UTC offset 0 (the service calls it without an offset today) and are read against the plan days' dayjs-local calendar — the same convention the generation prompt already used for these slots.

**Remains:** slot data is still gated by sampling coverage (now recurring per Item 1); each slot is used once per run by design — with denser data, allowing multiple drafts per proven slot is a policy choice for later.

## Item 3 — Inbox assignee picker ✅ built

- **Endpoint decision:** `GET /settings/team` exists but is policy-gated (`Sections.TEAM_MEMBERS`/`ADMIN` create actions) and returns email-only rows shaped for team management — a picker usable by any inbox user can't rely on it. Added the minimal endpoint instead: **`GET /inbox/members`** (`InboxController` → `InboxService.listMembers` → `InboxRepository.listOrgMembers` over the already-injected `PrismaRepository<'userOrganization'>`, `disabled: false`, selecting only `user { id, name, lastName, email }` — all verified in the schema). Returns `[{ id, name, email }]` with `name` = full name or email fallback. Plain authenticated + org-scoped, like the inbox list route.
- **Frontend** (`inbox.component.tsx`): members fetched once via SWR (`'inbox-members'`, failures degrade to an empty list); each item gains a native assignee `<select>` (Unassigned + all members) wired to the **existing** `PATCH /inbox/:sourceType/:sourceId/state` (server-side org-membership validation unchanged); the Assign-to-me/Unassign button stays. Assignee labels now resolve to the member's display name ("Assigned to <name>").

**Remains:** none for this item (bulk actions remain out of scope, as in Phase 3).

## Item 4 — Client report period picker ✅ built

`report/[token]/page.tsx` only: the server page now accepts `searchParams` (`Promise<{from?, to?}>`, mirroring `params`), forwards present params to `GET /public/reports/:token` (which already accepted the range — **no API change**), and renders **Last 7 / 30 / 90 days** preset links (plain `<a>`, the folder's local idiom) that navigate to `/report/<token>?from=…&to=…` computed at render. The effective preset is highlighted — 30 days when no params are present (matching the API default), otherwise the rounded day-span when it matches a preset. Still a read-only, no-login server component; no client components added.

**Remains:** no custom date-range inputs (presets only, as specified); presets always end "now", so a historical fixed window still needs hand-built URL params (the API supports them).

## Item 5 — Branding on the public post preview ✅ built

- **Backend:** `PublicController.getPreview` injects `BrandingService` (same import as `PublicPostApprovalsController`; same `ApiModule`, service provided by the global `DatabaseModule` — no module change) and attaches `getBranding(posts[0].organizationId)`'s `{ portalName, logoUrl, accentColor }` to every returned post. Response remains an array with **one additive field**; the only consumer of `GET /public/posts/:id` is the `p/[id]` page itself (grep-verified; the comments components use the separate `/comments` handlers), so this is safe. Empty result returns exactly as before. Org id is never exposed (it was already present on the post objects pre-change; branding adds only display fields).
- **Frontend** (`p/[id]/page.tsx`): mirrors the approve page conservatively — all-null branding is treated as absent; when present, the header bar gets the accent `borderTop`, the org logo renders before the Postorizon lockup, and the portal name shows beside it. With no branding the rendered output is unchanged.

**Remains:** branding still does not apply to emails (unchanged from Phase 3); the Postorizon lockup remains alongside the org logo (conservative, same as the approval page keeping its title).

## Item 7 — Best-time chips in the mobile date sheet ✅ built

One line in `manage.modal.tsx`: the mobile `date` BottomSheet now renders `{!dummy && <BestTimeChips onPick={setDateDraft} />}` above the `DatePickerPanel`. **Setter choice is the substance of this item:** the sheet is draft-based (Save commits via `setPickerDate(dateDraft)`), so the chips feed `setDateDraft` — using the desktop footer's `setPickerDate` would have committed immediately and then been overwritten by Save. `BestTimeChips` itself is reused unchanged and still renders nothing when data is insufficient.

**Remains:** none for this item (per-integration chip filtering remains API-only, as in Phase 3).

## Item 8 — Capture completeness ✅ built (both pieces)

`capture.component.tsx` only:
- **(a) Media upload:** a file input (`image/*,video/mp4`) posting `FormData` to the existing **`POST /media/upload-simple`** — the trivial flow from `launches/polonto.tsx`, not the Uppy pipeline and no new backend. The saved `{ id, path }` becomes `uploadedMedia` state with a thumbnail preview + Remove; in the save payload it takes precedence over the media-URL field, which stays as the alternative. The payload's `image` is explicitly typed `{ id: string; path: string }[]`. Upload state + failure toast included; a successful draft save clears the uploaded media with the text.
- **(b) Group pre-selection:** groups are derived from the channel list itself (`ch.customer {id, name}` — already in the `/integrations/list` payload; no `customerId` scalar is exposed, and none was needed). With >1 group, a select filters the displayed channels and — mirroring the composer's `changeCustomer` — pre-selects that group's channels. With ≤1 group the page is unchanged; the first-channel auto-select effect is untouched.

**Remains:** upload is single-file (the capture payload models one media item, as in v1); it is still responsive web capture, not a native/share-sheet app (Phase 3 remain, unchanged).

## Item 9 — Copilot brand-voice injection ⛔ NOT built (stretch; precise blocker)

Investigated end-to-end; shipping it would have meant faking it:
- `BrandVoiceService.getProfile(orgId, customerId)` + `voicePromptFragment(profile)` exist and are ready — the *consuming* seam is what's missing.
- `/copilot/chat` has **no server-side system prompt to inject into**: the controller builds a bare `new CopilotRuntime()` + `OpenAIAdapter` and delegates the raw request/response to CopilotKit's node endpoint. The system behaviour is owned by the CopilotKit frontend/runtime exchange, not by any string in this codebase.
- There is also **no customer context to key a profile by**: the chat is mounted globally (`layout.component.tsx`, `preview.wrapper.tsx`) with no customer selection, and chat requests carry no `customerId` anywhere (unlike `/copilot/agent`, whose AG-UI `forwardedProps` channel is how the agent endpoint receives context — a different protocol from `/copilot/chat`'s single-endpoint CopilotKit protocol).
- The only technical route — intercepting and rewriting the CopilotKit protocol request stream inside `chatAgent` before the runtime reads it — is unverifiable in this sandbox (no runnable build) and risks breaking chat for all users to serve an optional field nobody can currently send.

**What would unblock it:** a product decision on which customer a global chat acts for (e.g. a customer switcher in the chat UI sending `customerId`), then either CopilotKit runtime middleware support for request mutation in the installed `@copilotkit/runtime` version, or migrating chat to the AG-UI endpoint shape where `forwardedProps` + `RequestContext` already provide a clean injection seam (the agent endpoint's pattern). Until then this stays a documented remain, exactly as Phase 2 left it.

## Out of scope (unchanged — restated as remains)

- **Webflow/Wix/Shopify/Mailchimp** channels: need registered OAuth developer apps (DEV_APPS.md programme).
- **TikTok/WhatsApp/Reddit external inbox ingestion:** no provider read API exists upstream; needs per-platform read methods + developer-app scopes.
- **Mastra-internals and `OpenaiService` media BYOK routing:** module-level singletons with no org context at their call seams — their own careful project.
- **Anthropic keys driving the Copilot adapter:** the adapter speaks the OpenAI API shape (org OpenAI → OpenRouter resolution unchanged).
- **CLI weekly-plan command:** needs a public-API (`/public/v1`) route + API-key scoping decision.
- **Per-post delivery timeline UI:** §3.2.4's publish-status view is still answered only at the error-count level (Phase 3 Item 7).
- **Pricing/entitlements:** untouched, per the owner's standing deferral.

---

## Verification performed

- Every new/edited TS/TSX file parse-checked with the repo's TypeScript (`transpileModule`, diagnostics): all OK.
- **Prisma relation audit (CI-failure class b):** every relation/select in new code verified field-by-field against `schema.prisma` — `UserOrganization.user` (selecting `User.id/name/lastName/email`, all present), `Organization.deletedAt`, `Notifications` reads via the existing repository. **This branch makes zero schema changes** (verified: `git diff` for `schema.prisma` is empty).
- **Hook/context audit (CI-failure class a):** no hook or context value was extended anywhere in this branch — `BestTimeChips` is consumed with its existing single-prop contract; new data fetching uses standalone SWR keys (`inbox-members`).
- **Bare-array sweep (CI-failure class c):** `git diff` over all frontend changes greps clean for added `: [],` literals; new arrays are typed (`Member[]`, `{ id: string; path: string }[]`, preset object arrays with annotated element types).
- **DI / registration audit:** `EngagementActivity` added to the orchestrator `AppModule`'s single `activities` array (→ `providers` + `activityClasses`); `engagement.sampling.workflow` exported from `workflows/index.ts` (required for the `workflowsPath` bundle); `EngagementSamplingRegisterModule` imported by the orchestrator `AppModule`. New constructor deps resolve from the `@Global() DatabaseModule`: `EngagementRepository` gains `PrismaRepository<'organization'>` (single generic provider, line 79 of database.module.ts); `IntegrationHealthService` gains `PrismaRepository<'organization'>`, `NotificationService` (provider line 87) and `NotificationsRepository` (line 88); `PublicController` gains `BrandingService` (already injected by a sibling controller in the same `ApiModule`). Dependency graph stays acyclic: `NotificationService`'s deps (NotificationsRepository, EmailService, OrganizationRepository, TemporalService) never reach IntegrationHealthService; `EngagementService → PostsService` unchanged. Grep confirms no spec/test file constructs any changed service manually.
- **Workflow determinism:** the new workflow's code paths are fixed at first deployment (no pre-existing executions to patch around; the `patched()` guard follows house style for future edits). `workflowIdConflictPolicy: 'USE_EXISTING'` follows the literal style used in `PostsService.startWorkflow` / `AutopostService.processCron`.
- `git status` clean at every commit boundary; one commit per item (Items 1+6 share a commit — they are one workflow run by design).
- **Not verifiable in this sandbox (same limitation as Phases 0–3):** full type-check/build and `prisma generate` — the Prisma engine download fails here, so CI (install → prisma-generate → frontend+backend build) remains the authoritative check. The orchestrator app is not part of the CI build matrix (CI builds frontend + backend), so orchestrator-only type errors would surface at orchestrator deploy/boot, not in CI — see Risks.

## Risks

1. **Orchestrator compile is not covered by CI.** Items 1+6 add a workflow, an activity, a register and module wiring in `apps/orchestrator` + `libraries`. The activity/register/library halves are type-checked only insofar as the backend build compiles the same library files (`EngagementService`, `IntegrationHealthService`, the register is *not* imported by the backend — it is compiled only by the orchestrator build). The workflow file follows the existing workflows' exact import/proxy shapes, and the register mirrors `InfiniteWorkflowRegister`, but the first orchestrator build/boot is the real check. Highest-risk single spot: the `workflowsPath` webpack bundle picking up `engagement.sampling.workflow.ts` via the new `index.ts` export.
2. **`RUN_CRON` deployment gap (Item 1).** If `RUN_CRON` is not set on the orchestrator service, the register no-ops and sampling stays on-demand — a silent no-op by design (same as `missingPostWorkflow` today). The report states the required env explicitly; a boot log line was deliberately *not* added to keep the register a faithful mirror of the existing one.
3. **`getNotificationsSince` revival (Item 6).** The dedupe scan loads up to 7 days of an org's notifications per sweep run — bounded by real notification volume (post publish/refresh events), fine at current scale; a very noisy org would make the scan the sweep's main cost. The marker approach also means a user *deleting* a notification (soft-delete is filtered by the paginated getter but **not** by `getNotificationsSince`, which has no `deletedAt` filter) does not reset the dedupe window — conservative in the right direction (fewer notifications, never more).
4. **Best-slot placement timezone convention (Item 2)** is inherited, not introduced: slots are UTC-offset-0 buckets read on dayjs-local plan days; on a server not running UTC the placed hour can differ from the viewer's best-time chip hour by the server offset. Documented in-code; fixing it end-to-end means threading an org timezone through the plan DTO, which no existing field supports.
5. **Report preset links (Item 4)** compute `from`/`to` at page render; a cached/shared link therefore always means "the last N days from when it was opened", which matches the preset labels. The API default (30 days) and the highlighted default stay in sync only as long as both remain 30 — noted in-code via the `activePeriodDays` default.
