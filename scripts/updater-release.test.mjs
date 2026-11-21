import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveName, configureUpdater, installerName, makeManifest, publicationPlan, publicKeyText, validateUpdate, verifySignature } from './updater-release.mjs';

const plan = { tag: 'panda-v1.2.3', version: '1.2.3', commit: 'a'.repeat(40) };
const publicKey = fileURLToPath(new URL('../desktop/updater.pub', import.meta.url));
const paths = [];
const temp = () => { const path = mkdtempSync(join(tmpdir(), 'panda-updater-test-')); paths.push(path); return path; };
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value));
const hash = (value) => createHash('sha256').update(value).digest('hex');
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('signed update preparation', () => {
  it('keeps source identity while adding update signing and the public trust key', () => {
    const output = temp();
    writeJson(join(output, 'release-plan.json'), plan);
    writeJson(join(output, 'tauri.release.json'), { version: plan.version, bundle: { macOS: { infoPlist: '/original.plist' } } });
    configureUpdater(output, publicKey);
    const config = JSON.parse(readFileSync(join(output, 'tauri.release.json'), 'utf8'));
    expect(config.bundle).toMatchObject({ createUpdaterArtifacts: true, macOS: { infoPlist: '/original.plist', signingIdentity: '-' } });
    expect(config.plugins.updater.pubkey).toBe(publicKeyText(publicKey));
    expect(config.plugins.updater.endpoints).toEqual(['https://git.davidhoeppner.ca/la-creche/Panda/releases/download/latest/latest.json']);
  });

  it('refuses a config with a different version', () => {
    const output = temp();
    writeJson(join(output, 'release-plan.json'), plan);
    writeJson(join(output, 'tauri.release.json'), { version: '0.2.0' });
    expect(() => configureUpdater(output, publicKey)).toThrow('does not match');
  });

  it('rejects private key material or malformed files in the public-key slot', () => {
    const key = join(temp(), 'key');
    for (const value of ['invalid', Buffer.from('untrusted comment: minisign encrypted secret key\nsecret').toString('base64')]) {
      writeFileSync(key, value);
      expect(() => publicKeyText(key)).toThrow('public-key file');
    }
  });

  it('uses a versioned HTTPS archive URL and signature contents for Apple Silicon only', () => {
    const manifest = makeManifest(plan, 'signature-contents');
    expect(manifest).toMatchObject({ version: '1.2.3', platforms: { 'darwin-aarch64': {
      url: 'https://git.davidhoeppner.ca/la-creche/Panda/releases/download/panda-v1.2.3/Panda_1.2.3_aarch64.app.tar.gz',
      signature: 'signature-contents',
    } } });
    expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64']);
    expect(publicationPlan(plan, '/assets').assets).toHaveLength(5);
  });
});

const verifier = process.env.PANDA_UPDATER_VERIFY_BIN ?? fileURLToPath(new URL('../desktop/updater-verify/target/debug/panda-updater-verify', import.meta.url));
describe.skipIf(!existsSync(verifier))('real Tauri signing and independent verification', () => {
  const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
  function signer(args) {
    const result = spawnSync(process.execPath, [cli, 'signer', ...args], { encoding: 'utf8', stdio: 'pipe' });
    // Never include output in assertion errors; generation can print secret material.
    if (result.status !== 0) throw new Error('Tauri test signer failed (output withheld).');
  }
  function signedFixture() {
    const directory = temp();
    const key = join(directory, 'private.key');
    signer(['generate', '--ci', '--password', '', '--write-keys', key]);
    const archive = join(directory, archiveName(plan));
    writeFileSync(archive, 'signed fixture content');
    signer(['sign', '--private-key-path', key, '--password', '', archive]);
    return { directory, key, archive, signature: `${archive}.sig` };
  }

  it('accepts a genuine Tauri signature and rejects modified bytes', () => {
    const h = signedFixture();
    expect(() => verifySignature(verifier, `${h.key}.pub`, h.signature, h.archive)).not.toThrow();
    appendFileSync(h.archive, 'changed');
    expect(() => verifySignature(verifier, `${h.key}.pub`, h.signature, h.archive)).toThrow('verification failed');
  });

  it('rejects a valid signature presented with another public key', () => {
    const h = signedFixture();
    const other = join(h.directory, 'other.key');
    signer(['generate', '--ci', '--password', '', '--write-keys', other]);
    expect(() => verifySignature(verifier, `${other}.pub`, h.signature, h.archive)).toThrow('verification failed');
  });

  it('validates the complete receipt and rejects feed tampering', () => {
    const h = signedFixture();
    const name = archiveName(plan);
    writeFileSync(join(h.directory, installerName(plan)), 'installer fixture');
    const signature = readFileSync(h.signature, 'utf8').trim();
    writeJson(join(h.directory, 'latest.json'), makeManifest(plan, signature));
    const files = Object.fromEntries([name, `${name}.sig`, installerName(plan), 'latest.json'].map((file) => [file, hash(readFileSync(join(h.directory, file)))]));
    const receipt = { ...plan, platform: 'darwin-aarch64', publicKeySha256: hash(publicKeyText(`${h.key}.pub`)), files };
    writeJson(join(h.directory, 'updater-release.json'), receipt);
    expect(validateUpdate(h.directory, plan, `${h.key}.pub`, verifier)).toHaveLength(5);
    const feed = makeManifest(plan, signature);
    feed.platforms['darwin-aarch64'].url = 'https://example.com/other';
    writeJson(join(h.directory, 'latest.json'), feed);
    // Even a re-hashed manifest cannot switch to an unreviewed download URL.
    receipt.files['latest.json'] = hash(readFileSync(join(h.directory, 'latest.json')));
    writeJson(join(h.directory, 'updater-release.json'), receipt);
    expect(() => validateUpdate(h.directory, plan, `${h.key}.pub`, verifier)).toThrow('unexpected version, URL');
  });
});
