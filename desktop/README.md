# panda-desktop

Tauri v2 shell hosting the workspace's Vite app, with native boundaries for
local stdio agents, external links, and authenticated WebSocket connections.
The product is the webview; its process plane
is described by ADR
[0007](../docs/adr/0007-desktop-shell-and-stdio-transport.md)).

Status: the shell ships as **beta** — its stdio path is covered by the
in-shell acceptance harness below, but it has not been through organized
release testing. User-facing docs recommend the web version for day-to-day
use; revisit this when a proper test pass happens.

## Commands

```sh
pnpm desktop:dev    # vite + cargo run — opens the shell window on http://127.0.0.1:5173
pnpm desktop:build  # tauri build — bundles a .dmg on macOS (aarch64), NSIS setup.exe on Windows
```

Prerequisites: the workspace's Node 24 / pnpm 11, plus a Rust toolchain
(rustup). First run compiles `src-tauri` (a few minutes); later runs are
incremental — note that editing `tauri.conf.json` also triggers a rebuild,
because the config is embedded via `generate_context!`.

## Servers behind a website login

The desktop app has its own persistent website-data store. Signing into a
server in Safari or Chrome does not sign the desktop app in.

1. In Settings → Agents, add or edit the WebSocket profile and enter its
   `wss://` endpoint.
2. Click **Sign in to server**. Complete the server's login (including MFA)
   in the new app window, then close that window.
3. Click **Test connection**, then save the profile and connect normally.

`src-tauri/src/server_auth.rs` opens the login window without local IPC
capabilities. Its default persistent cookie store is shared with the main
webview. The native WebSocket handshake reads matching cookies from that
store, including HttpOnly cookies, and supplies them without exposing
credentials to JavaScript. Domain, path, Secure and expiry rules are checked;
redirects are not followed with credentials. This avoids cross-site cookie
restrictions on sockets opened from the bundled app's local origin.
When the server session expires, sign in again from the profile form.

The native commands are `server_sign_in`, `websocket_connect`,
`websocket_write`, and `websocket_close`. They accept calls only from the
local main window. Both real connections and connection tests use this
transport; the web app continues using browser WebSockets.

Verify with `cargo test --manifest-path desktop/src-tauri/Cargo.toml` and
`pnpm exec vitest run src/acp/transport/NativeWebSocketTransport.test.ts`.

## Layout

- `src-tauri/src/main.rs` — the process plane: three commands
  (`stdio_spawn` / `stdio_write` / `stdio_kill`) around a tokio `Child`.
  stdout/stderr stream back as base64 chunks over a Tauri `Channel`; exit
  funnels into one `Exit` event. Orphan guards (#7): the `RunEvent::Exit`
  hook sweeps every tracked child (stdin EOF + SIGTERM → 3 s → SIGKILL) and
  waits synchronously — tao ends its loop in `std::process::exit`, so
  `kill_on_drop` alone never fires; a webview (re)load sweeps the same way
  via `on_page_load`, because the reloaded JS state no longer owns the old
  children. Windows terminates directly (no SIGTERM). It also initializes
  Tauri's `opener` plugin; only `http(s)`, `mailto:`, and `tel:` URLs are
  permitted by the default capability, and external web links use it to open
  the operating system's default handler instead of another webview window.
- `src-tauri/tauri.conf.json` — window/bundle config. `frontendDist` is
  resolved **relative to `src-tauri`**, so it must point at `../../dist`
  (the repo-root build output), and `devUrl` pins `127.0.0.1:5173`.
- `src/desktop/boot.ts` (repo root) — the webview side: registers the stdio
  transport factory and default-URL opener over Tauri IPC, lazily imported by
  `main.tsx` only when `__TAURI_INTERNALS__` is present, so the browser bundle
  never carries Tauri APIs.

## Shell acceptance harness

WKWebView exposes no automation surface (no accessibility tree for the
content, no remote debugging), so end-to-end shell acceptance runs
in-page: point `devUrl` at
`http://127.0.0.1:5173/desktop-acceptance.html?agent=<abs path to test-agent>`
and relaunch `desktop:dev`. The page drives the **production** stdio path —
boot factory registration → connect → `session/new` → a full scripted turn
with tools → disconnect — against a live test-agent, and reports each step
through the `panda.acceptance` localStorage key (`finished` + per-step
`pass`/`fail`). Shell-side oracles while it runs: the sandbox dir gets
seeded, a `pnpm --dir …/test-agent stdio` process chain appears in `ps`,
and after disconnect no processes remain.

## Pins that must not drift

- vite `server.host: '127.0.0.1'` — on macOS Node resolves `localhost`
  IPv6-only while WKWebView's lookup goes IPv4-first; an IPv6-only listener
  leaves the shell window blank (browsers never notice, they retry both
  stacks).
- vite `server.strictPort: true` — the shell's `devUrl` pins 5173; a busy
  port must fail loudly instead of drifting to 5174 where the shell would
  load nothing.

## Artifacts & CI

[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) builds
on manual dispatch and on `v*` tags: `Panda_<ver>_aarch64.dmg`,
`Panda_<ver>_x64-setup.exe`, `Panda_<ver>_x64-portable.zip` (the bare
`--no-bundle` exe). Tag builds attach everything to a GitHub Release.
Artifacts are unsigned by decision — see ADR 0007.

## Restart recovery

Panda remembers the last successfully opened chat on this device. A launch
without a route reopens that family and session through the existing
`session/load` path. Explicit chat, settings, or new-chat links take
precedence. Choosing New chat clears the remembered selection; visiting
settings preserves it. Temporary direct connections are not restored.

If the agent is offline, the requested chat stays selected with a Retry
action. Retry opens that same chat; a missing family or deleted session
never creates a replacement conversation. The previous chat's composer is
hidden while the requested chat is opening or unavailable.

The `panda.lastChat` storage key is device-local and is not part of settings
sync. This restores selection, not offline transcripts or unsent drafts;
history is still loaded from the agent. Desktop host capabilities finish
initializing before startup restoration begins.

## Network and activation recovery

Failed WebSocket connections get a fresh bounded retry cycle when the
network comes online, Panda becomes visible/focused, or a delayed timer
indicates the app resumed after a long pause. Signals coalesce while a
retry or connection attempt is already active. Each cycle uses the existing
1/2/4/8-second delays and then stops until another recovery signal or a
manual retry. A failed initial connection can recover this way too.

Recovery preserves the session id, workspace and foreground selection.
If the restored chat was waiting on its failed connection, it opens again
when that connection succeeds. Healthy connections, pending sign-in flows,
intentional disconnects/logouts, removed profiles, and local stdio commands
are not restarted by these signals. Network-online is only a hint: every
dial still has to succeed against the actual agent.

This handles connections already reported as failed. It does not force a
reset of an apparently connected socket or claim to detect every half-open
socket after sleep. Verify physical macOS sleep/wake with the installed app.
