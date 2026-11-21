import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createForgejoReleaseApi } from './forgejo-release-api.mjs';
import { publishUpdate } from './publish-updater.mjs';
import { FEED_URL } from './updater-release.mjs';

const temporary = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
const plan = { tag: 'panda-v1.2.3', version: '1.2.3', commit: 'a'.repeat(40) };
function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'panda-publish-test-')); temporary.push(directory);
  const files = ['update.tar.gz', 'update.tar.gz.sig', 'Panda.dmg', 'latest.json', 'updater-release.json'];
  for (const file of files) writeFileSync(join(directory, file), `verified ${file}`);
  let assets = (options.present ?? []).map((name, index) => ({ id: index + 1, name }));
  let published = false; let tagReads = 0; let latestReads = 0;
  const calls = [];
  const api = {
    json: vi.fn(async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.includes('/git/refs/')) {
        tagReads++;
        return [{ ref: options.branchInsteadOfTag ? `refs/heads/${plan.tag}` : `refs/tags/${plan.tag}`,
          object: { type: options.annotated ? 'tag' : 'commit', sha: options.annotated ? 'c'.repeat(40) : options.changedTag && tagReads > 1 ? 'b'.repeat(40) : plan.commit } }];
      }
      if (path.includes('/git/tags/')) return { object: { type: 'commit', sha: plan.commit } };
      if (path.endsWith('/releases/latest')) {
        latestReads++;
        if (options.apiFailure) throw new Error('API unavailable');
        if (published) return { id: options.wrongStable ? 99 : 1, tag_name: plan.tag };
        const previous = options.racingLatest && latestReads > 1 ? plan.tag : options.latest;
        return previous ? { id: 9, tag_name: previous } : null;
      }
      if (path.includes('/releases/tags/')) return options.existing ? { id: 1, tag_name: plan.tag, draft: !options.alreadyPublished } : null;
      if (path.endsWith('/assets')) return assets;
      if (method === 'PATCH') published = body.draft === false;
      return { id: 1, tag_name: plan.tag, draft: !published };
    }),
    upload: vi.fn(async (_id, path) => { assets.push({ id: assets.length + 1, name: basename(path) }); }),
    download: vi.fn(async (asset, destination) => {
      copyFileSync(join(directory, asset.browser_download_url === FEED_URL ? 'latest.json' : asset.name), destination);
      if (options.corruptDownload || options.badStableFeed && asset.browser_download_url === FEED_URL) writeFileSync(destination, 'changed');
    }),
  };
  const verify = vi.fn(() => files);
  const publish = () => publishUpdate({ plan, directory, publicKey: 'unused', verifier: 'unused', api, verify, allowPublish: true });
  return { api, verify, files, calls, publish };
}

describe('Forgejo draft publication', () => {
  it('makes no API calls without explicit publication opt-in', async () => {
    const api = { json: vi.fn() };
    await expect(publishUpdate({ api })).rejects.toThrow('Publishing is disabled');
    expect(api.json).not.toHaveBeenCalled();
  });
  it('uploads, redownloads, verifies and promotes before checking the stable feed', async () => {
    const h = fixture({ annotated: true });
    await expect(h.publish()).resolves.toBe(1);
    expect(h.verify).toHaveBeenCalledTimes(2);
    expect(h.api.upload).toHaveBeenCalledTimes(5);
    expect(h.api.download).toHaveBeenCalledTimes(6);
    expect(h.calls.filter((call) => call.method === 'PATCH')).toEqual([expect.objectContaining({ body: { draft: false, prerelease: false } })]);
  });
  it('reuses byte-identical draft assets without overwriting them', async () => {
    const h = fixture({ existing: true, present: ['update.tar.gz', 'latest.json'] });
    await h.publish();
    expect(h.api.upload).toHaveBeenCalledTimes(3);
    expect(h.calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('does not mistake a same-named branch for the release tag', async () => {
    const h = fixture({ branchInsteadOfTag: true });
    await expect(h.publish()).rejects.toThrow('tag is missing or ambiguous');
    expect(h.api.upload).not.toHaveBeenCalled();
  });
  it.each(['panda-v1.2.3', 'panda-v1.2.4', 'panda-v2.0.0'])('refuses rollback or replacement of %s', async (latest) => {
    const h = fixture({ latest });
    await expect(h.publish()).rejects.toThrow('same or an older');
    expect(h.api.upload).not.toHaveBeenCalled();
  });
  it('never overwrites an already published release', async () => {
    const h = fixture({ existing: true, alreadyPublished: true });
    await expect(h.publish()).rejects.toThrow('already published');
    expect(h.api.upload).not.toHaveBeenCalled();
  });
  it('refuses conflicting, duplicate and unexpected draft assets', async () => {
    for (const options of [{ present: ['update.tar.gz'], corruptDownload: true }, { present: ['unexpected'] }, { present: ['latest.json', 'latest.json'] }]) {
      const h = fixture({ existing: true, ...options });
      await expect(h.publish()).rejects.toThrow();
      expect(h.api.upload).not.toHaveBeenCalled();
      expect(h.calls.some((call) => call.method === 'PATCH')).toBe(false);
    }
  });
  it.each([{ corruptDownload: true }, { changedTag: true }, { racingLatest: true }, { apiFailure: true }])(
    'keeps the draft hidden when verification or a remote recheck fails: %j', async (options) => {
      const h = fixture(options);
      await expect(h.publish()).rejects.toThrow();
      expect(h.calls.some((call) => call.method === 'PATCH')).toBe(false);
    },
  );
  it.each([{ wrongStable: true }, { badStableFeed: true }])('hides its new release if the public stable feed is incorrect: %j', async (options) => {
    const h = fixture(options);
    await expect(h.publish()).rejects.toThrow();
    expect(h.calls.filter((call) => call.method === 'PATCH').map((call) => call.body.draft)).toEqual([false, true]);
  });
});

describe('Forgejo credential boundary', () => {
  it('sends the token in a header to the explicit API host, never in a URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const api = createForgejoReleaseApi({ token: 'synthetic-test-token', apiBase: 'http://10.0.0.17:3500/api/v1', fetchImpl });
    await api.json('GET', '/repos/la-creche/Panda/releases/latest');
    expect(fetchImpl.mock.calls[0][0]).toBe('http://10.0.0.17:3500/api/v1/repos/la-creche/Panda/releases/latest');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('token synthetic-test-token');
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
    expect(() => createForgejoReleaseApi({ token: 'synthetic-test-token', apiBase: 'https://elsewhere.example/api/v1' })).toThrow('Unsupported');
  });
  it('refuses a cross-origin asset redirect before forwarding credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/archive' } }));
    const api = createForgejoReleaseApi({ token: 'synthetic-test-token', fetchImpl });
    await expect(api.download({ browser_download_url: 'https://git.davidhoeppner.ca/attachments/test' }, '/unused')).rejects.toThrow('outside');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
