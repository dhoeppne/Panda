# Panda settings store

An optional backend for Panda: one SQLite file that holds each user's
settings, so one Panda URL shows the same agents, sidebar layout and
preferences on every device. Panda works without it. When `/api/settings`
does not answer with this server's JSON, Panda keeps every setting in the
browser's `localStorage` only, as it did before the store existed.

The server is `settings-server.mjs`: plain JavaScript on Node 24 with no npm
dependencies (`node:http` and `node:sqlite` only). `compose.yaml` runs it as
the `settings` service. The `web` service's nginx proxies `/api/settings` to
it. The service publishes no port.

## What it stores

One table:

```sql
settings(user TEXT NOT NULL, key TEXT NOT NULL, value TEXT, rev INTEGER NOT NULL,
         updated_at INTEGER NOT NULL, PRIMARY KEY (user, key))
```

- `value` holds JSON text. A NULL `value` is a tombstone: the key was removed.
- `rev` counts writes per user. Each write stores the user's highest `rev`
  plus 1.
- Panda (`src/settingsSync.ts`) syncs these `localStorage` keys, each sent as
  its raw string: `panda.profiles`, `panda.nav`, `panda.mcpServers`,
  `panda.theme`, `panda.fontSize.ui`, `panda.fontSize.code`, `panda.locale`,
  `panda.lastFamily`. Conversations are not stored here: sessions live with
  each agent. Secret MCP fields never reach `localStorage`, so they never
  reach this store either.

## Users

Every request is the user `default` for now. `userOf(request)` in
`settings-server.mjs` is the one place that decides the user. A later change
maps the reverse proxy's authenticated user to it.

## Routes

| Route | Answer |
|---|---|
| `GET /api/settings/healthz` | 200 `ok\n` as `text/plain` |
| `GET /api/settings` | 200 `{"user", "rev", "entries": {"<key>": {"value", "rev"}}}` with `ETag: "<rev>"` and `Cache-Control: no-store`. 304 with no body when `If-None-Match` equals the ETag. |
| `PUT /api/settings/<key>` | Body `{"value": <JSON or null>, "baseRev": <integer ≥ 0>}`. `baseRev` is the key's rev the client last saw, 0 for an unseen key. 200 `{"rev"}` on success. 409 `{"rev", "value"}` with the stored state when the stored rev differs from `baseRev`. |

Limits, each answered with `{"error": "..."}`:

- The key matches `^[A-Za-z0-9._-]{1,128}$` (400).
- The body is at most 1 MiB (413). nginx enforces the same limit.
- A user has at most 64 keys, tombstones included (400).
- Malformed JSON or a wrong body shape (400), an unknown path (404), a wrong
  method (405).

Every JSON answer has `Content-Type: application/json; charset=utf-8`. Panda
depends on that header to tell this server from an `index.html` fallback.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PANDA_SETTINGS_DB` | `/data/settings.sqlite` | The SQLite file |
| `PANDA_SETTINGS_PORT` | `8531` | The listen port |
| `PANDA_SETTINGS_BIND` | `0.0.0.0` | The listen address (inside the container network) |

The server closes cleanly on SIGTERM and SIGINT.

Run it locally:

```sh
PANDA_SETTINGS_DB=./settings.sqlite node server/settings-server.mjs
```

## Back up the database

The file lives in the compose volume `panda-settings` (Docker names it
`<project>_panda-settings`). Copy a consistent snapshot while the service
runs:

```sh
docker compose exec settings node -e \
  "new (require('node:sqlite').DatabaseSync)('/data/settings.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
docker compose cp settings:/data/backup.sqlite ./panda-settings-backup.sqlite
docker compose exec settings rm /data/backup.sqlite
```

Restore a backup from the current directory:

```sh
docker compose stop settings
docker compose run --rm --no-deps -v "$PWD:/backup:ro" settings \
  cp /backup/panda-settings-backup.sqlite /data/settings.sqlite
docker compose start settings
```

## Tests

`server/settings-server.test.mjs` runs under vitest against a real SQLite
file and real HTTP:

```sh
pnpm exec vitest run server/settings-server.test.mjs
```
