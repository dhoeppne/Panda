import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseVersion } from './desktop-release.mjs';
import { REPOSITORY, validateUpdate } from './updater-release.mjs';

function runGh(args) { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

function apiJson(endpoint, run) {
  try { return JSON.parse(run(['api', endpoint])); }
  catch (error) {
    if (String(error.stderr ?? '').includes('HTTP 404')) return null;
    throw new Error('Could not read GitHub release metadata. Publication stopped.');
  }
}

function newerThan(tag, previous) {
  const current = releaseVersion(tag).split('.').map(Number);
  const prior = releaseVersion(previous).split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (current[index] !== prior[index]) return current[index] > prior[index];
  }
  return false;
}

/** Opt-in only. Keep the draft hidden until downloaded assets pass verification again. */
export function publishUpdate({ plan, directory, publicKey, verifier, allowPublish = false,
  run = runGh, verify = validateUpdate }) {
  if (!allowPublish) throw new Error('Publishing is disabled. Use the explicit publish workflow input after the repo freeze ends.');
  const assets = verify(directory, plan, publicKey, verifier);
  const checksums = new Map(assets.map((file) => [file,
    createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')]));
  const resolved = apiJson(`repos/${REPOSITORY}/commits/${plan.tag}`, run);
  if (resolved?.sha !== plan.commit) throw new Error('Remote release tag does not match the verified source.');
  const latest = apiJson(`repos/${REPOSITORY}/releases/latest`, run);
  if (latest && !newerThan(plan.tag, latest.tag_name)) {
    throw new Error('Publishing would replace the stable feed with the same or an older version.');
  }
  const existing = apiJson(`repos/${REPOSITORY}/releases/tags/${plan.tag}`, run);
  if (existing && !existing.draft) throw new Error('This release is already published; its assets will not be overwritten.');
  if (!existing) {
    run(['release', 'create', plan.tag, '--repo', REPOSITORY, '--target', plan.commit,
      '--draft', '--title', `Panda desktop ${plan.version}`, '--notes', `Panda desktop ${plan.version}`]);
  }
  const present = (existing?.assets ?? []).map((asset) => asset.name);
  if (present.some((file) => !assets.includes(file))) throw new Error('Existing draft contains unexpected assets.');
  if (present.length) {
    const previous = mkdtempSync(join(tmpdir(), 'panda-update-existing-'));
    try {
      run(['release', 'download', plan.tag, '--repo', REPOSITORY, '--dir', previous,
        ...present.flatMap((file) => ['--pattern', file])]);
      for (const file of present) {
        if (createHash('sha256').update(readFileSync(join(previous, file))).digest('hex') !== checksums.get(file)) {
          throw new Error('Existing draft assets differ from this build; refusing to overwrite them.');
        }
      }
    } finally { rmSync(previous, { recursive: true, force: true }); }
  }
  const missing = assets.filter((file) => !present.includes(file));
  if (missing.length) run(['release', 'upload', plan.tag, '--repo', REPOSITORY, ...missing.map((file) => join(directory, file))]);
  const downloaded = mkdtempSync(join(tmpdir(), 'panda-update-download-'));
  try {
    run(['release', 'download', plan.tag, '--repo', REPOSITORY, '--dir', downloaded,
      ...assets.flatMap((file) => ['--pattern', file])]);
    for (const file of assets) {
      if (createHash('sha256').update(readFileSync(join(downloaded, file))).digest('hex') !== checksums.get(file)) {
        throw new Error('Downloaded release assets differ from the verified upload; draft retained.');
      }
    }
    verify(downloaded, plan, publicKey, verifier);
    // Re-read immediately before promotion. The workflow serializes all stable publishers.
    const finalTag = apiJson(`repos/${REPOSITORY}/commits/${plan.tag}`, run);
    if (finalTag?.sha !== plan.commit) throw new Error('Release tag changed during publication; draft retained.');
    run(['release', 'edit', plan.tag, '--repo', REPOSITORY, '--draft=false', '--latest']);
  } finally {
    rmSync(downloaded, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [output, verifier] = process.argv.slice(2);
    if (!output || !verifier) throw new Error('Usage: publish-updater.mjs <plan-dir> <verifier>');
    const allowPublish = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === REPOSITORY &&
      process.env.PANDA_PUBLISH_RELEASE === 'true';
    const plan = JSON.parse(readFileSync(join(output, 'release-plan.json'), 'utf8'));
    publishUpdate({ plan, directory: join(output, 'signed'), publicKey: join(output, 'updater.pub'), verifier, allowPublish });
    console.log('Signed desktop update published');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
