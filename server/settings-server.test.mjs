import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsServer } from './settings-server.mjs';

let dir;
let dbPath;
let running;
let base;

async function start() {
  running = createSettingsServer({ dbPath });
  const address = await running.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${address.port}`;
}

async function stop() {
  if (running) await running.close();
  running = undefined;
}

function put(key, body) {
  return fetch(`${base}/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function expectError(response, status) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body = await response.json();
  expect(typeof body.error).toBe('string');
  return body;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'panda-settings-'));
  dbPath = join(dir, 'settings.sqlite');
  await start();
});

afterEach(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('settings server', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${base}/api/settings/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await response.text()).toBe('ok\n');
  });

  it('starts empty at rev 0', async () => {
    const response = await fetch(`${base}/api/settings`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('etag')).toBe('"0"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ user: 'default', rev: 0, entries: {} });
  });

  it('stores a write and reads it back with per-user revs', async () => {
    const first = await put('panda.theme', { value: 'chocolate', baseRev: 0 });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ rev: 1 });
    const second = await put('panda.nav', { value: { pins: [1, 2] }, baseRev: 0 });
    expect(await second.json()).toEqual({ rev: 2 });
    const third = await put('panda.theme', { value: 'matcha', baseRev: 1 });
    expect(await third.json()).toEqual({ rev: 3 });

    const response = await fetch(`${base}/api/settings`);
    expect(response.headers.get('etag')).toBe('"3"');
    expect(await response.json()).toEqual({
      user: 'default',
      rev: 3,
      entries: {
        'panda.nav': { value: { pins: [1, 2] }, rev: 2 },
        'panda.theme': { value: 'matcha', rev: 3 },
      },
    });
  });

  it('answers 304 when If-None-Match equals the ETag', async () => {
    await put('panda.theme', { value: 'chocolate', baseRev: 0 });
    const fresh = await fetch(`${base}/api/settings`, { headers: { 'If-None-Match': '"1"' } });
    expect(fresh.status).toBe(304);
    expect(fresh.headers.get('etag')).toBe('"1"');
    expect(await fresh.text()).toBe('');

    const stale = await fetch(`${base}/api/settings`, { headers: { 'If-None-Match': '"0"' } });
    expect(stale.status).toBe(200);
  });

  it('answers 409 with the stored value when baseRev is stale', async () => {
    await put('panda.theme', { value: 'chocolate', baseRev: 0 });
    await put('panda.theme', { value: 'matcha', baseRev: 1 });
    const conflict = await put('panda.theme', { value: 'stone', baseRev: 1 });
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await conflict.json()).toEqual({ rev: 2, value: 'matcha' });

    const unknownKey = await put('panda.locale', { value: 'zh', baseRev: 4 });
    expect(unknownKey.status).toBe(409);
    expect(await unknownKey.json()).toEqual({ rev: 0, value: null });
  });

  it('keeps a removed key as a tombstone with its own rev', async () => {
    await put('panda.theme', { value: 'chocolate', baseRev: 0 });
    const removed = await put('panda.theme', { value: null, baseRev: 1 });
    expect(await removed.json()).toEqual({ rev: 2 });
    const body = await (await fetch(`${base}/api/settings`)).json();
    expect(body).toEqual({ user: 'default', rev: 2, entries: { 'panda.theme': { value: null, rev: 2 } } });

    const restored = await put('panda.theme', { value: 'matcha', baseRev: 2 });
    expect(await restored.json()).toEqual({ rev: 3 });
  });

  it('refuses a key outside the allowed pattern', async () => {
    await expectError(await put('bad%20key', { value: 1, baseRev: 0 }), 400);
    await expectError(await put('a'.repeat(129), { value: 1, baseRev: 0 }), 400);
    expect((await put('a'.repeat(128), { value: 1, baseRev: 0 })).status).toBe(200);
  });

  it('refuses a body larger than 1 MiB', async () => {
    const value = 'x'.repeat(1024 * 1024);
    await expectError(await put('panda.nav', { value, baseRev: 0 }), 413);
    const body = await (await fetch(`${base}/api/settings`)).json();
    expect(body.entries).toEqual({});
  });

  it('refuses a 65th key per user and still updates existing keys', async () => {
    for (let i = 0; i < 64; i += 1) {
      expect((await put(`key${i}`, { value: i, baseRev: 0 })).status).toBe(200);
    }
    await expectError(await put('key64', { value: 64, baseRev: 0 }), 400);
    expect((await put('key0', { value: 'again', baseRev: 1 })).status).toBe(200);
  });

  it('refuses malformed JSON and wrong shapes', async () => {
    await expectError(await put('panda.theme', '{not json'), 400);
    await expectError(await put('panda.theme', '[]'), 400);
    await expectError(await put('panda.theme', { baseRev: 0 }), 400);
    await expectError(await put('panda.theme', { value: 1 }), 400);
    await expectError(await put('panda.theme', { value: 1, baseRev: -1 }), 400);
    await expectError(await put('panda.theme', { value: 1, baseRev: 1.5 }), 400);
    await expectError(await put('panda.theme', { value: 1, baseRev: '0' }), 400);
  });

  it('answers 404 for an unknown path', async () => {
    await expectError(await fetch(`${base}/api/other`), 404);
    await expectError(await fetch(`${base}/`), 404);
    await expectError(await fetch(`${base}/api/settings/a/b`, { method: 'PUT', body: '{}' }), 404);
  });

  it('answers 405 for a wrong method', async () => {
    const post = await fetch(`${base}/api/settings`, { method: 'POST', body: '{}' });
    await expectError(post, 405);
    expect(post.headers.get('allow')).toBe('GET');
    await expectError(await fetch(`${base}/api/settings/panda.theme`), 405);
    await expectError(await fetch(`${base}/api/settings/healthz`, { method: 'PUT', body: '{}' }), 405);
  });

  it('keeps the data across a close and a reopen of the same file', async () => {
    await put('panda.theme', { value: 'matcha', baseRev: 0 });
    await put('panda.theme', { value: null, baseRev: 1 });
    await put('panda.locale', { value: 'zh', baseRev: 0 });
    await stop();
    await start();
    const body = await (await fetch(`${base}/api/settings`)).json();
    expect(body).toEqual({
      user: 'default',
      rev: 3,
      entries: {
        'panda.locale': { value: 'zh', rev: 3 },
        'panda.theme': { value: null, rev: 2 },
      },
    });
    expect(await (await put('panda.nav', { value: '{}', baseRev: 0 })).json()).toEqual({ rev: 4 });
  });
});
