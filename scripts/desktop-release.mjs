import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IDENTIFIER = 'com.lukaisluka.panda';
const TAG_PATTERN = /^panda-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function releaseVersion(tag) {
  const match = typeof tag === 'string' && TAG_PATTERN.exec(tag);
  if (!match || match[0] !== tag || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error('Choose an existing panda-vX.Y.Z release tag (stable versions only).');
  }
  return match.slice(1).join('.');
}

function git(repo, ...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Resolve the full tag ref, never a similarly named branch or arbitrary revision. */
export function resolveRelease(tag, repo = process.cwd()) {
  const version = releaseVersion(tag);
  let commit;
  try { commit = git(repo, 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`); }
  catch { throw new Error(`Release tag does not exist locally: ${tag}`); }
  return { tag, version, commit };
}

/** Run before and after the build. A dirty/different checkout cannot be labelled a release. */
export function assertReleaseSource(plan, repo = process.cwd()) {
  const expected = resolveRelease(plan.tag, repo);
  if (plan.version !== expected.version || plan.commit !== expected.commit) {
    throw new Error('Release plan no longer matches the selected tag.');
  }
  if (git(repo, 'rev-parse', 'HEAD') !== plan.commit) {
    throw new Error(`Checkout must be exactly ${plan.tag} (${plan.commit}).`);
  }
  if (git(repo, 'status', '--porcelain', '--untracked-files=all')) {
    throw new Error('Release source must be clean, including untracked source files.');
  }
  const config = JSON.parse(readFileSync(join(repo, 'desktop/src-tauri/tauri.conf.json'), 'utf8'));
  if (config.identifier !== IDENTIFIER || config.productName !== 'Panda') {
    throw new Error('Release must retain Panda’s application name and bundle identifier.');
  }
}

/** The helper travels with the plan so older selected tags need no release tooling. */
export function writeReleasePlan(plan, output) {
  mkdirSync(output, { recursive: true });
  const write = (name, value) => writeFileSync(join(output, name), value, { flag: 'wx' });
  write('release-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  write('PandaRelease.plist', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PandaReleaseTag</key><string>${plan.tag}</string>
<key>PandaSourceCommit</key><string>${plan.commit}</string>
</dict></plist>\n`);
  write('tauri.release.json', `${JSON.stringify({
    version: plan.version,
    bundle: { macOS: { infoPlist: join(resolve(output), 'PandaRelease.plist') } },
  }, null, 2)}\n`);
  write('release-tool.mjs', readFileSync(fileURLToPath(import.meta.url)));
}

export function verifyMacMetadata(plan, metadata, executable) {
  if (metadata.CFBundleShortVersionString !== plan.version || metadata.CFBundleVersion !== plan.version) {
    throw new Error('Built macOS app version does not match the release tag.');
  }
  if (metadata.CFBundleIdentifier !== IDENTIFIER || metadata.CFBundleExecutable !== 'panda-desktop') {
    throw new Error('Built macOS app identity does not match Panda.');
  }
  if (metadata.PandaReleaseTag !== plan.tag || metadata.PandaSourceCommit !== plan.commit) {
    throw new Error('Built macOS app provenance does not match the release plan.');
  }
  // Require a thin ARM64 Mach-O; the first updater target is Apple Silicon.
  if (executable.length < 8 || executable.readUInt32LE(0) !== 0xfeedfacf || executable.readUInt32LE(4) !== 0x0100000c) {
    throw new Error('Built macOS executable must be an Apple Silicon ARM64 binary.');
  }
}

export function verifyFrontend(plan, repo) {
  const assets = join(repo, 'dist/assets');
  const quotedVersion = new RegExp("([\"'`])" + plan.version.replaceAll('.', '\\.') + '\\1');
  const containsVersion = readdirSync(assets).filter((name) => name.endsWith('.js'))
    .some((name) => quotedVersion.test(readFileSync(join(assets, name), 'utf8')));
  if (!containsVersion) throw new Error('Built frontend is missing the release version. Set PANDA_VERSION for the build.');
}

function writeProvenance(plan, output, platform, executable) {
  writeFileSync(join(output, 'release.json'), `${JSON.stringify({
    ...plan, platform, binarySha256: createHash('sha256').update(executable).digest('hex'),
  }, null, 2)}\n`);
}

function main() {
  const [command, first, second] = process.argv.slice(2);
  if (!['plan', 'check', 'verify-macos', 'verify-windows'].includes(command) || !first || (command === 'plan' && !second)) {
    throw new Error('Usage: desktop-release.mjs plan <panda-vX.Y.Z> <output-dir> | check|verify-macos|verify-windows <plan-dir>');
  }
  if (command === 'plan' && first && second) {
    const plan = resolveRelease(first);
    writeReleasePlan(plan, second);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `commit=${plan.commit}\nversion=${plan.version}\n`);
    }
    console.log(JSON.stringify(plan));
    return;
  }
  if (!first || !['check', 'verify-macos', 'verify-windows'].includes(command)) {
    throw new Error('Usage: desktop-release.mjs plan <panda-vX.Y.Z> <output-dir> | check/verify-macos/verify-windows <output-dir>');
  }
  const plan = JSON.parse(readFileSync(join(first, 'release-plan.json'), 'utf8'));
  const repo = process.cwd();
  assertReleaseSource(plan, repo);
  if (command === 'check') return;
  verifyFrontend(plan, repo);
  const release = join(repo, 'desktop/src-tauri/target/release');
  if (command === 'verify-macos') {
    const app = join(release, 'bundle/macos/Panda.app/Contents');
    const metadata = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')], { encoding: 'utf8' }));
    const executable = readFileSync(join(app, 'MacOS/panda-desktop'));
    verifyMacMetadata(plan, metadata, executable);
    writeProvenance(plan, first, 'darwin-aarch64', executable);
  } else {
    const executablePath = join(release, 'panda-desktop.exe');
    // Fixed path expression: no release inputs enter PowerShell source.
    const version = execFileSync('pwsh', ['-NoProfile', '-Command',
      "(Get-Item -LiteralPath 'desktop/src-tauri/target/release/panda-desktop.exe').VersionInfo.ProductVersion"], { encoding: 'utf8' }).trim();
    if (version !== plan.version) throw new Error('Built Windows executable version does not match the release tag.');
    writeProvenance(plan, first, 'windows-x86_64', readFileSync(executablePath));
  }
  console.log(`Verified ${plan.tag} at ${plan.commit}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
