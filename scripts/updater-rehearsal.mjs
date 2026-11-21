import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const APP = 'Panda Updater Rehearsal.app';
const REQUIRED = ['reload-recovered', 'offline-contained', 'malformed-contained', 'no-update', 'tampered-rejected',
  'wrong-key-rejected', 'interrupted-rejected', 'work-guards-passed', 'before-upgrade', 'recovered', 'downgrade-refused', 'passed'];
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
function lines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** HTTP is permitted only in a generated, distinctly identified rehearsal app. */
export function rehearsalConfig({ endpoint, storeId }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/latest.json' ||
      url.username || url.password || url.search || url.hash) throw new Error('Rehearsal requires an explicit loopback feed.');
  if (!Array.isArray(storeId) || storeId.length !== 16 || storeId.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('Rehearsal requires a unique WebKit data-store identifier.');
  }
  return { productName: 'Panda Updater Rehearsal', identifier: `com.lukaisluka.panda.rehearsal.r${Buffer.from(storeId).toString('hex')}`,
    app: { windows: [{ label: 'main', title: 'Panda updater rehearsal', visible: true, focus: true, backgroundThrottling: 'disabled',
      width: 1280, height: 800, create: false }] },
    bundle: { targets: ['app'], createUpdaterArtifacts: true, macOS: { signingIdentity: '-' } },
    plugins: { updater: { endpoints: [endpoint], dangerousInsecureTransportProtocol: true } } };
}

export function isolateWebKit(main, storeId) {
  // The pinned tauri-utils code generator emits Vec<u8> for this [u8; 16]
  // config field. Set it on the runtime builder in the temporary source only.
  const marker = '.build(tauri::generate_context!())';
  if (main.split(marker).length !== 2) throw new Error('Cannot locate the single native app builder.');
  return main.replace(marker, `.setup(|app| {
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .data_store_identifier(${JSON.stringify(storeId)}).build()?;
            Ok(())
        })\n        ${marker}`);
}

export function rehearsalFeed(mode, base, signature, wrongSignature) {
  if (mode === 'current') return { status: 204 };
  if (mode === 'offline') return { status: 503, body: 'Rehearsal feed unavailable' };
  if (mode === 'malformed') return { status: 200, body: '{invalid-json' };
  if (!['good', 'older', 'tampered', 'wrong-key', 'interrupted'].includes(mode)) throw new Error('Unknown rehearsal feed mode.');
  return { status: 200, body: JSON.stringify({ version: mode === 'older' ? '0.0.0' : '0.0.2',
    notes: 'Local signed updater acceptance rehearsal', platforms: { 'darwin-aarch64': {
      url: `${base}/${mode}.tar.gz`, signature: mode === 'wrong-key' ? wrongSignature : signature,
    } } }) };
}

export function verifyRehearsal(events, oldHash, newHash) {
  const failed = events.find((event) => event.name === 'failed');
  if (failed) throw new Error(`Webview rehearsal failed: ${failed.error}`);
  for (const name of REQUIRED) if (!events.some((event) => event.name === name)) throw new Error(`Missing acceptance step: ${name}`);
  for (const event of events.filter((item) => item.name.endsWith('-rejected') || item.name === 'before-upgrade')) {
    if (event.binarySha256 !== oldHash) throw new Error(`Failed update changed the installed executable: ${event.name}`);
  }
  const recovered = events.find((event) => event.name === 'recovered');
  if (recovered.version !== '0.0.2' || recovered.binarySha256 !== newHash || recovered.sessionId !== 'rehearsal-session') {
    throw new Error('Restarted application identity or recovered chat differs.');
  }
}

export function cachedRehearsalIdentity(config) {
  const match = /^com\.lukaisluka\.panda\.rehearsal\.r([a-f0-9]{32})$/.exec(config.identifier ?? '');
  if (!match || config.productName !== 'Panda Updater Rehearsal' || config.plugins?.updater?.endpoints?.length !== 1) {
    throw new Error('Cached app is not an isolated rehearsal.');
  }
  const storeId = [...Buffer.from(match[1], 'hex')];
  rehearsalConfig({ endpoint: config.plugins.updater.endpoints[0], storeId });
  return storeId;
}

async function stopRunProcesses(root, child) {
  const agents = lines(join(root, 'agents.jsonl'));
  const exited = new Set(agents.filter((event) => event.kind === 'exit').map((event) => event.pid));
  const pids = new Set([child?.exitCode === null && child?.signalCode === null ? child.pid : undefined,
    lines(join(root, 'events.jsonl')).at(-1)?.appPid,
    ...agents.filter((event) => event.kind === 'start' && !exited.has(event.pid)).map((event) => event.pid)]);
  const owned = [];
  for (const pid of pids) {
    if (!pid) continue;
    // A cached receipt can outlive its process. Never signal a reused PID.
    let command;
    try { command = run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command=']); }
    catch (error) { if (error.status === 1) continue; throw error; }
    if (!command.includes(`${root}/`)) continue;
    try { process.kill(pid, 'SIGTERM'); owned.push(pid); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const deadline = Date.now() + 3000;
  for (const pid of owned) {
    while (true) {
      try { process.kill(pid, 0); }
      catch (error) { if (error.code === 'ESRCH') break; throw error; }
      if (Date.now() > deadline) throw new Error('Rehearsal process did not stop; do not resume over a live test app.');
      await sleep(50);
    }
  }
}

/** Creates a temporary copy, never edits or installs the normal Panda app. */
export async function rehearse({ repo, key, resume, manualLaunch = false }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Rehearsal requires Apple Silicon macOS.');
  if (Number(run('/usr/bin/sw_vers', ['-productVersion']).split('.')[0]) < 14) throw new Error('Isolated WebKit data stores require macOS 14+.');
  repo = realpathSync(repo);
  if (!resume) key = realpathSync(key);
  const publicKey = readFileSync(join(repo, 'desktop/updater.pub'), 'utf8').trim();
  // No remote forge requests, local tag creation, key rotation, or user-app installation.
  const runnerCommit = run('git', ['rev-parse', 'HEAD'], { cwd: repo }).trim();
  if (run('git', ['diff', 'HEAD', '--', 'src', 'desktop/src-tauri', 'desktop/updater.pub', 'vite.config.ts', 'pnpm-lock.yaml'], { cwd: repo }).trim()) {
    throw new Error('Commit application changes before rehearsing a reproducible snapshot.');
  }
  const root = resume ? realpathSync(resume) : mkdtempSync('/private/tmp/panda-updater-rehearsal-');
  if (!/^\/private\/tmp\/panda-updater-rehearsal-[A-Za-z0-9]+$/.test(root)) throw new Error('Invalid cached rehearsal directory.');
  const saved = resume ? json(join(root, 'run.json')) : null;
  const savedConfig = resume ? json(join(root, 'tauri.rehearsal.json')) : null;
  const commit = saved?.commit ?? runnerCommit;
  const installed = join(root, 'installed', APP);
  const executable = join(installed, 'Contents/MacOS/panda-desktop');
  if (saved && (saved.root !== root || saved.executable !== executable || !/^[a-f0-9]{40}$/.test(commit))) {
    throw new Error('Cached rehearsal receipt does not match its directory.');
  }
  const storeId = savedConfig ? cachedRehearsalIdentity(savedConfig) : [...randomBytes(16)];
  if (savedConfig && savedConfig.plugins.updater.pubkey !== publicKey) throw new Error('Cached rehearsal trusts a different signing key.');
  writeJson(join(root, 'runner.json'), { pid: process.pid });
  console.log(`Rehearsal files: ${root}`);
  const source = join(root, 'source');
  if (!resume) {
    mkdirSync(source);
    const archive = execFileSync('git', ['archive', '--format=tar', commit], { cwd: repo, maxBuffer: 256 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', source], { input: archive });
    symlinkSync(join(repo, 'node_modules'), join(source, 'node_modules'));
    mkdirSync(join(source, 'public'), { recursive: true });
    symlinkSync(join(repo, 'public/material-icons'), join(source, 'public/material-icons'));
    for (const name of ['agent.mjs', 'bridge.mjs']) copyFileSync(join(here, 'fixtures/updater-rehearsal', name), join(root, name));
    const driver = readFileSync(join(here, 'fixtures/updater-rehearsal/driver.ts'), 'utf8')
      .replace("const root = '__REHEARSAL_ROOT__';", `const root = ${JSON.stringify(root)};`)
      .replace("const node = '__REHEARSAL_NODE__';", `const node = ${JSON.stringify(process.execPath)};`);
    writeFileSync(join(source, 'src/desktop/updater-rehearsal.ts'), driver);
    appendFileSync(join(source, 'src/main.tsx'), "\nvoid import('./desktop/updater-rehearsal');\n");
    writeJson(join(root, 'run.json'), { root, executable, commit, runnerCommit });
  }
  writeFileSync(join(root, 'mode'), 'current');
  const target = join(repo, 'desktop/src-tauri/target');
  const cli = join(repo, 'node_modules/@tauri-apps/cli/tauri.js');
  const hook = join(root, 'build-frontend.mjs');
  writeFileSync(hook, `import { spawnSync } from 'node:child_process';\nfor (const args of ${JSON.stringify([
    [join(repo, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'],
    [join(repo, 'node_modules/vite/bin/vite.js'), 'build'],
  ])}) { const result = spawnSync(process.execPath, args, { cwd: ${JSON.stringify(source)}, stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1); }\n`);
  const nativeMain = join(source, 'desktop/src-tauri/src/main.rs');
  if (!resume) writeFileSync(nativeMain, isolateWebKit(readFileSync(nativeMain, 'utf8'), storeId));
  let updateBytes; let signature; let wrongSignature;
  const requests = [];
  const server = createServer((request, response) => {
    try {
      const mode = readFileSync(join(root, 'mode'), 'utf8');
      requests.push({ path: request.url, mode, at: Date.now() });
      if (request.url === '/latest.json') {
        const result = rehearsalFeed(mode, base, signature, wrongSignature);
        response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(result.body); return;
      }
      if (!/^\/(good|tampered|wrong-key|interrupted)\.tar\.gz$/.test(request.url ?? '')) { response.writeHead(404).end(); return; }
      if (!updateBytes) { response.writeHead(503).end(); return; }
      response.writeHead(200, { 'content-length': updateBytes.length, 'content-type': 'application/gzip' });
      if (request.url === '/interrupted.tar.gz') { response.write(updateBytes.subarray(0, 128)); response.destroy(); return; }
      const bytes = Buffer.from(updateBytes);
      if (request.url === '/tampered.tar.gz') bytes[Math.floor(bytes.length / 2)] ^= 1;
      response.end(bytes);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(savedConfig ? Number(new URL(savedConfig.plugins.updater.endpoints[0]).port) : 0, '127.0.0.1', done);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = savedConfig ?? rehearsalConfig({ endpoint: `${base}/latest.json`, storeId });
  config.plugins.updater.pubkey = publicKey;
  config.build = { beforeBuildCommand: `${shellQuote(process.execPath)} ${shellQuote(hook)}` };
  const configPath = join(root, 'tauri.rehearsal.json');
  let child;
  const eventsPath = join(root, 'events.jsonl');
  const logBuild = async (version) => {
    writeJson(configPath, { ...config, version });
    const logPath = join(root, `build-${version}.log`);
    console.log(`Building isolated ${version}; log: ${logPath}`);
    const { openSync, closeSync } = await import('node:fs');
    const fd = openSync(logPath, 'w');
    try {
      const code = await new Promise((done, reject) => {
        const build = spawn(process.execPath, [cli, 'build', '--bundles', 'app', '--config', configPath], {
          cwd: join(source, 'desktop'), env: { ...process.env, CARGO_TARGET_DIR: target, CARGO_NET_OFFLINE: 'true',
            PANDA_VERSION: version, TAURI_SIGNING_PRIVATE_KEY: key,
            TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' }, stdio: ['ignore', fd, fd],
        });
        build.on('error', reject); build.on('exit', done);
      });
      if (code !== 0) throw new Error(`Isolated ${version} build failed; inspect ${logPath}`);
    } finally { closeSync(fd); }
    return join(target, 'release/bundle/macos', APP);
  };
  try {
    const goodArchive = join(root, 'update.tar.gz');
    let newHash;
    if (resume) {
      const identifier = run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(installed, 'Contents/Info.plist')]).trim();
      const version = run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(installed, 'Contents/Info.plist')]).trim();
      if (identifier !== config.identifier || version !== '0.0.1') throw new Error('Resume requires the original isolated 0.0.1 app.');
      const verifier = ['release', 'debug'].map((profile) => join(repo, `desktop/updater-verify/target/${profile}/panda-updater-verify`)).find(existsSync);
      if (!verifier) throw new Error('Build the independent updater verifier before resuming.');
      run(verifier, [join(repo, 'desktop/updater.pub'), `${goodArchive}.sig`, goodArchive]);
      newHash = sha(execFileSync('tar', ['-xOf', goodArchive, `${APP}/Contents/MacOS/panda-desktop`], { maxBuffer: 256 * 1024 * 1024 }));
      updateBytes = readFileSync(goodArchive);
      signature = readFileSync(`${goodArchive}.sig`, 'utf8').trim();
      await stopRunProcesses(root);
      const suffix = `before-resume-${Date.now()}`;
      for (const name of ['events.jsonl', 'agents.jsonl', 'report.json', 'requests.json']) {
        if (existsSync(join(root, name))) renameSync(join(root, name), join(root, `${name}.${suffix}`));
      }
      console.log('Reusing the independently verified signed archive and isolated 0.0.1 app.');
    } else {
      const newer = await logBuild('0.0.2');
      newHash = sha(readFileSync(join(newer, 'Contents/MacOS/panda-desktop')));
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', newer]);
      updateBytes = readFileSync(`${newer}.tar.gz`);
      signature = readFileSync(`${newer}.tar.gz.sig`, 'utf8').trim();
      writeFileSync(goodArchive, updateBytes);
      writeFileSync(`${goodArchive}.sig`, signature);
    }
    // Separate throwaway key proves that another valid signer is not trusted.
    const wrongKey = join(root, 'untrusted.key');
    if (!resume) run(process.execPath, [cli, 'signer', 'generate', '--ci', '--password', '', '--write-keys', wrongKey]);
    chmodSync(wrongKey, 0o600);
    const untrustedArchive = join(root, 'wrong-key.tar.gz'); copyFileSync(goodArchive, untrustedArchive);
    run(process.execPath, [cli, 'signer', 'sign', '--private-key-path', wrongKey, '--password', '', untrustedArchive]);
    wrongSignature = readFileSync(`${untrustedArchive}.sig`, 'utf8').trim();
    const backup = join(root, 'manual-recovery', APP);
    if (!resume) {
      const older = await logBuild('0.0.1');
      mkdirSync(dirname(installed)); cpSync(older, installed, { recursive: true });
      mkdirSync(dirname(backup)); cpSync(older, backup, { recursive: true });
    }
    const oldHash = sha(readFileSync(executable));
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
    if (manualLaunch) {
      console.log(`FEED READY. Open the isolated app from your own Terminal and keep it visible:\nopen -n ${shellQuote(installed)}`);
    } else {
      console.log('Launching the separate rehearsal app; running real updater and startup recovery.');
      const { openSync, closeSync } = await import('node:fs');
      const fd = openSync(join(root, 'app.log'), 'w');
      // Match an ordinary installed-app launch and Tauri's macOS restart path.
      child = spawn('/usr/bin/open', ['-n', installed], { cwd: root, stdio: ['ignore', fd, fd] }); closeSync(fd);
      child.on('error', (error) => writeJson(join(root, 'launch-error.json'), { error: error.message }));
    }
    const deadline = Date.now() + (manualLaunch ? 600_000 : 180_000);
    let seen = 0;
    while (Date.now() < deadline) {
      const events = lines(eventsPath);
      for (const event of events.slice(seen)) console.log(`  ${event.name}${event.error ? `: ${event.error}` : ''}`);
      seen = events.length;
      const failed = events.find((event) => event.name === 'failed');
      if (failed) throw new Error(`Webview rehearsal failed: ${failed.error}`);
      if (existsSync(join(root, 'launch-error.json'))) throw new Error('Could not launch isolated app.');
      if (events.some((event) => event.name === 'passed')) {
        verifyRehearsal(events, oldHash, newHash);
        run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
        const version = run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(installed, 'Contents/Info.plist')]).trim();
        if (version !== '0.0.2') throw new Error('Installed test bundle was not upgraded.');
        const before = events.find((event) => event.name === 'before-upgrade');
        const agentEvents = lines(join(root, 'agents.jsonl'));
        const preUpgradePids = agentEvents.filter((event) => event.kind === 'start' && event.at < before.at).map((event) => event.pid);
        for (const pid of preUpgradePids) {
          try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') continue; throw error; }
          throw new Error('A pre-upgrade agent child survived restart.');
        }
        if (sha(readFileSync(join(backup, 'Contents/MacOS/panda-desktop'))) !== oldHash) throw new Error('Manual recovery copy changed.');
        run('/usr/bin/codesign', ['--verify', '--deep', '--strict', backup]);
        const report = { passed: true, commit, runnerCommit, resumed: Boolean(resume), identifier: config.identifier, webkitStoreId: storeId,
          from: '0.0.1', to: version, oldHash, newHash, preUpgradeAgentPids: preUpgradePids, events, requests,
          manualRecovery: { path: backup, verified: true, exercised: false },
          limitations: ['Loopback feed; no Forgejo publication/download rehearsal.', 'Distinct test bundle and WebKit store; personal installation not exercised.'] };
        writeJson(join(root, 'report.json'), report);
        console.log(`PASS: signed install, real restart, chat/draft recovery, failure containment and child cleanup.\nReport: ${root}/report.json`);
        return report;
      }
      await sleep(250);
    }
    throw new Error(`Rehearsal timed out. Inspect ${root}/app.log and events.jsonl.`);
  } catch (error) {
    writeJson(join(root, 'report.json'), { passed: false, commit, identifier: config.identifier,
      error: error instanceof Error ? error.message : 'Rehearsal failed', events: lines(eventsPath), requests,
      limitation: 'No acceptance step after the failing gate is considered verified.' });
    throw error;
  } finally {
    writeJson(join(root, 'requests.json'), requests);
    const closed = new Promise((done) => server.close(done));
    server.closeAllConnections(); await closed;
    await stopRunProcesses(root, child);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const manualLaunch = args.at(-1) === '--manual-launch';
  if (manualLaunch) args.pop();
  const fresh = args.length === 3 && args[0] === '--run' && args[1] === '--key';
  const cached = args.length === 2 && args[0] === '--resume';
  if (!fresh && !cached) {
    console.error('Usage: updater-rehearsal.mjs --run --key <private-key-file> | --resume <run-directory> [--manual-launch]'); process.exitCode = 1;
  } else {
    try {
      if (cached && !realpathSync(args[1]).startsWith('/private/tmp/panda-updater-rehearsal-')) throw new Error('Resume requires a private rehearsal directory.');
      await rehearse({ repo: resolve(here, '..'), key: fresh ? args[2] : undefined, resume: cached ? realpathSync(args[1]) : undefined, manualLaunch });
    }
    catch (error) { console.error(error instanceof Error ? error.message : 'Rehearsal failed.'); process.exitCode = 1; }
  }
}
