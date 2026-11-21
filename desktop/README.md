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

Forgejo runs [`.forgejo/workflows/ci.yml`](../.forgejo/workflows/ci.yml) for
PR tests and container smoke tests. It also builds the independent signature
verifier so the real signer/tampering tests run with throwaway keys. No
private release key enters CI. The forge currently has Linux `ci-vm`
runners; native macOS and Windows builds run locally. The historical
[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) remains
an opt-in GitHub artifact build and is ignored by Forgejo.

Use an existing stable `panda-vX.Y.Z` tag. The helper resolves its full tag
ref to a commit and rejects changed tags, another checkout, or dirty source.
It can be retained outside the checkout to build an older tag using current
release tooling. The generated overlay supplies the native version;
`PANDA_VERSION` supplies the frontend version. Source version files do not
change. macOS embeds `PandaReleaseTag` and `PandaSourceCommit` in Info.plist.
Verification checks both native version fields, bundle identity, embedded
provenance, an ARM64 executable and the frontend version.

### Local release build

These commands build artifacts without publishing or changing the installed
app. Run from a clean checkout of the selected tag. Put generated files
outside that checkout and retain the helper/plan directory:

```sh
release_dir=$(mktemp -d /private/tmp/panda-desktop-release.XXXXXX)
node /path/to/current/scripts/desktop-release.mjs plan panda-vX.Y.Z "$release_dir"
node "$release_dir/release-tool.mjs" check "$release_dir"
```

1. Preserve the current updater helper and its relative import before
   switching to an older source checkout. Copy `scripts/updater-release.mjs`
   to the plan directory and its `scripts/desktop-release.mjs` dependency
   there too. Retain the current public key and independent verifier.
2. Configure signing with `node /path/to/current/scripts/updater-release.mjs
   configure "$release_dir" /path/to/current/desktop/updater.pub`. Keep the
   existing private key outside the repo; use directory mode `0700` and file
   mode `0600`. Back it up securely. Do not regenerate it for each release.
3. Build on Apple Silicon macOS with the existing key supplied only to the
   build command:

   ```sh
   PANDA_VERSION=X.Y.Z TAURI_SIGNING_PRIVATE_KEY=/private/path/signing.key \
     pnpm desktop:build --bundles app,dmg --config "$release_dir/tauri.release.json"
   node "$release_dir/release-tool.mjs" verify-macos "$release_dir"
   ```

4. Build the current verifier with `cargo build --locked --release
   --manifest-path /path/to/current/desktop/updater-verify/Cargo.toml`, then
   run the current updater helper's `assemble` and `check-tamper` commands,
   each with the plan directory and verifier executable. Assembly checks
   native archive metadata, the signature and checksums. The signed output
   contains the DMG, `.app.tar.gz`, `.sig`, `latest.json` and a receipt.
5. Run `publication-plan` with the plan directory to inspect the intended
   assets without contacting the forge. Retain the previous installer for
   manual recovery; a corrective automatic release uses a higher version.

The updater signing key is independent of Apple code signing. This
personal-use pipeline uses ad-hoc Apple signing and does not notarize the
app. Windows retains its installer/portable artifacts; automatic updates
currently support Apple Silicon macOS only.

### Publish to Forgejo

The native client checks
`https://git.davidhoeppner.ca/la-creche/Panda/releases/download/latest/latest.json`.
The manifest contains a version-specific HTTPS archive URL on that same
forge and the signature contents. No app credential is needed for this
public release feed.

The opt-in publisher uses Forgejo's API. Supply its credential only to the
publication command; never store it in a plan, receipt, log, URL or repo.
For the existing Mac Keychain setup:

```sh
FORGEJO_TOKEN="$(security find-generic-password -s forgejo-api -w)" \
PANDA_FORGEJO_API_URL=http://10.0.0.17:3500/api/v1 \
PANDA_PUBLISH_RELEASE=true \
  node /path/to/current/scripts/publish-updater.mjs "$release_dir" /path/to/panda-updater-verify
```

The public HTTPS API is the default; only that API and the explicitly
configured internal forge API are accepted. The credential travels only in
headers; authenticated asset downloads cannot redirect to another origin.
The publisher verifies the remote tag's exact commit, refuses same/older
versions and published-asset overwrites, and uploads into a hidden draft.
A resumed draft may reuse only byte-identical expected assets. It downloads
and re-verifies the complete asset set, then rechecks the tag and latest
stable release before promotion. It verifies the public stable feed after
promotion and hides its new release again if that check fails.

Publication is serialized on this Mac with an exclusive temporary lock.
Use one publishing host; cross-host concurrent publication is not supported.
A failed command retains its draft for inspection and retry. No repository
signing secret or GitHub credential is needed.

Release-tool tests: `pnpm exec vitest run scripts/desktop-release.test.mjs
scripts/updater-release.test.mjs scripts/publish-updater.test.mjs`. The real
signer tests run when the independent verifier is built (or
`PANDA_UPDATER_VERIFY_BIN` names it); they never use the release private key.

## In-app updates

Installed Apple Silicon macOS release builds show **Settings → General →
Panda updates**. Development builds, other platforms, and the browser omit
these controls. The native package version is displayed independently of
the frontend's fallback version.

1. Startup checks the stable HTTPS feed once without waiting for the network
   before opening chats. **Check for updates** retries manually; offline or
   unavailable feeds report a Settings error and leave chats usable.
2. An available version shows plain-text release notes and an explicit
   **Install and restart** action. Nothing downloads or installs from the
   startup check alone. Download progress is shown when the server supplies
   a size; otherwise the progress indicator is indeterminate.
3. Before download and again before installation, Panda requires all chats
   to be idle, with no connection/session switch, pending approval, queued
   message (including paused queues), attachment, or file read. Nonempty
   text drafts must be saved and read back exactly; temporary direct-chat
   drafts or unavailable storage block the update. Work arriving during a
   download defers installation until another explicit click.
4. Installation locks input, new prompts, session opens and automatic
   reconnects. Tauri verifies the downloaded signature using the committed
   public key. The app checks for new work again before restart. Native
   restart closes sockets, blocks late spawns and waits up to five seconds
   for local agent exit watchers, including any spawn already in progress.
5. Download or installation errors unlock the UI and allow another check.
   If restart is deferred or fails, **Restart Panda** retries without
   reinstalling. Startup recovery then reopens the saved chat and text
   drafts through the existing recovery paths.

Only `src/desktop/boot.ts` imports the updater's Tauri API. The controller
uses a mockable host with separate check, download, install and restart
steps. The macOS-only capability grants those updater commands solely to
the bundled main window; server sign-in windows receive no updater grants.
The plugin's automatic restart is disabled in favor of the guarded native
`desktop_update_restart` command.

Local coverage: `pnpm exec vitest run src/desktopUpdater.test.ts
src/updateSafety.test.ts src/desktop/boot.test.ts src/liveConnections.test.ts`
and `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml`.
These cover the controller, native adapter, draft persistence, work locks,
permissions and process cleanup. They do not replace a real installed-app
upgrade rehearsal against published assets. A local build does not install,
launch, or update the existing Panda app.

### Local installed-app upgrade rehearsal

Acceptance status (2026-11-21): the local signed `0.0.1 → 0.0.2` install and
native restart passed. The same profile, chat, rendered transcript and exact
multiline draft survived. Unavailable/malformed feeds, tampered archives,
wrong-key signatures, interrupted downloads, active-work guards and downgrade
refusal passed. Pre-upgrade agent children exited, the installed executable
matched the signed replacement, and its Apple signature verified. This
completes the local milestone 4 rehearsal; published-feed acceptance remains
a separate check against the first published Forgejo release.

On Apple Silicon macOS 14 or newer, run the following from the repo root
with the existing updater signing key. It launches a separate **Panda
Updater Rehearsal** window, bringing it forward for rendering checks. With a warm Cargo
cache, allow 4–6 minutes for the two builds and rehearsal:

```sh
pnpm desktop:rehearse-updater --run --key /absolute/path/to/existing/signing.key
```

1. The runner exports the current local commit into a private temporary
   directory. It builds test versions `0.0.2` and `0.0.1`, signs their
   updater archives with the existing key, and keeps a recovery copy of
   `0.0.1`. These are test builds, not tagged releases. No tags, remote forge
   requests, release assets, repository secrets or personal app files change.
2. A unique bundle identifier and WebKit data-store UUID isolate the test's
   profile, preferences, selected chat and draft. A temporary-only entry
   drives the normal mounted app, native host, updater controller and restart
   command. A deterministic local stdio ACP fixture retains the transcript.
   The runner reuses the ignored Cargo cache; it does not need an AI model.
3. An ephemeral `127.0.0.1` server supplies no-update, unavailable, malformed,
   tampered, wrong-signing-key and interrupted-download cases. Rejected
   archives must leave the installed test executable unchanged. The driver
   also checks running prompts, paused queues and draft attachments before
   allowing a successful signed install and real process restart.
4. The restarted version must reopen the same chat, render its replayed
   transcript and exact multiline draft, and refuse an older feed version.
   The runner verifies the upgraded bundle's version, executable hash and
   Apple signature, checks that pre-upgrade agent children exited, and
   verifies the retained recovery copy. It then stops only this run's test
   processes and closes its server.
5. The printed `/private/tmp/panda-updater-rehearsal-*/report.json` records
   source commit, test identity, hashes, steps and feed requests. Logs and
   artifacts remain there for review. The retained recovery bundle is
   verified but is not automatically reinstalled or launched. Forgejo's
   published feed and the personal app installation still need a later
   acceptance pass against an actual published Forgejo release.

Failures also write `report.json` with `passed: false`, the failing gate and
completed events. Later steps must not be inferred from a partial run.

The loopback HTTP exception, native WebKit setup workaround and driver are
injected only into the exported temporary source/configuration. Ordinary
builds keep the pinned HTTPS feed, committed key, main-window grants and
normal entry point. The pinned Tauri code generator cannot currently emit
the WebKit UUID config field correctly, so only the rehearsal copy sets it
through the native window builder instead.

Background throttling is disabled in the test window so WKWebView continues
running the acceptance driver while another app is in front. The app is
opened through macOS LaunchServices, matching its normal launch/restart path.

If launching from an automation session leaves the view hidden, add
`--manual-launch`. The runner prints **FEED READY** after preparing the apps
and starting the local feed. Open the printed app path from your Terminal
and keep the window visible; the runner waits up to ten minutes. The rendered
transcript and draft checks remain required. No production window settings
change to accommodate the test host.

An existing original `0.0.1` test installation can resume without rebuilding
or reading the private release key:

```sh
pnpm desktop:rehearse-updater --resume /private/tmp/panda-updater-rehearsal-XXXXXX --manual-launch
```

Resume validates the private run directory, isolated bundle identity, key and
loopback endpoint, and verifies the cached archive with the independent
verifier. It preserves the WebKit UUID and previous evidence, stops only
processes whose command belongs to that run directory, and starts the same
feed port before the manual launch. The original trusted signature is never
overwritten when preparing the wrong-key test. A completed `0.0.2` installation
requires a fresh run for another upgrade rehearsal.

`pnpm exec vitest run scripts/updater-rehearsal.test.mjs` covers isolation
and evidence checks without building or launching any app. The real
rehearsal is explicitly opt-in and is not part of CI or `pnpm test`.

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
