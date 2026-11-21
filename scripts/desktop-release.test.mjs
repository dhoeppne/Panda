import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertReleaseSource, releaseVersion, resolveRelease, verifyFrontend, verifyMacMetadata, writeReleasePlan,
} from './desktop-release.mjs';

const temporary = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function temp() {
  const path = mkdtempSync(join(tmpdir(), 'panda-desktop-release-test-'));
  temporary.push(path);
  return path;
}
function fixture() {
  const repo = temp();
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Panda Test', '-c', 'user.email=panda@example.invalid', ...args], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '-q');
  mkdirSync(join(repo, 'desktop/src-tauri'), { recursive: true });
  writeFileSync(join(repo, 'desktop/src-tauri/tauri.conf.json'), JSON.stringify({
    productName: 'Panda', identifier: 'com.lukaisluka.panda', version: '0.2.0',
  }));
  writeFileSync(join(repo, '.gitignore'), 'dist/\nnode_modules/\n');
  writeFileSync(join(repo, 'source.txt'), 'original source');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  git('tag', '-a', 'panda-v0.2.21', '-m', 'release');
  return { repo, git, plan: resolveRelease('panda-v0.2.21', repo) };
}

describe('desktop release source', () => {
  it.each(['v1.2.3', 'panda-v1.2', 'panda-v01.2.3', 'panda-v1.2.3-beta.1', '../main', 'panda-v1.2.3\n', 'panda-v9007199254740992.0.0'])(
    'rejects ambiguous or unsupported release inputs: %j', (tag) => expect(() => releaseVersion(tag)).toThrow(),
  );

  it('resolves an annotated tag to its commit and permits a clean source checkout', () => {
    const { repo, git, plan } = fixture();
    expect(plan).toEqual({ tag: 'panda-v0.2.21', version: '0.2.21', commit: git('rev-parse', 'HEAD') });
    expect(() => assertReleaseSource(plan, repo)).not.toThrow();
  });

  it('does not resolve a same-named branch as a missing tag', () => {
    const { repo, git } = fixture();
    git('branch', 'panda-v0.2.22');
    expect(() => resolveRelease('panda-v0.2.22', repo)).toThrow('does not exist locally');
  });

  it('rejects another checkout, modified source, and untracked source', () => {
    const { repo, git, plan } = fixture();
    writeFileSync(join(repo, 'source.txt'), 'modified');
    expect(() => assertReleaseSource(plan, repo)).toThrow('must be clean');
    git('add', '.');
    expect(() => assertReleaseSource(plan, repo)).toThrow('must be clean');
    git('commit', '-qm', 'next commit');
    expect(() => assertReleaseSource(plan, repo)).toThrow('Checkout must be exactly');
    git('checkout', '-q', plan.commit);
    writeFileSync(join(repo, 'untracked.js'), 'unexpected build input');
    expect(() => assertReleaseSource(plan, repo)).toThrow('must be clean');
  });

  it('rejects a moved tag and a tampered plan version', () => {
    const { repo, git, plan } = fixture();
    expect(() => assertReleaseSource({ ...plan, version: '9.9.9' }, repo)).toThrow('no longer matches');
    writeFileSync(join(repo, 'source.txt'), 'new source');
    git('add', '.');
    git('commit', '-qm', 'new commit');
    git('tag', '-f', 'panda-v0.2.21');
    expect(() => assertReleaseSource(plan, repo)).toThrow('no longer matches');
  });

  it('writes a standalone helper, version overlay and embedded provenance outside source', () => {
    const { repo, plan } = fixture();
    const output = temp();
    writeReleasePlan(plan, output);
    const config = JSON.parse(readFileSync(join(output, 'tauri.release.json'), 'utf8'));
    expect(config.version).toBe('0.2.21');
    expect(readFileSync(config.bundle.macOS.infoPlist, 'utf8')).toContain(plan.commit);
    execFileSync(process.execPath, [join(output, 'release-tool.mjs'), 'check', output], { cwd: repo });
    expect(() => writeReleasePlan(plan, output)).toThrow();
    expect(JSON.parse(readFileSync(join(repo, 'desktop/src-tauri/tauri.conf.json'), 'utf8')).version).toBe('0.2.0');
  });

  it('passes the exact resolved commit and version to the workflow through CLI outputs', () => {
    const { repo, plan } = fixture();
    const output = temp();
    const githubOutput = join(temp(), 'outputs');
    const script = fileURLToPath(new URL('./desktop-release.mjs', import.meta.url));
    execFileSync(process.execPath, [script, 'plan', plan.tag, output], {
      cwd: repo, env: { ...process.env, GITHUB_OUTPUT: githubOutput },
    });
    expect(readFileSync(githubOutput, 'utf8')).toBe(`commit=${plan.commit}\nversion=${plan.version}\n`);
    expect(JSON.parse(readFileSync(join(output, 'release-plan.json'), 'utf8'))).toEqual(plan);
  });

  it('requires the frontend to contain the selected release version', () => {
    const { repo, plan } = fixture();
    mkdirSync(join(repo, 'dist/assets'), { recursive: true });
    writeFileSync(join(repo, 'dist/assets/index.js'), 'const version="0.2.0";');
    expect(() => verifyFrontend(plan, repo)).toThrow('Set PANDA_VERSION');
    for (const quote of ['"', "'", '`']) {
      writeFileSync(join(repo, 'dist/assets/index.js'), `const version=${quote}0.2.21${quote};`);
      expect(() => verifyFrontend(plan, repo)).not.toThrow();
    }
  });
});

describe('built Mac artifact verification', () => {
  function artifact() {
    const plan = { tag: 'panda-v1.2.3', version: '1.2.3', commit: 'a'.repeat(40) };
    const metadata = {
      CFBundleShortVersionString: '1.2.3', CFBundleVersion: '1.2.3',
      CFBundleIdentifier: 'com.lukaisluka.panda', CFBundleExecutable: 'panda-desktop',
      PandaReleaseTag: plan.tag, PandaSourceCommit: plan.commit,
    };
    const executable = Buffer.alloc(8);
    executable.writeUInt32LE(0xfeedfacf, 0);
    executable.writeUInt32LE(0x0100000c, 4);
    return { plan, metadata, executable };
  }

  it('accepts only the intended version, source and Apple Silicon executable', () => {
    const { plan, metadata, executable } = artifact();
    expect(() => verifyMacMetadata(plan, metadata, executable)).not.toThrow();
    expect(() => verifyMacMetadata(plan, metadata, Buffer.alloc(0))).toThrow('ARM64');
    executable.writeUInt32LE(0x01000007, 4); // x86_64
    expect(() => verifyMacMetadata(plan, metadata, executable)).toThrow('ARM64');
  });

  it.each([
    ['CFBundleShortVersionString', '0.2.0'], ['CFBundleVersion', '0.2.0'],
    ['PandaSourceCommit', 'b'.repeat(40)], ['PandaReleaseTag', 'panda-v1.2.2'],
    ['CFBundleIdentifier', 'another.app'],
  ])('rejects stale or incorrect %s', (key, value) => {
    const { plan, metadata, executable } = artifact();
    expect(() => verifyMacMetadata(plan, { ...metadata, [key]: value }, executable)).toThrow();
  });

  it('fails the CLI clearly when no operation was supplied', () => {
    const script = fileURLToPath(new URL('./desktop-release.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [script], { stdio: 'pipe' })).toThrow();
  });
});
