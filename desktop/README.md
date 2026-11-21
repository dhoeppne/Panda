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
- `src-tauri/src/server_auth.rs` owns server sign-in, cookie lookup and the
  native socket registry. `src-tauri/src/websocket.rs` runs each connected
  socket's I/O, liveness checks and clean shutdown.
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

[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) is a
manual artifact build. Supply an existing stable `panda-vX.Y.Z` tag in
`release_tag`. The workflow resolves the full tag ref to a commit, checks
out that exact commit, and rejects changed tags or dirty source. It retains
the release helper outside the checkout so older tags can be built using
the current release tooling.

The tag determines the UI and native app version, through `PANDA_VERSION`
and a generated Tauri config overlay. Source package/Cargo/config versions
are not edited. macOS also embeds `PandaReleaseTag` and `PandaSourceCommit`
in the app's Info.plist. Before collecting artifacts, verification checks
both native version fields, bundle identity, the embedded tag/commit, an
ARM64 executable and the version in the built frontend. Windows checks the
executable product version; Windows execution still needs a Windows runner.

Outputs are `Panda_<ver>_aarch64.dmg`, `Panda_<ver>_x64-setup.exe`,
`Panda_<ver>_x64-portable.zip` and a platform-specific release JSON recording
the source tag, commit, version and executable SHA-256. They are uploaded as
workflow artifacts named `panda-desktop-<ver>-<OS>`.

The build jobs have read-only repository permissions. The macOS job creates
a signed updater archive with the public key in `desktop/updater.pub` and
the private signing key supplied only to its build step. Windows continues
producing the versioned installers above; the update feed currently supports
Apple Silicon macOS only.

`publish_release` defaults to false. When explicitly enabled, a separate job
with repository write permission creates or resumes a draft release,
uploads the signed update, downloads it again, and verifies the downloaded
bytes and signature before publishing. All stable publishers are serialized;
same/older versions, changed tags, and already-published releases are refused.
Failed publication leaves the draft hidden and the previous stable feed in
place. The publishing job receives no private signing key.

### Local verification without GitHub

Use a clean checkout of the selected tag. Put generated files outside the
checkout; keep the path for all commands below:

```sh
release_dir=$(mktemp -d /private/tmp/panda-desktop-release.XXXXXX)
node /path/to/current/scripts/desktop-release.mjs plan panda-vX.Y.Z "$release_dir"
node "$release_dir/release-tool.mjs" check "$release_dir"
PANDA_VERSION=X.Y.Z pnpm desktop:build --bundles app --config "$release_dir/tauri.release.json"
node "$release_dir/release-tool.mjs" verify-macos "$release_dir"
```

Planning resolves local tags only. These commands neither fetch from nor
write to GitHub, and do not install or launch the app. A local `--bundles app`
check verifies the app bundle; the workflow additionally packages its DMG.
Do not label a dirty development checkout as a tagged release: the source
check intentionally refuses it. The current helper can be invoked by an
absolute path while working in an older clean tag checkout.

### Signing setup and release procedure

The updater signing key is independent of Apple code signing. The public
key can be committed; the private key must stay outside this repository.
Back up the private key securely: existing clients trust its public half,
so losing it interrupts that update path. This personal-use Mac pipeline
uses ad-hoc Apple signing and does not notarize the application.

1. Generate a dedicated key with Tauri's `signer generate --ci --write-keys`
   command into a private directory outside the checkout. Keep directory
   permissions at `0700` and private-key permissions at `0600`. Commit only
   the generated `.pub` file as `desktop/updater.pub`.
2. Keep a separate secure backup of the private key. Repository setup must
   add its contents as `TAURI_SIGNING_PRIVATE_KEY`; set
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password. Never
   paste a private key into a PR, issue, console log or this document.
3. Dispatch Desktop for the desired `panda-vX.Y.Z` tag with publishing off.
   The job fails if the signing key is missing or mismatches the public key.
   macOS artifacts include the DMG, `.app.tar.gz`, `.sig`, `latest.json`,
   and `updater-release.json` with source and file hashes.
4. After checking the build, explicitly enable `publish_release` for the
   selected tag. The job verifies the remote tag's commit, prevents a
   version rollback, checks downloaded assets, and then promotes the draft
   to the stable GitHub Release. Published assets are never overwritten.
5. Retain the previous installer for manual recovery. A corrective automatic
   release should use a higher version. Runtime update controls and the
   first installed-app update rehearsal are subsequent milestones.

`latest.json` uses a version-specific HTTPS GitHub archive URL and includes
the signature contents, not a signature URL. The stable endpoint is
`https://github.com/la-creche/Panda/releases/latest/download/latest.json`.
The independent `desktop/updater-verify` CLI checks Tauri's base64-wrapped
Minisign files using pinned `minisign-verify`, with no app/GitHub credentials.

For a local rehearsal, configure the generated release overlay with
`scripts/updater-release.mjs configure <plan-dir> <public-key>`, build with
the signing key in the environment, and rerun the native app verification.
Build the verifier with `cargo build --locked --release --manifest-path
desktop/updater-verify/Cargo.toml`. Then run `assemble` and `check-tamper`,
each taking the plan directory and verifier executable. `publication-plan`
prints the intended assets without contacting GitHub. The publisher CLI
requires explicit CI/repository/publication flags before making any request.

Release-tool tests run with `pnpm exec vitest run
scripts/desktop-release.test.mjs scripts/updater-release.test.mjs`. The real
signer tests run when `PANDA_UPDATER_VERIFY_BIN` names a built verifier
(or its default debug build exists); release builds also check the actual
archive and reject a deliberately modified copy before collecting assets.

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
sync. History is still loaded from the agent; text-draft recovery is
described below. Desktop host capabilities finish
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

Native desktop WebSockets also check transport liveness: after 30 seconds,
Panda sends a WebSocket Ping and waits up to 10 seconds after sending for a
matching Pong. A missing reply or failed probe closes the socket as an
unexpected failure, activating the same bounded reconnect path. These are
WebSocket control frames, not ACP requests: an idle or long-running agent
can stay connected without implementing a new method. Probes never resend
a user prompt or approve a pending request.

If a heartbeat deadline is at least 5 seconds late (for example after process
suspension), Panda sends a fresh probe with a new payload and gives it a new
10-second response window. An old Pong cannot satisfy the new probe. This
avoids immediately resetting a healthy connection on wake. Native writes
remain bounded to 15 seconds. Explicit disconnect/app shutdown stays clean
and stops the checks; browser sockets and local stdio are unchanged.

Verify physical macOS sleep/wake and a network blackhole with the installed
app. The native tests simulate missed replies and delayed scheduling using
paired in-memory WebSockets and a paused clock.

## Text draft recovery

Unsent text in saved-family chats is saved on each text change on this
device and restored when Panda restarts. The draft follows the stable
family/session identity, including sessions opened on an extra connection.
Live message queues and stream remounts keep their connection-specific keys.
Each family's New chat view has its own draft, separate from existing chats.

The versioned `panda.textDrafts` record is local only and excluded from
settings sync. Only text is written: attachments, file contents, attachment
errors and queued messages stay in memory. Temporary direct connections
and unset-family placeholders are not persisted.

Submitting/queuing a message or erasing its text clears the saved draft.
Deleting a session clears its family's saved draft without removing a
different family's draft with the same session id. Storage failures leave
editing usable in memory; malformed saved records do not prevent startup.

## Desktop notifications

Settings → General has an opt-in notification control and a test button.
Notifications are off by default and the preference is device-local. The
test confirms that a notification was requested, not that macOS displayed
it: macOS Notifications settings and Focus can suppress banners, and the
plugin's desktop permission result does not report those settings.

While Panda is running and connected, successful agent turns and genuinely
pending permission requests can generate an alert. Cancelled/failed turns,
replayed history, policy denials and remembered approvals do not. Alerts
for the chat already being read in a focused window are suppressed; another
chat or a minimized/background window can alert. Notification text is
generic: no prompts, tool arguments or conversation titles are included.

A body click shows, unminimizes and focuses the main window, then opens the
exact chat through its existing route. It never approves a request. Deleted
or unavailable chats follow normal route recovery. Plugin listeners are
installed before connections start; notification failures do not block chat.

The JS and Rust notification plugins are pinned to 2.8.1 (desktop click
callbacks shipped in 2.6.0). Native notification/window permissions apply
only to the local main window; login windows and remote pages get no grant.
Development notifications may appear as Terminal. Use the installed release
app to check Panda's banner identity, macOS settings, suppression and taps.
App-quit delivery/click routing and server push are outside this feature.
