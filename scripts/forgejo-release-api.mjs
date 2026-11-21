import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { FORGEJO_ORIGIN, REPOSITORY } from './updater-release.mjs';

export const RELEASE_API = `/repos/${REPOSITORY}`;
const PUBLIC_API = `${FORGEJO_ORIGIN}/api/v1`;
const INTERNAL_API = 'http://10.0.0.17:3500/api/v1';

/** Credentials stay in headers and never follow a redirect to another origin. */
export function createForgejoReleaseApi({ token, apiBase = PUBLIC_API, fetchImpl = fetch } = {}) {
  if (![PUBLIC_API, INTERNAL_API].includes(apiBase)) throw new Error('Unsupported Forgejo API origin.');
  if (!token || /[\r\n]/.test(token)) throw new Error('Set FORGEJO_TOKEN for this publication command.');
  const headers = { Authorization: `token ${token}` };
  const perform = async (url, options) => {
    try { return await fetchImpl(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(60_000) }); }
    catch { throw new Error('Forgejo request failed; publication stopped.'); }
  };
  const json = async (method, path, body) => {
    if (!path.startsWith(`${RELEASE_API}/`) || path.includes('..')) throw new Error('Invalid release API path.');
    const response = await perform(apiBase + path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw new Error(`Forgejo API request failed (HTTP ${response.status}); publication stopped.`);
    return response.status === 204 ? null : response.json();
  };
  return {
    json,
    async upload(id, path) {
      const form = new FormData();
      form.append('attachment', new Blob([readFileSync(path)]), basename(path));
      const response = await perform(`${apiBase}${RELEASE_API}/releases/${id}/assets`, { method: 'POST', headers, body: form });
      if (!response.ok) throw new Error(`Forgejo asset upload failed (HTTP ${response.status}); draft retained.`);
      return response.json();
    },
    async download(asset, destination) {
      let url = new URL(asset.browser_download_url);
      for (let redirects = 0; redirects < 5; redirects++) {
        if (url.origin !== FORGEJO_ORIGIN || url.username || url.password) throw new Error('Refusing a release download outside the configured forge.');
        const response = await perform(url.href, { headers });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) throw new Error('Release download redirect is missing its destination.');
          url = new URL(location, url); continue;
        }
        if (!response.ok) throw new Error(`Release download failed (HTTP ${response.status}); draft retained.`);
        writeFileSync(destination, new Uint8Array(await response.arrayBuffer())); return;
      }
      throw new Error('Too many release download redirects; draft retained.');
    },
  };
}
