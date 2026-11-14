# Postorizon CLI

A small standalone command-line client for the Postorizon public API.
Plain Node.js (>= 18), zero dependencies — it is intentionally **not** part
of the pnpm workspace, so it can be copied anywhere and run as-is.

## Install / run

```bash
# from this folder
npm link          # optional: puts `postorizon` on your PATH
# or run it directly
node bin/postorizon.js --help
```

## Configuration

| Environment variable | Purpose | Default |
|---|---|---|
| `POSTORIZON_API_KEY` | API key from Postorizon **Settings > Public API** | *(required for API commands)* |
| `POSTORIZON_API_URL` | API base URL (self-hosted instances) | `https://api.postorizon.com` |

The CLI calls the public API under `<base>/public/v1`, the same surface as
the Node SDK in `apps/sdk`.

## Commands

### `postorizon posts:create`

```bash
postorizon posts:create --text "Hello from Postorizon" --integration <channel-id>
postorizon posts:create --text "Launching tomorrow" \
  --integration <id-1> --integration <id-2> \
  --date 2026-12-01T09:00:00Z
```

- `--text` (required): the post copy.
- `--integration` (required, repeatable): connected channel ids.
- `--date` (optional, ISO 8601): without a date the post is saved as a
  **draft**; with a date it is **scheduled**.
- `--type` (optional): `draft` | `schedule` | `now` — overrides the default
  behaviour above (`now` publishes immediately).
- `--shortlink` (optional flag): ask the API to shorten links.

### `postorizon posts:list`

```bash
postorizon posts:list
postorizon posts:list --from 2026-11-01 --to 2026-11-30
postorizon posts:list --customer <customer-id>
```

Lists posts in a date window (default: from 7 days ago to 30 days ahead),
one line per post: id, date, state, channel, and a content preview.

### `postorizon auth:login`

Prints how to configure API access (this CLI authenticates with
`POSTORIZON_API_KEY`; there is no interactive login).

### `postorizon --help`

Shows usage. `--help` and the `auth:login` text never make a network call.

## License

AGPL-3.0 — part of the Postorizon project (a modified version of Postiz;
see the repository root `OPEN_SOURCE.md`).
