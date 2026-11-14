# Phase 0 Report — Postorizon foundation

_Date: 2026-11-13 · Repo: `~/workspace/dev/postorizon` · Branch: `postorizon/phase-0` ·
Base: upstream `gitroomhq/postiz-app` commit `23f29c4` (remote renamed `origin` → `upstream`) ·
Phase 0 code commit: `885860a` ("Phase 0: Postorizon rebrand foundation on Postiz (AGPL-3.0) base")_

## 1. What changed

**Repository setup**
- Copied the inspected clone (with `.git`) to `~/workspace/dev/postorizon`; remote
  `origin` renamed to `upstream`; working branch `postorizon/phase-0` created.
  (`cp` printed ownership-preservation warnings in this sandbox; file contents verified intact.)

**Rebrand (user-visible + safe changes only)**
- Root `package.json`: name `gitroom` → `postorizon`.
- `apps/commands/package.json`: name `postiz-command` → `postorizon-command`
  (no `bin` field exists in this repo's commands service; no other package references the name).
  Note: the distributable "Postiz CLI" (`npm i -g postiz`) is **not** in this repo.
- `README.md` replaced with a Postorizon README (product description, AGPL-3.0
  attribution to Postiz/Gitroom, tech stack, dev-setup commands taken from the
  repo's own root scripts + `.env.example` + compose files).
- Frontend brand assets copied into `apps/frontend/public/`: `postorizon-mark.svg`,
  `postorizon-logo-horizontal.svg`, `postorizon-logo-horizontal-light.svg`,
  `postorizon-app-icon.svg`, and the favicon set (`favicon.svg`, `favicon.ico`
  — replaced the upstream one at the path all three layouts link to —
  `favicon-16/32/48.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`).
- Logo components swapped (mechanism was two inline-SVG components):
  - `src/components/new-layout/logo.tsx` — now renders the Postorizon "Horizon arcs"
    mark inline (light variant, white horizon line for the dark UI), same 60×60 slot.
  - `src/components/ui/logo-text.component.tsx` — now renders
    `/postorizon-logo-horizontal-light.svg` (150×33, the old component's height).
- Browser page titles: every `title:` metadata string in `apps/frontend/src/app`
  changed `Postiz`/`Gitroom` → `Postorizon` (18 files; the two multi-line title
  continuations in the auth/activate pages fixed as well).
- Image references `/postiz.svg` → `/postorizon-mark.svg` (public preview page,
  `components/launches/connect.link.tsx`).
- Auth layout marketing line: "…use Postiz To Grow…" → "Postorizon" (name only —
  see gap §5.4 about the "20,000+" figure).
- Browser extension `manifest.json` / `manifest.dev.json`: name → "Postorizon",
  description updated, `externally_connectable` match `*.postiz.com` → `*.postorizon.com`.
- Design tokens: brand `tokens.css` copied verbatim to
  `apps/frontend/src/app/postorizon.tokens.css` and imported (`import '../postorizon.tokens.css'`)
  by all three root layouts next to `global.scss`. Tokens are present but **not yet
  mapped** onto the app's upstream `colors.scss` theme (see §5.5).

**AGPL compliance**
- `LICENSE` and all existing copyright notices untouched.
- New `OPEN_SOURCE.md`: provenance (modified version of Postiz, upstream commit),
  AGPL-3.0 §13 source offer for the future hosted service, trademark note, and a
  "Modifications by Postorizon" list (to be extended as changes land).

**Deliberately NOT renamed** (internal identifiers; renaming risks breaking the build):
the `@gitroom/*` TypeScript path aliases, workspace package names `postiz-frontend`,
`postiz-backend`, `postiz-orchestrator`, `postiz-extension`, `@postiz/node`, and
`POSTIZ_*` environment variable names.

## 2. Remaining "postiz" / "gitroom" strings (grep, excl. `.git`, `node_modules`, `pnpm-lock.yaml`)

| String | Before (lines / files) | After (lines / files) |
|---|---|---|
| `postiz` | 1,108 / 161 | 1,020 / 141 |
| `gitroom` | 2,984 / 589 | 2,974 / 590 |

**`gitroom` — overwhelmingly internal:** 2,823 of the remaining lines are `@gitroom/*`
import paths, which are pure TypeScript path aliases defined in `tsconfig.base.json`
(never rendered). The rest is tsconfig alias definitions, license/copyright notices
(must be preserved), the billing FAQ's link to the upstream GitHub repo (attribution —
appropriate under AGPL), and a sample image URL (`uploads.gitroom.com`) in webhooks demo data.

**`postiz` — remaining by area (lines):**
- `libraries/` 624 — of which **504 lines are translation locale files**
  (`react-shared-libraries/src/translation/locales/**`, ~20 languages; user-visible
  in-app copy when those locales are active). The other ~120 are NestJS-library
  strings, incl. AI-chat tool prompts referencing the "Postiz CLI" and docs.postiz.com.
- `apps/frontend/src` 146 — 28 component files: in-app developer/public-API pages
  ("Postiz CLI", `npm install -g postiz`, `POSTIZ_API_KEY`, docs.postiz.com links),
  register-page Terms/Privacy links (`postiz.com/terms`, `postiz.com/privacy`),
  an affiliate link (`affiliate.postiz.com`) in `top.menu.tsx`, onboarding docs link,
  billing FAQ. Plus 4 files under `src/app` (one code comment, legal-link targets).
- `apps/backend` 29 — incl. agency email templates linking to `postiz.com/agencies/…`
  and a hard-coded `nevo@postiz.com` address in `agencies.service.ts`.
- `apps/sdk` 11 — incl. the SDK's default API base URL `https://api.postiz.com`
  (`apps/sdk/src/index.ts`) and the `@postiz/node` package name.
- `apps/orchestrator` 2, `apps/extension` 3 (package name etc.).

## 3. Telemetry / phone-home findings

Grepped the whole repo for posthog, sentry, mixpanel, segment, amplitude,
plausible, GTM, dub, datafast, chatbase and hard-coded Postiz/Gitroom endpoints.

- **PostHog / Mixpanel / Segment / Amplitude: none present.**
- **Plausible (next-plausible)** — in `apps/frontend/src/app/(app)/layout.tsx`.
  Activates only when `STRIPE_PUBLISHABLE_KEY` is set, but its site domain was
  hard-coded to `postiz.com` / `gitroom.com`, i.e. page views would have been
  registered to Postiz's Plausible site once billing was configured.
  **Fixed:** domain → `postorizon.com`.
- **DataFast analytics** (`datafa.st` script, same layout) — gated by
  `DATAFAST_WEBSITE_ID` (unset by default), but `data-domain` was hard-coded
  `postiz.com`. **Fixed:** → `postorizon.com`.
- **Dub.co analytics** (`@dub/analytics`) — was enabled whenever
  `STRIPE_PUBLISHABLE_KEY` was set (`dub={!!process.env.STRIPE_PUBLISHABLE_KEY}`)
  with the refer domain hard-coded to `postiz.pro` (Postiz's Dub workspace), feeding
  click/partner attribution to Postiz. **Fixed:** `dub={false}` in the app layout
  (the extension/provider layouts already had `false`) and refer domain →
  `postorizon.com`. Side effect: Dub partner attribution on subscriptions is off —
  Postorizon has no Dub programme, so this is intended.
- **Sentry** (frontend component + backend initializer + feedback component) —
  fully env-gated by `NEXT_PUBLIC_SENTRY_DSN`; frontend default is `''` and the
  backend initializer returns early when unset. **No change needed**; nothing is
  sent unless the operator configures their own DSN.
- **Google Tag Manager / Google Ads** — gated by `NEXT_PUBLIC_GTM_ID`; the
  frontend `postinstall` fetch script skips cleanly when unset (observed in the
  install log). No change needed.
- **Facebook** — `public/f.js` is Meta's JS SDK (used for channel login, not
  telemetry); the Facebook pixel is gated by `NEXT_PUBLIC_FACEBOOK_PIXEL`. Unchanged.
- **Chatbase** — gated by `CHATBASE_TOKEN`. Unchanged.
- **Next.js framework telemetry** — the build prints Next's anonymous-telemetry
  notice; that's the framework, not Postiz. Recommendation: set
  `NEXT_TELEMETRY_DISABLED=1` in deployment env (not changed in code).

## 4. Install & build verification (exact outcomes)

Environment: Node v24.22.1 (repo engines ask for 22.23.4 — warning only),
pnpm 10.6.1 (installed via npm; it was not on PATH), no Docker.

- **`pnpm install --frozen-lockfile` — attempt 1:** dependency fetch/add completed
  (4,401 packages added, "done"), then the root `postinstall` script
  (`pnpm run prisma-generate`) failed while downloading Prisma engines:
  `Error: aborted … code: 'ECONNRESET'` (TLS connection reset), install exit code 1.
  pnpm also warned that dependency build scripts were **ignored** (pnpm 10 default),
  including `@prisma/engines`, `prisma`, `esbuild`, `@swc/core` — these need
  `pnpm approve-builds`.
- **Attempt 2:** failed immediately with
  `EPERM: operation not permitted, chown '…/node_modules/.modules.yaml.847771760'`,
  exit 255 — a sandbox file-ownership restriction. Stopped after 2 attempts per plan.
  Net state: `node_modules` is populated, but the Prisma client was **never generated**.
- **Frontend build** (`pnpm --filter ./apps/frontend run build`, Next.js 16.4.2 / Turbopack):
  **FAILED**, exit 1, first (and only reported) error:
  `Error: Module not found: Can't resolve '.prisma/client/index-browser'`
  at `./node_modules/@prisma/client/index-browser.js:1:16`, import trace via
  `libraries/nestjs-libraries/src/dtos/auth/login.user.dto.ts` →
  `apps/frontend/src/components/auth/login.tsx`. This is the direct consequence of
  the ungenerated Prisma client; Turbopack stops at the first error, so no verdict
  on later stages (type-check etc.) exists yet. Importantly, the build got past
  config load and module graph construction for the rest of the app, and none of
  the Phase 0 edits produced an error before this point.
- **Backend build:** not attempted (per plan, it was conditional on frontend success).
- **Staging via Docker Compose:** not attempted — Docker is unavailable in this
  environment. **Unverified.**

**Remediation path (for an environment with normal file ownership + network):**
`pnpm approve-builds` (allow `@prisma/engines`, `prisma`, `esbuild`, `@swc/core`) →
`pnpm install --frozen-lockfile` → `pnpm run prisma-generate` → rebuild
frontend/backend/orchestrator.

## 5. Remaining Phase 0 gaps

1. **Builds unverified** — install postinstall (Prisma generate) and all app builds
   are blocked by the environment issues in §4. This is the top gap.
2. **Staging deployment unverified** — `docker-compose.yaml` deploy needs a Docker host.
3. **Developer apps for the top-8 networks not started** — requires the owner's
   developer accounts per network (Meta, X, LinkedIn, TikTok, Google, …); X API is
   paid. This is on the critical path and is an external-approval process, not code.
4. **Second-round user-visible strings** (Phase 1 sweep): translation locales
   (~504 lines), in-app developer/public-API docs (Postiz CLI naming, docs.postiz.com),
   register Terms/Privacy links (need real Postorizon legal pages first),
   `affiliate.postiz.com` menu link, SDK default API URL + `@postiz/node` name
   (change when the Postorizon API domain exists), backend agency email templates,
   and the auth page's "20,000+ entrepreneurs" claim — that figure is Postiz's and
   must be replaced before any public launch.
5. **Theming not yet applied** — `--pz-*` tokens are imported, but the app still
   renders in the upstream theme (`colors.scss`). Mapping the Postorizon palette
   onto the app theme variables is Phase 1 work. The `LogoTextComponent` light
   lockup should be eyeballed on the billing/connect surfaces once the app runs.
6. **Legacy brand assets still in `apps/frontend/public/`** (`postiz.svg`,
   `postiz-text.svg`, `logo.svg`, `postiz-fav.png`, `favicon.png`) — left in place
   pending a full reference sweep (emails/other surfaces may reference them).
7. **`IS_GENERAL` branding switch** — page titles now say "Postorizon" on both
   branches of `isGeneralServerSide()`, but the flag still drives other upstream
   behaviours; audit before launch.
