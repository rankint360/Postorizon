# Postorizon — Phase 2 Report

**Branch:** `postorizon/phase-2`, created from Phase 1 head `2ac098c`.
**Base verified:** CI-green Phase 1 tree. **This branch was NOT pushed** — the parent agent pushes and runs CI verification.
**Totals:** 6 item commits + this report commit; 50 files changed vs `2ac098c`, +3,241 / −37 (before this report).
**Rules honoured:** additive-only Prisma changes; no new dependencies; `pnpm-lock.yaml` untouched; no prices changed anywhere; nothing faked — where a capability does not exist in the inherited codebase, the report says so and scopes the item to what is real.

## Exact commit list

| Commit | Item |
| --- | --- |
| `960d6ed` | 1 — Approvals completion: publish-path gating, public approval link, calendar UI |
| `a215487` | 2 — BYOK AI keys + brand-voice memory (MVP_SPEC §3.2.7) |
| `6ebf877` | 3 — Unified inbox v1, API-only (MVP_SPEC §3.2.5) |
| `2d2877f` | 4 — Web2 syndication pack: Telegraph, Micro.blog, Ghost, LiveJournal (MVP_SPEC §3.2.3) |
| `8f8c431` | 5 — Closed-loop agent v1: weekly plan into the approval queue (MVP_SPEC §3.2.2) |
| `911bc73` | 6 — Free plan entitlements |
| (this report) | PHASE2_REPORT.md |

---

## Item 1 — Approvals completion

**What existed (Phase 1):** the approvals core — `ApprovalState` enum, `Post.approvalState` / `Post.approvalToken`, `PostApproval` audit model, repository + service (`post.approvals.repository.ts` / `post.approvals.service.ts`), and an authenticated controller. Missing: enforcement in the publish path, the public link endpoints, and all frontend.

**Implemented:**
- **Publish-path gating** (`libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`): `startWorkflow` — the single funnel used by create/schedule/reschedule — now refuses to start a workflow for `PENDING` or `CHANGES_REQUESTED` posts and returns early; the old termination loop was extracted to a public `terminatePostWorkflows(postId)` so state changes can also stop an already-running workflow. The missing-posts sweep can no longer resurrect a blocked post: the repository query (`posts.repository.ts`, `searchForMissingThreeHoursPosts`) filters to `NOT_REQUIRED`/`APPROVED`, and the orchestrator activity double-checks (`apps/orchestrator/src/activities/post.activity.ts`).
- **Service completion** (`post.approvals.service.ts`): requesting approval or changes terminates the running workflow; approving a `QUEUE` post restarts its scheduling; the public-link actions (`approveViaLink` / `requestChangesViaLink`) now require the post to be `PENDING` (HTTP 400 otherwise) — previously they would act on any state.
- **Public no-login link** (`apps/backend/src/api/routes/public.post.approvals.controller.ts`, new): `GET /public/approvals/:token`, `POST /public/approvals/:token/approve`, `POST /public/approvals/:token/request-changes`. Registered in the non-authenticated controller list (`apps/backend/src/api/api.module.ts`) so `AuthMiddleware` does not apply; guarded by `ThrottlerRealIpGuard` + `@Throttle` 60/hour/IP. The view returns a safe shape only (post content, state, publish date, approval state, channel name/provider/picture/profile — no organization id). All actions write `PostApproval` audit rows via the existing service.
- **Frontend:** public approval page at `apps/frontend/src/app/(app)/(preview)/approve/[token]/` (layout + server page mirroring the `p/[id]` preview pattern; renders through `PostContentClient` with sanitized content) with client action buttons (`apps/frontend/src/components/preview/approval.actions.tsx`). Calendar (`apps/frontend/src/components/launches/calendar.tsx`): amber "…" badge for PENDING and orange "!" badge for CHANGES_REQUESTED on the post tile, a hover approval action, and an approval panel (`apps/frontend/src/components/launches/approval.modal.tsx`) showing state, the copyable `/approve/<token>` share link, comment field, request/approve/request-changes/reset actions, and the audit history. The calendar posts query now selects `approvalState`.

**Remains:** nothing from the Phase 1 remainder list. Note the deliberate semantics: approving a `DRAFT` post does not schedule it (only `QUEUE` posts restart) — a human still schedules approved drafts, which matches the queue's role as a review gate, not an auto-publisher.

## Item 2 — BYOK AI + brand-voice memory (§3.2.7)

**What existed:** platform-key-only AI. `OpenaiService` uses a module-level client from `OPENAI_API_KEY`; the CopilotKit endpoints build `OpenAIAdapter({model: 'gpt-4.1'})` per request and hard-fail when the platform key is absent. The codebase's encryption scheme for stored secrets is `AuthService.fixedEncryption` / `fixedDecryption` (`@gitroom/helpers/auth/auth.service`, AES-256-CBC, key/IV derived from `JWT_SECRET`), already used for integration `customInstanceDetails`.

**Implemented:**
- **Schema (additive):** `AiKeyProvider` enum (`OPENAI` / `ANTHROPIC` / `OPENROUTER`); `OrganizationAiKey` (one row per provider per org, `encryptedKey` only); `BrandVoiceProfile` (per customer group: `toneNotes`, `bannedTopics[]`, `examplePostIds[]`).
- **Storage + resolution** (`libraries/nestjs-libraries/src/database/prisma/ai/ai.keys.repository.ts`, `ai.keys.service.ts`): keys are encrypted with the existing `fixedEncryption` scheme — no new crypto. Listings return provider + last-4 mask + timestamps only; the raw key is never returned by any API after save. `resolvePreferredKey` = most recently saved/rotated key. `openAiClientForOrg` builds an OpenAI-SDK client from the org's OpenAI key, else its OpenRouter key (OpenAI-compatible endpoint, model `openai/gpt-4.1`).
- **Generation seam** (`ai.chat.service.ts`): `AiChatService.chatCompletion(orgId, messages)` — org BYOK key first, platform `OPENAI_API_KEY` fallback, clear HTTP 400 when neither exists. Providers are called over plain HTTPS with native shapes (OpenAI/OpenRouter chat completions; Anthropic Messages API with the system prompt lifted to its top-level field). No new dependencies.
- **Settings API** (`apps/backend/src/api/routes/ai.settings.controller.ts`): `GET/PUT /settings/ai-keys`, `DELETE /settings/ai-keys/:provider` (admin-gated), `GET/PUT /settings/brand-voice/:customerId` (customer verified to belong to the org). DTOs in `libraries/nestjs-libraries/src/dtos/settings/ai.key.dto.ts` / `brand.voice.dto.ts`.
- **Wiring:** both Copilot endpoints (`apps/backend/src/api/routes/copilot.controller.ts` `/copilot/chat` and `/copilot/agent`) now build their `OpenAIAdapter` from the org's BYOK client when present (the adapter's `openai` param was verified against the installed `@copilotkit/runtime` type definitions) and only hard-fail when neither an org key nor the platform key exists. `BrandVoiceService` (`brand.voice.service.ts` / `brand.voice.repository.ts`) renders prompt fragments (`voicePromptFragment`) and exposes the banned-topic guardrail consumed by Item 5.

**Remains / not routed (documented, not faked):**
- The Mastra agent's internal model calls and `OpenaiService` media features (clips, image/voice generation) still use the platform key: they run off a module-level singleton with no org context at their call seams. Routing them needs per-request client plumbing through the Mastra runtime — a separate, careful change.
- Anthropic keys are honoured by `AiChatService` consumers (Items 3 and 5) but not by the Copilot adapter, which speaks the OpenAI API shape; the adapter path prefers OpenAI, then OpenRouter keys.
- Brand voice is consumed by the agent (Item 5) and exposed for prompt construction via `voicePromptFragment`; the Copilot chat system prompt does not yet inject it (chat requests carry no customer-group context to key the profile by).

## Item 3 — Unified inbox v1 (§3.2.5)

**What existed (verified by inspection):** no provider in this codebase exposes a read API for external platform comments or DMs. The `SocialProvider` surface is `post()` plus `comment()` — and `comment()` only posts a comment onto an already-published post as part of the publish workflow. `Comments` is the internal draft-collaboration model (including client comments left through public preview links); `Messages`/`MessagesGroup` are marketplace orders. Building an "external comments inbox" would have meant inventing data that does not exist.

**Implemented (API-only, per the brief's fallback):** a unified queue over the real, persisted, actionable items —
- unresolved internal post comments, and
- approval requests awaiting a decision (latest `PostApproval` row per post whose post is currently `PENDING` / `CHANGES_REQUESTED`).
- `GET /inbox` (`apps/backend/src/api/routes/inbox.controller.ts`; service/repository in `libraries/nestjs-libraries/src/database/prisma/inbox/`): merged, cursor-paginated (opaque base64 cursor), `unreadOnly` and `assigneeId` filters.
- **Persisted triage state** (additive schema `InboxItemState`, unique per org+source): `PATCH /inbox/:sourceType/:sourceId/state` sets read/readBy and assignee, with org-membership validation of the assignee.
- **Reply passthrough:** `POST /inbox/comments/:commentId/reply` delegates to the existing validated comment-thread service (`PostsService.createPublicComment`, replies attach to the thread root per its rules).
- **AI suggested replies:** `POST /inbox/comments/:commentId/suggest-reply` returns a draft suggestion via the BYOK-aware `AiChatService`. It is never auto-sent.

**Remains:** the frontend inbox page (deferred deliberately — API-only was the brief's low-risk fallback); external platform comment/DM ingestion is blocked on a provider read interface that does not exist upstream (each provider would need a new read method + per-platform API scopes — the developer-app programme in `DEV_APPS.md` is the prerequisite); provider-side replies to *external* comments are likewise not possible with the current `comment()` semantics.

## Item 4 — Web2 syndication pack (§3.2.3)

**Pattern studied end-to-end first:** Dev.to (provider + `socialIntegrationList` registration + settings DTO + frontend settings component + icon) and WordPress (multi-field credentials travel in the integration token as the base64 custom-fields payload). Each new channel follows it exactly.

**Implemented** (backend provider + registration in `libraries/nestjs-libraries/src/integrations/integration.manager.ts`, settings DTO in `libraries/nestjs-libraries/src/dtos/posts/providers-settings/`, frontend settings component under `apps/frontend/src/components/new-launch/providers/<name>/` registered in `show.all.providers.tsx`, 50×50 icon in `apps/frontend/public/icons/platforms/`):
- **Telegraph** (`telegraph.provider.ts`): telegra.ph public API; access-token custom field, validated via `getAccountInfo`; `createPage` with paragraph nodes converted from the post text. Settings: title + optional backlink URL, appended as "Originally published at …".
- **Micro.blog** (`micro.blog.provider.ts`, identifier `microblog`): app-token auth validated via `account/verify`; publishing through the Micropub endpoint; the created URL is read from the `Location` response header. Settings: optional title (long-form posts).
- **Ghost** (`ghost.provider.ts`): Admin API key (`id:secret`) custom fields; requests authenticated with a short-lived HS256 JWT signed with Node's `crypto` (Ghost's documented scheme — no new dependency); publishes via `?source=html`. Settings: title, cover image, and **canonical link** (`canonical_url`), reusing the same URL validation and the shared `Canonical` form component as Dev.to.
- **LiveJournal** (`livejournal.provider.ts`): XML-RPC challenge-response login validation (`md5(challenge + md5(password))`); posting via the documented flat protocol (`mode=postevent`, md5-hashed password); entry URL reconstructed from `itemid`/`anum`. Settings: optional subject.

**Not included — documented blocker:** Webflow, Wix, Shopify blog and Mailchimp do not fit the credential-paste pattern: each requires a registered OAuth developer app (per-workspace app credentials and review), the same class of blocker as the social OAuth apps tracked in `DEV_APPS.md`. No scaffolds with fake auth were shipped.

**Caveat:** the four providers are compile-verified only — no live accounts were available in the sandbox to test against the real services. Icons are simple brand-colour letter tiles generated locally (50×50, matching the existing icon format), not official logo artwork.

## Item 5 — Closed-loop agent v1 (§3.2.2)

**What existed:** all the pieces, unconnected — `PostsService.createPost` (DTO shape proven by `generatePostsDraft`), the Phase 1 approval queue, brand voice (Item 2), and the BYOK generation seam (Item 2). One correction to the original plan: `PostsService.countPostsFromDay` counts posts *from* a day onward (a plan-limit helper), not posts *on* a day, so the daily cap uses a dedicated per-day count instead of misusing it.

**Implemented:**
- `WeeklyPlanService` (`libraries/nestjs-libraries/src/database/prisma/agent/weekly.plan.service.ts` + `weekly.plan.repository.ts`): input = brief + customer group (+ optional week start, post count, daily cap). It loads the group's published-post history (posts table, latest 20, text-extracted) and brand-voice profile, builds the prompt (voice fragment included), generates via `AiChatService` (BYOK-aware), and parses the returned JSON array of post texts (with a tolerant line-based fallback).
- **Guardrails (hard):** any idea touching a banned topic is dropped and counted (`droppedBannedTopic`); placement respects `maxPostsPerDay` counting posts already on the calendar for each day (`WeeklyPlanRepository.countPostsOnDay`); overflow is counted (`droppedOverCap`). Ideas are spread over the plan week at 10:00 + 2h slots.
- **Output:** each surviving idea is cross-posted as a **draft** to every channel of the group via `PostsService.createPost` (same DTO shape as `generatePostsDraft`) and immediately moved into the approval queue via `PostApprovalsService.requestApproval` (`approvalState = PENDING`, audit comment "Weekly plan draft created by the Postorizon agent"). Combined with Item 1's gating, nothing the agent writes can publish without a human approval.
- **Endpoint:** `POST /agent/weekly-plan` (`apps/backend/src/api/routes/agent.plan.controller.ts`), authenticated, AI-section policy (same gate as the Copilot agent). DTO: `libraries/nestjs-libraries/src/dtos/agent/weekly.plan.dto.ts`.

**Remains / limitations (explicit):**
- **The performance-feedback loop is not closed in v1.** Engagement analytics are fetched live per provider and never persisted (Phase 1 finding), so the agent learns from content history + brand voice only. Closing the loop needs an engagement-persistence design (metric snapshots per published post) — flagged as the top Phase 3 candidate.
- **No CLI command:** the standalone CLI speaks the public API-key API (`/public/v1`), a different auth surface from this session-authenticated endpoint. Adding it means a new public-API route + API-key scoping decision — not trivial, so it was not bolted on.
- Drafts are created as `DRAFT` + `PENDING`; after approval a human still schedules them (by design, see Item 1).

## Item 6 — Free plan structure

**What existed:** plan entitlements live in code at `libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts` (not only in Stripe). `FREE` was a zero placeholder: 0 channels, 0 posts/month, `public_api: false`, 0 webhooks — and it is the live fallback tier for orgs without a subscription when Stripe is configured (`PermissionsService.getPackageOptions`: subscription tier, else `PRO` when no `STRIPE_PUBLISHABLE_KEY`, else `FREE`; FREE's `channel` is passed through directly, and `SubscriptionService` uses `pricing.FREE.channel` as the default allowance).

**Implemented (FREE block only):** `channel: 5`, `posts_per_month: 30`, `public_api: true` (which is also the MCP gate), `webhooks: 1`. Everything else in FREE stays off (no team members, no platform-funded AI, no media generation).

**Untouched, deliberately:** every price (`month_price` / `year_price`) in the table — FREE was already 0 and all paid tiers are byte-identical. Final pricing remains the owner's deferred decision; 30 posts/month is an entitlement constant chosen to make Free usable without approaching STANDARD's effectively-unlimited allowance, and is flagged here for the owner to adjust when pricing is decided.

---

## Verification performed

- Every new/edited TS/TSX file parse-checked with the repo's TypeScript (`transpileModule`, diagnostics): all OK, including a before/after isolation check on the surgically edited `copilot.controller.ts`.
- Every referenced symbol verified to exist before use (e.g. `ThrottlerRealIpGuard` import path matches `auth.controller.ts`; `OpenAIAdapter`'s `openai` param confirmed in the installed `@copilotkit/runtime` type definitions; `Sections.ADMIN` used after confirming no `Sections.SETTINGS` exists; `RealIP` imported from `nestjs-real-ip` as in `posts.controller.ts`).
- DI acyclicity checked: `PostApprovalsService → PostsService`, `InboxService → PostsService`, `WeeklyPlanService → PostsService + PostApprovalsService` — no back-edges.
- Schema diff reviewed: additive only (3 new models, 1 new enum, relation fields; the only removed lines are whitespace re-alignment in the `Customer` model).
- `node cli/bin/postorizon.js --help` runs.
- Grep spot-check of all added lines in the phase diff: no new user-visible "postiz" strings.
- `git status` clean at every commit boundary; one commit per item.
- **Not verifiable in this sandbox (same limitation as Phases 0–1):** full type-check/build and `prisma validate`/`generate` — the Prisma engine download fails here, so CI (install → prisma-generate → frontend+backend build) is the authoritative check, as it was for Phase 1. Provider type usage follows the Phase 1 models' exact conventions to minimise generate-time surprises.

## Risks

1. **CI is the first full compile.** Transpile checks catch syntax, not type errors. Highest-risk spots, in order: the calendar `approvalState` usage (depends on the generated Prisma `Post` type — the field is in the schema since Phase 1, so generate will include it), the `createPost` body cast in `WeeklyPlanService` (passed `as any`, mirroring `generatePostsDraft`'s shape), and Nest DI wiring of the four new services (all registered in `DatabaseModule`, whose exports getter returns the full provider list).
2. **LiveJournal / Telegraph / Micro.blog / Ghost providers are untested against live services** (no accounts in the sandbox). They follow the documented public APIs of each platform, but a first live connection test per channel is recommended before announcing them.
3. **Copilot BYOK adapter:** if an org stores an OpenRouter key, the Copilot model becomes `openai/gpt-4.1` on OpenRouter; if OpenRouter renames that slug, the fallback is to remove the stored key (platform key path is unchanged).
4. **Inbox queue merge** over-fetches (3× page size per source) and filters in memory — fine at v1 volumes; a union query would be the optimisation if inbox volume grows.
