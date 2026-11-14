# Postorizon

**One post. Every horizon.**

Postorizon is a social media management and marketing platform: compose once, and
publish natively adapted posts to every social, community and Web2 destination —
with a content calendar, team and client approvals, a unified inbox, analytics,
and agent access (public API, webhooks, MCP server and CLI) on every plan.

> **Provenance & license.** Postorizon is a modified version of the open-source
> [Postiz](https://github.com/gitroomhq/postiz-app) project by Gitroom, used and
> modified under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.
> The full license is in [LICENSE](LICENSE); attribution and source-offer details
> are in [OPEN_SOURCE.md](OPEN_SOURCE.md). Postiz® and Gitroom™ names and marks
> belong to their respective owners and are used here only to give the legally
> required attribution — Postorizon is not affiliated with or endorsed by Gitroom.

## Tech stack

- pnpm workspaces (monorepo), Node.js
- Next.js (React) frontend — `apps/frontend`
- NestJS backend — `apps/backend`
- Temporal orchestrator (durable scheduling/publishing) — `apps/orchestrator`
- Prisma + PostgreSQL, Redis
- Stripe billing, Resend email
- Browser extension — `apps/extension`; Node SDK — `apps/sdk`; commands service — `apps/commands`

## Development setup

Prerequisites: Node.js 22+, pnpm 10, and (for the full stack) Docker for
PostgreSQL/Redis/Temporal via the bundled compose files.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env   # then fill in DATABASE_URL, REDIS_URL, JWT_SECRET, URLs…

# 3. Start infrastructure (Postgres, Redis, Temporal) — requires Docker
pnpm run dev:docker

# 4. Generate the Prisma client and push the schema
pnpm run prisma-generate
pnpm run prisma-db-push

# 5. Run the apps (frontend + backend + orchestrator + extension) in parallel
pnpm run dev
# …or just frontend + backend:
pnpm run dev-backend
```

Production builds:

```bash
pnpm run build            # frontend + backend + orchestrator
pnpm run build:frontend   # frontend only
pnpm run build:backend    # backend only
```

A production Docker Compose deployment is described by `docker-compose.yaml`
(inherited from upstream; see [OPEN_SOURCE.md](OPEN_SOURCE.md) for the current
modification status).

## Repository layout

| Path | Contents |
|---|---|
| `apps/frontend` | Next.js web app (Postorizon-branded UI, design tokens in `src/app/postorizon.tokens.css`) |
| `apps/backend` | NestJS API, auth, organisations, channel integrations, billing |
| `apps/orchestrator` | Temporal workflows for scheduled publishing |
| `apps/commands` | Commands service (`postorizon-command`) |
| `apps/sdk` | Node SDK for the public API |
| `apps/extension` | Browser extension |
| `libraries/` | Shared NestJS/React/helper libraries, Prisma schema |

## License

AGPL-3.0 — see [LICENSE](LICENSE) and [OPEN_SOURCE.md](OPEN_SOURCE.md).
