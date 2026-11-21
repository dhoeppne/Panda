import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveName, configureUpdater, installerName, makeManifest, publicationPlan, publicKeyText, validateUpdate, verifySignature } from './updater-release.mjs';
import { publishUpdate } from './publish-updater.mjs';

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
    expect(config.plugins.updater.endpoints).toEqual(['https://github.com/la-creche/Panda/releases/latest/download/latest.json']);
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
      url: 'https://github.com/la-creche/Panda/releases/download/panda-v1.2.3/Panda_1.2.3_aarch64.app.tar.gz',
      signature: 'signature-contents',
    } } });
    expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64']);
    expect(publicationPlan(plan, '/assets').assets).toHaveLength(5);
  });
});

function publicationFixture(options = {}) {
  const directory = temp();
  const assets = [archiveName(plan), `${archiveName(plan)}.sig`, installerName(plan), 'latest.json', 'updater-release.json'];
  for (const asset of assets) writeFileSync(join(directory, asset), `verified-${asset}`);
  const calls = [];
  let commitReads = 0;
  const missing = () => { const error = new Error('missing'); error.stderr = 'HTTP 404'; throw error; };
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'api') {
      if (args[1].includes('/commits/')) {
        commitReads++;
        return JSON.stringify({ sha: options.changedTag && commitReads > 1 ? 'b'.repeat(40) : plan.commit });
      }
      if (args[1].endsWith('/releases/latest')) {
        if (options.apiFailure) throw new Error('API unavailable');
        return options.latest ? JSON.stringify({ tag_name: options.latest }) : missing();
      }
      return options.existing ? JSON.stringify(options.existing) : missing();
    }
    if (args[1] === 'download') {
      const destination = args[args.indexOf('--dir') + 1];
      for (const asset of assets) copyFileSync(join(directory, asset), join(destination, asset));
      if (options.corruptDownload) appendFileSync(join(destination, assets[0]), 'changed');
    }
    return '';
  };
  const verify = vi.fn(() => assets);
  const publish = () => publishUpdate({ plan, directory, publicKey, verifier: 'unused', allowPublish: true, run, verify });
  return { publish, calls, verify };
}

describe('draft publication safeguards (no network)', () => {
  it('makes no API calls unless publishing was explicitly enabled', () => {
    const run = vi.fn();
    const verify = vi.fn();
    expect(() => publishUpdate({ run, verify })).toThrow('Publishing is disabled');
    expect(run).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('creates and promotes a draft only after re-verifying the downloaded assets', () => {
    const h = publicationFixture();
    h.publish();
    expect(h.verify).toHaveBeenCalledTimes(2);
    const operations = h.calls.filter((args) => args[0] === 'release').map((args) => args[1]);
    expect(operations).toEqual(['create', 'upload', 'download', 'edit']);
    expect(h.calls.at(-1)).toContain('--draft=false');
  });

  it('resumes an existing draft without recreating it', () => {
    const h = publicationFixture({ existing: { draft: true } });
    h.publish();
    expect(h.calls.some((args) => args[1] === 'create')).toBe(false);
    expect(h.calls.at(-1)).toContain('--latest');
  });

  it('reuses matching draft assets without overwriting or uploading them again', () => {
    const names = [archiveName(plan), `${archiveName(plan)}.sig`, installerName(plan), 'latest.json', 'updater-release.json'];
    const h = publicationFixture({ existing: { draft: true, assets: names.map((name) => ({ name })) } });
    h.publish();
    expect(h.calls.some((args) => args[1] === 'upload')).toBe(false);
    expect(h.calls.some((args) => args.includes('--clobber'))).toBe(false);
  });

  it('refuses to replace conflicting assets from a previous draft attempt', () => {
    const h = publicationFixture({ existing: { draft: true, assets: [{ name: archiveName(plan) }] }, corruptDownload: true });
    expect(h.publish).toThrow('refusing to overwrite');
    expect(h.calls.some((args) => args[1] === 'upload' || args[1] === 'edit')).toBe(false);
  });

  it.each(['panda-v1.2.3', 'panda-v1.2.4', 'panda-v2.0.0'])(
    'refuses to replace a stable release at %s with 1.2.3', (latest) => {
      const h = publicationFixture({ latest });
      expect(h.publish).toThrow('same or an older');
      expect(h.calls.some((args) => args[0] === 'release')).toBe(false);
    },
  );

  it('never overwrites a published release', () => {
    const h = publicationFixture({ existing: { draft: false } });
    expect(h.publish).toThrow('already published');
    expect(h.calls.some((args) => args[0] === 'release')).toBe(false);
  });

  it('keeps the draft hidden if downloaded bytes differ', () => {
    const h = publicationFixture({ corruptDownload: true });
    expect(h.publish).toThrow('differ from the verified upload');
    expect(h.calls.some((args) => args[1] === 'edit')).toBe(false);
  });

  it('keeps the draft hidden if the tag moves during publication', () => {
    const h = publicationFixture({ changedTag: true });
    expect(h.publish).toThrow('tag changed');
    expect(h.calls.some((args) => args[1] === 'edit')).toBe(false);
  });

  it('stops on API errors instead of assuming no release exists', () => {
    const h = publicationFixture({ apiFailure: true });
    expect(h.publish).toThrow('Could not read');
    expect(h.calls.some((args) => args[0] === 'release')).toBe(false);
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
