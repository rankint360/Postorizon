# Postorizon — Inherited-Code Security Audit (Phase 4, MVP_SPEC §6)

Scope: the fork's sensitive seams, audited by static inspection of the
working tree on branch `postorizon/phase-4`. Each seam lists the evidence
(file/line at audit time), a verdict — **ok** / **fixed** (with the Phase 4
commit) / **flagged-not-fixed** (with the reason) — and, for flags, what a
proper fix requires. Per the phase rules, nothing structural was redesigned:
no auth redesign, no crypto rotation. Five targeted fixes were made, each
minimal and behaviour-preserving for legitimate flows.

**Headline: 1 seam ok · 5 fixes landed · 2 structural flags.**

---

## (a) Auth / session handling — ⚠ FLAGGED (design) + 1 fix

**What is sound:**
- Passwords: bcrypt with cost factor 10 at registration and password change
  (`apps/backend/src/services/auth/auth.service.ts`, `password.service.ts`,
  `users.service.ts`); policy requires ≥8 chars with upper + lower + digit
  (`validatePassword`).
- Session transport: the JWT lives **only** in an `auth` cookie set
  `httpOnly`, `secure` (in secured mode), `sameSite: 'none'`
  (`cookies.service.ts`); the frontend never puts it in `localStorage`
  (only unrelated prefs live there). `AuthService` re-resolves the user from
  the database on every request, so deleted/deactivated users lose access
  even with a live cookie.

**Flag 1 — session tokens never expire and cannot be revoked.**
`canUse` signs with **no `exp` claim**; the cookie's `expires` is 365 days.
There is no `iat`/version check, no session table and no token blacklist —
the only "revocation" is deleting the cookie. Worse, the same `signJWT` and
secret sign the activation, password-reset, invite and extension-login
tokens, so session tokens and one-shot tokens are the same credential type
(only a payload key distinguishes them; `validateToken` accepts either).
With `sameSite: 'none'` + `secure`, CSRF exposure rests entirely on CORS.
*Why not fixed:* giving sessions an expiry/revocation story means splitting
the token types, adding expiry + a revocation mechanism and touching every
consumer (extension, MCP, mobile) — an auth redesign, explicitly out of
scope for this phase. **Recommended follow-up:** separate token purposes,
add `exp` (e.g. 30 d) to session tokens, and a per-user token version for
revocation.

**Flag 2 — `NOT_SECURED` mode strips all cookie protection**
(`httpOnly: false`, `secure: false`, `sameSite: false`). It is opt-in via
env and documented as a dev escape hatch; DEPLOYMENT.md warns never to set
it in production. Not fixed (intended upstream behaviour).

**Fixed — no throttling on credential endpoints** (`f97db78`).
The global throttler only *enforces* on two public route trees
(`/public/v1/posts`, public comments); the middleware that would enforce it
everywhere is commented out. Registration, login, forgot-password and
reset completion had no brute-force/credential-stuffing protection at all.
Fix: `@UseGuards(ThrottlerRealIpGuard)` + `@Throttle({ default: { limit: 30,
ttl: 3_600_000 } })` on the four credential endpoints of
`auth.controller.ts` (30 attempts/hour/IP, matched to the public
approval/report endpoints' generosity so legitimate users never notice) —
the same decorator pair the controller already used for its Farcaster
signer endpoint.

---

## (b) Integration token encryption at rest — ⚠ FLAGGED (plaintext store)

**Verdict: provider tokens are stored PLAINTEXT.** `Integration.token` and
`Integration.refreshToken` are written verbatim on every path and never pass
through the repo's encryption helpers:

- `integration.repository.ts` upserts `token`/`refreshToken` exactly as
  received (the repository even calls the OAuth `code` "the token");
- the OAuth callback (`integrations.controller.ts`) stores the provider's
  raw `access_token`/`refresh_token`;
- the refresh services (`refresh.integration.service.ts`,
  `stripe.integration.service.ts`) write rotated tokens back raw.

The repo's working encryption (`fixedEncryption`/`fixedDecryption`,
AES-256-CBC) **is** correctly used for: org BYOK AI keys (Phase 2),
OAuth-app client secrets, org API keys and custom-instance details — those
seams are fine.

**Why flagged, not fixed:** there is no decrypt seam to extend — token reads
go through a bare `PrismaClient` constructed directly in ~30 integration
service classes (no client extension/middleware exists to hook). A correct
fix needs an encrypt-on-write / decrypt-on-read boundary plus a data
migration for existing rows, and one provider (Skool) already receives
ciphertext *as* its token from upstream, so a blanket change would
double-encrypt it. That is a designed change with a migration plan, not a
one-seam patch. **Recommended follow-up:** introduce the boundary in
`IntegrationManager`/repository first (covers connect + refresh), backfill
existing rows, then handle direct-write stragglers; treat the database as
sensitive until then (it holds every connected channel's credentials).

---

## (c) Webhook signature verification — ✓ OK

- **Stripe:** `stripe.controller.ts` passes the **raw body** and the
  `stripe-signature` header to `stripe.webhooks.constructEvent(...)` with
  `STRIPE_SIGNING_KEY` **before any processing**; verification failure
  throws and stops the handler (raw-body capture is wired in `main.ts` and
  `app.module.ts`). No unverified fallback path exists (the RevenueCat route
  is separate).
- **RevenueCat:** the shared-secret authorization check is fail-closed —
  when `REVENUECAT_WEBHOOK_SECRET` is unset the endpoint still *requires* an
  exact match against `undefined`, so every request 400s; the handler then
  re-fetches the subscriber state server-side instead of trusting the
  payload body.
- Every other inbound webhook receiver found (social providers, Dub/Kutt
  short-link postbacks, generic automation webhooks) processes *outbound*
  deliveries or user-configured endpoints — no additional unverified inbound
  payment/entitlement processor exists.

No change made.

---

## (d) Public token endpoints (Phases 2–3) — ✓ FIXED (2 fixes)

**Already sound:** both public controllers are throttled per real IP
(approvals 60/hour on link resolution/preview/comments/decision;
reports 60/hour on fetch, 20/hour on link rotation), and rotate-on-regenerate
invalidates old tokens (`post.approvals.service.ts`, `branding.service.ts`).

**Fixed — tokens were minted with `Math.random`** (`df1b0a2`).
Approval and report tokens (32 chars — adequate length) came from the shared
`makeId`, whose alphabet indexing is `Math.random()`-based. Fix: a new
`makeSecureId` in `make.is.ts`, byte-for-byte the same alphabet/length
contract but sourced from `crypto.randomInt` (CSPRNG, rejection-uniform),
now used at all three minting sites. `makeId` itself is untouched — it has
~80 other callers (file names, workflow ids) that don't need CSPRNG.

**Fixed — public post preview leaked the approval token** (`1f08cb8`).
Unauthenticated `GET /public/posts/:id` spread the **entire Post row** into
its response — including `approvalToken` (the credential that authorises
approve/reject on the public link), plus `integrationId`,
`submittedForOrderId` and `submittedForOrganizationId`. Anyone who could see
a post preview (e.g. via the comments flow) received the approval
capability. Fix: the four fields are stripped at the destructure in
`public.controller.ts`; the branding lookup now runs before post mapping so
nothing else about the response changed. **One deliberate judgement call:**
`organizationId` was *kept* — the preview page passes it to
`PreviewCommentsContext`, whose `canResolve` compares it against the
logged-in user's own org to decide comment-resolution rights; an org id
alone authorises nothing (every other public field already exposes which
org a post belongs to through branding), and removing it would silently
break comment moderation on previews.

---

## (e) File uploads — ✓ FIXED (2 fixes; streamed path was ok)

**Already sound:** the authenticated streamed path (`media.controller.ts` →
`CustomUploadValidation`) sniffs magic bytes with `file-type`, enforces an
allow-list and caps size *while streaming* (images 10 MB, video 1 GB via
`getMaxSize`); the multipart *initiate* step validates declared size and
mime, and download-side media serving re-checks types.

**Fixed — R2/S3 multipart completion never verified the assembled size**
(`7c05006`). `completeMultipartUpload` checked the assembled object's
*type* (and deleted mismatches) but not its size, so a client could declare
a small size at initiate and upload oversized parts. Fix: `HeadObject`
content-length is now checked against `getMaxSize(expectedMime)` at
completion; oversize objects are deleted and the upload rejected — the same
cleanup branch the type check already used.

**Fixed — `uploadSimple` buffered whole files with no size cap** (`c407f0e`).
Both storage backends' `uploadSimple` (local disk + Cloudflare R2) fetch or
decode the entire body into memory, sniff it and check the allow-list — but
never its length, so a huge data URL or remote file was buffered and stored
unbounded (the endpoint also backs AI-generated media and imports). Fix:
after the existing sniff/allow-list, bodies over the shared per-type limits
are rejected (`getMaxSize`: 10 MB images / 1 GB video; audio, which storage
also accepts for voice features, takes the 10 MB cap since `getMaxSize` has
no audio branch by design).

---

## Summary table

| Seam | Verdict |
|---|---|
| (a) Auth/session — storage, hashing, per-request re-resolution | ok (within a flagged design) |
| (a) Session lifetime / revocation / shared token type | **flagged** — needs an auth redesign |
| (a) Credential-endpoint throttling | **fixed** `f97db78` |
| (b) Integration tokens at rest | **flagged** — plaintext; needs boundary + migration |
| (b) BYOK keys, OAuth secrets, org API keys at rest | ok (encrypted) |
| (c) Stripe + RevenueCat webhook verification | ok |
| (d) Public endpoints — throttling, rotation | ok |
| (d) Token entropy (CSPRNG) | **fixed** `df1b0a2` |
| (d) Public preview field leakage | **fixed** `1f08cb8` |
| (e) Streamed uploads | ok |
| (e) R2 multipart total size | **fixed** `7c05006` |
| (e) uploadSimple size cap (both backends) | **fixed** `c407f0e` |
