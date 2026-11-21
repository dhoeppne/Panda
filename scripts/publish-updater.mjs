import { createHash } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseVersion } from './desktop-release.mjs';
import { FEED_URL, validateUpdate } from './updater-release.mjs';
import { createForgejoReleaseApi, RELEASE_API } from './forgejo-release-api.mjs';

const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function newerThan(tag, previous) {
  const current = releaseVersion(tag).split('.').map(Number);
  const prior = releaseVersion(previous).split('.').map(Number);
  for (let index = 0; index < 3; index++) if (current[index] !== prior[index]) return current[index] > prior[index];
  return false;
}

async function tagCommit(api, tag) {
  const name = `refs/tags/${tag}`;
  const refs = await api.json('GET', `${RELEASE_API}/git/refs/tags/${encodeURIComponent(tag)}`);
  const exact = Array.isArray(refs) ? refs.filter((ref) => ref.ref === name) : [];
  if (exact.length !== 1) throw new Error('Remote release tag is missing or ambiguous.');
  let object = exact[0].object;
  for (let depth = 0; depth < 5; depth++) {
    if (!/^[a-f0-9]{40}$/.test(object?.sha ?? '')) break;
    if (object.type === 'commit') return object.sha;
    if (object.type !== 'tag') break;
    object = (await api.json('GET', `${RELEASE_API}/git/tags/${object.sha}`))?.object;
  }
  throw new Error('Remote tag could not be resolved to its exact commit.');
}
async function assertNewer(api, tag) {
  const latest = await api.json('GET', `${RELEASE_API}/releases/latest`);
  if (latest && !newerThan(tag, latest.tag_name)) throw new Error('Publishing would replace the stable feed with the same or an older version.');
}
function assetSet(assets, expected, complete = false) {
  if (!Array.isArray(assets) || new Set(assets.map((asset) => asset.name)).size !== assets.length ||
      assets.some((asset) => !expected.includes(asset.name)) || complete && assets.length !== expected.length) {
    throw new Error('Draft has missing, duplicate or unexpected assets.');
  }
  return assets;
}

/** Local opt-in publisher: verify the exact bytes again before exposing a draft. */
export async function publishUpdate({ plan, directory, publicKey, verifier, allowPublish = false,
  api, verify = validateUpdate }) {
  if (!allowPublish) throw new Error('Publishing is disabled. Set PANDA_PUBLISH_RELEASE=true explicitly.');
  const files = verify(directory, plan, publicKey, verifier);
  const checksums = new Map(files.map((file) => [file, hash(join(directory, file))]));
  api ??= createForgejoReleaseApi({ token: process.env.FORGEJO_TOKEN, apiBase: process.env.PANDA_FORGEJO_API_URL });
  if (await tagCommit(api, plan.tag) !== plan.commit) throw new Error('Remote release tag does not match the verified source.');
  await assertNewer(api, plan.tag);
  let draft = await api.json('GET', `${RELEASE_API}/releases/tags/${encodeURIComponent(plan.tag)}`);
  if (draft && !draft.draft) throw new Error('This release is already published; its assets will not be overwritten.');
  draft ??= await api.json('POST', `${RELEASE_API}/releases`, { tag_name: plan.tag, target_commitish: plan.commit,
    draft: true, prerelease: false, name: `Panda desktop ${plan.version}`, body: `Panda desktop ${plan.version}` });
  if (!Number.isSafeInteger(draft?.id) || draft.id <= 0 || draft.tag_name !== plan.tag || !draft.draft) throw new Error('Forgejo did not return the expected draft release.');
  const directoryForCheck = mkdtempSync(join(tmpdir(), 'panda-update-download-'));
  try {
    const present = assetSet(await api.json('GET', `${RELEASE_API}/releases/${draft.id}/assets`), files);
    for (const asset of present) {
      const destination = join(directoryForCheck, asset.name);
      await api.download(asset, destination);
      if (hash(destination) !== checksums.get(asset.name)) throw new Error('Existing draft assets differ from this build; refusing to overwrite them.');
    }
    for (const file of files.filter((file) => !present.some((asset) => asset.name === file))) await api.upload(draft.id, join(directory, file));
    const uploaded = assetSet(await api.json('GET', `${RELEASE_API}/releases/${draft.id}/assets`), files, true);
    for (const asset of uploaded) {
      const destination = join(directoryForCheck, asset.name);
      await api.download(asset, destination);
      if (hash(destination) !== checksums.get(asset.name)) throw new Error('Downloaded release assets differ from the verified upload; draft retained.');
    }
    verify(directoryForCheck, plan, publicKey, verifier);
    if (await tagCommit(api, plan.tag) !== plan.commit) throw new Error('Release tag changed during publication; draft retained.');
    await assertNewer(api, plan.tag);
    await api.json('PATCH', `${RELEASE_API}/releases/${draft.id}`, { draft: false, prerelease: false });
    // Check Forgejo's own stable selection and the exact public feed route.
    try {
      const latest = await api.json('GET', `${RELEASE_API}/releases/latest`);
      if (latest?.id !== draft.id) throw new Error('The new release did not become Forgejo’s stable release.');
      const stable = join(directoryForCheck, 'stable-feed.json');
      await api.download({ browser_download_url: FEED_URL }, stable);
      if (hash(stable) !== checksums.get('latest.json')) throw new Error('The stable feed differs from the verified manifest.');
    } catch (error) {
      try { await api.json('PATCH', `${RELEASE_API}/releases/${draft.id}`, { draft: true }); }
      catch { throw new Error('Stable-feed verification failed and the release could not be hidden; inspect the Forgejo release.'); }
      throw error;
    }
    return draft.id;
  } finally { rmSync(directoryForCheck, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lock = join(tmpdir(), 'panda-desktop-stable-publish.lock');
  let descriptor;
  try {
    const [output, verifier] = process.argv.slice(2);
    if (!output || !verifier) throw new Error('Usage: publish-updater.mjs <plan-dir> <verifier>');
    if (process.env.PANDA_PUBLISH_RELEASE !== 'true') throw new Error('Publishing is disabled. Set PANDA_PUBLISH_RELEASE=true explicitly.');
    try { descriptor = openSync(lock, 'wx', 0o600); }
    catch { throw new Error(`Another local publisher holds ${lock}; publication stopped.`); }
    await publishUpdate({ plan: JSON.parse(readFileSync(join(output, 'release-plan.json'), 'utf8')),
      directory: join(output, 'signed'), publicKey: join(output, 'updater.pub'), verifier, allowPublish: true });
    console.log('Signed desktop update published and stable Forgejo feed verified');
  } catch (error) { console.error(error instanceof Error ? error.message : 'Publication failed.'); process.exitCode = 1; }
  finally { if (descriptor !== undefined) { closeSync(descriptor); rmSync(lock); } }
}
