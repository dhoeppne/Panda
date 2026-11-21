import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseSource, releaseVersion, verifyMacMetadata } from './desktop-release.mjs';

export const REPOSITORY = 'la-creche/Panda';
const FEED_URL = `https://github.com/${REPOSITORY}/releases/latest/download/latest.json`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function validatePlan(plan) {
  if (releaseVersion(plan.tag) !== plan.version || !/^[a-f0-9]{40}$/.test(plan.commit)) {
    throw new Error('Invalid updater release plan.');
  }
}

export function publicKeyText(path) {
  const value = readFileSync(path, 'utf8').trim();
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  if (Buffer.from(decoded).toString('base64') !== value || !decoded.startsWith('untrusted comment: minisign public key:') ||
      !/^RW[A-Za-z0-9+/]+=*$/m.test(decoded)) throw new Error('Expected a Tauri public-key file.');
  return value;
}

export function configureUpdater(output, publicKeyPath) {
  const plan = readJson(join(output, 'release-plan.json'));
  validatePlan(plan);
  const configPath = join(output, 'tauri.release.json');
  const config = readJson(configPath);
  if (config.version !== plan.version) throw new Error('Updater config does not match the release plan.');
  const pubkey = publicKeyText(publicKeyPath);
  config.bundle = { ...config.bundle, createUpdaterArtifacts: true,
    macOS: { ...config.bundle?.macOS, signingIdentity: '-' } };
  config.plugins = { ...config.plugins, updater: { pubkey, endpoints: [FEED_URL] } };
  writeJson(configPath, config);
  writeFileSync(join(output, 'updater.pub'), `${pubkey}\n`);
}

export function archiveName(plan) { validatePlan(plan); return `Panda_${plan.version}_aarch64.app.tar.gz`; }
export function installerName(plan) { validatePlan(plan); return `Panda_${plan.version}_aarch64.dmg`; }

function signatureText(path) {
  const value = readFileSync(path, 'utf8').trim();
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  if (Buffer.from(decoded).toString('base64') !== value || !decoded.startsWith('untrusted comment:') ||
      !decoded.includes('\ntrusted comment:')) throw new Error('Expected a complete Tauri signature file.');
  return value;
}

export function makeManifest(plan, signature) {
  validatePlan(plan);
  return {
    version: plan.version, notes: `Panda desktop ${plan.version}`,
    platforms: { 'darwin-aarch64': {
      url: `https://github.com/${REPOSITORY}/releases/download/${plan.tag}/${archiveName(plan)}`,
      signature,
    } },
  };
}

export function verifySignature(verifier, key, signature, archive) {
  const result = spawnSync(verifier, [key, signature, archive], { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) throw new Error('Update archive signature verification failed.');
}

/** Read only the two identity-bearing files; never unpack archive paths onto the host. */
export function verifyArchiveContents(archive, plan, proof) {
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  const member = (suffix) => {
    const found = entries.filter((name) => name.replace(/^\.\//, '') === `Panda.app/Contents/${suffix}`);
    if (found.length !== 1) throw new Error('Updater archive contains ambiguous or missing application metadata.');
    return found[0];
  };
  const plist = execFileSync('tar', ['-xOf', archive, member('Info.plist')], { maxBuffer: 1024 * 1024 });
  const metadata = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8' }));
  const executable = execFileSync('tar', ['-xOf', archive, member('MacOS/panda-desktop')], { maxBuffer: 256 * 1024 * 1024 });
  verifyMacMetadata(plan, metadata, executable);
  if (hash(executable) !== proof.binarySha256) throw new Error('Updater archive differs from the verified native app.');
}

export function assembleUpdate(output, repo, verifier) {
  const plan = readJson(join(output, 'release-plan.json'));
  assertReleaseSource(plan, repo);
  const proof = readJson(join(output, 'release.json'));
  if (proof.tag !== plan.tag || proof.commit !== plan.commit || proof.version !== plan.version || proof.platform !== 'darwin-aarch64') {
    throw new Error('Verified app provenance does not match the updater release.');
  }
  const archive = join(repo, 'desktop/src-tauri/target/release/bundle/macos/Panda.app.tar.gz');
  const signature = `${archive}.sig`;
  const key = join(output, 'updater.pub');
  verifySignature(verifier, key, signature, archive);
  verifyArchiveContents(archive, plan, proof);
  const directory = join(output, 'signed');
  mkdirSync(directory, { recursive: true });
  const name = archiveName(plan);
  copyFileSync(archive, join(directory, name));
  copyFileSync(signature, join(directory, `${name}.sig`));
  copyFileSync(join(repo, 'desktop/src-tauri/target/release/bundle/dmg', installerName(plan)), join(directory, installerName(plan)));
  writeJson(join(directory, 'latest.json'), makeManifest(plan, signatureText(signature)));
  const files = Object.fromEntries([name, `${name}.sig`, installerName(plan), 'latest.json'].map((file) => [file, hash(readFileSync(join(directory, file)))]));
  writeJson(join(directory, 'updater-release.json'), { ...proof, publicKeySha256: hash(publicKeyText(key)), files });
  validateUpdate(directory, plan, key, verifier);
  return directory;
}

/** Used again on downloaded assets before a draft can become the live feed. */
export function validateUpdate(directory, plan, publicKeyPath, verifier) {
  validatePlan(plan);
  const receipt = readJson(join(directory, 'updater-release.json'));
  if (receipt.tag !== plan.tag || receipt.commit !== plan.commit || receipt.version !== plan.version ||
      receipt.platform !== 'darwin-aarch64' || receipt.publicKeySha256 !== hash(publicKeyText(publicKeyPath))) {
    throw new Error('Update receipt does not match the selected source and public key.');
  }
  const name = archiveName(plan);
  const expected = [name, `${name}.sig`, installerName(plan), 'latest.json'];
  if (JSON.stringify(Object.keys(receipt.files ?? {}).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error('Update receipt has an unexpected asset list.');
  }
  for (const file of expected) {
    if (hash(readFileSync(join(directory, file))) !== receipt.files[file]) throw new Error(`Update asset checksum mismatch: ${file}`);
  }
  const signature = signatureText(join(directory, `${name}.sig`));
  if (JSON.stringify(readJson(join(directory, 'latest.json'))) !== JSON.stringify(makeManifest(plan, signature))) {
    throw new Error('Update feed has an unexpected version, URL, signature or platform.');
  }
  verifySignature(verifier, publicKeyPath, join(directory, `${name}.sig`), join(directory, name));
  return [...expected, 'updater-release.json'];
}

export function publicationPlan(plan, directory) {
  validatePlan(plan);
  return { repository: REPOSITORY, tag: plan.tag, commit: plan.commit, draft: true,
    assets: [archiveName(plan), `${archiveName(plan)}.sig`, installerName(plan), 'latest.json', 'updater-release.json'].map((name) => join(directory, name)) };
}

export function assertTamperRejected(output, verifier) {
  const plan = readJson(join(output, 'release-plan.json'));
  const directory = join(output, 'signed');
  const key = join(output, 'updater.pub');
  validateUpdate(directory, plan, key, verifier);
  const temp = mkdtempSync(join(tmpdir(), 'panda-update-tamper-'));
  try {
    const changed = join(temp, 'changed.tar.gz');
    copyFileSync(join(directory, archiveName(plan)), changed);
    appendFileSync(changed, 'tampered');
    let rejected = false;
    try { verifySignature(verifier, key, join(directory, `${archiveName(plan)}.sig`), changed); }
    catch { rejected = true; }
    if (!rejected) throw new Error('Verifier accepted a modified archive.');
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, output, argument] = process.argv.slice(2);
    if (command === 'configure' && output && argument) configureUpdater(output, argument);
    else if (command === 'assemble' && output && argument) console.log(assembleUpdate(output, process.cwd(), argument));
    else if (command === 'validate' && output && argument) {
      const plan = readJson(join(output, 'release-plan.json'));
      validateUpdate(join(output, 'signed'), plan, join(output, 'updater.pub'), argument);
      console.log('Signed update assets verified');
    } else if (command === 'check-tamper' && output && argument) {
      assertTamperRejected(output, argument);
      console.log('Verified archive accepted; modified archive rejected');
    } else if (command === 'publication-plan' && output) {
      console.log(JSON.stringify(publicationPlan(readJson(join(output, 'release-plan.json')), join(output, 'signed')), null, 2));
    } else throw new Error('Usage: updater-release.mjs configure <plan-dir> <public-key> | assemble|validate <plan-dir> <verifier> | publication-plan <plan-dir>');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
