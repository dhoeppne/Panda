import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOT_WAIT_MS,
  PUSH_DEBOUNCE_MS,
  createSettingsSync,
  type KeyValueStorage,
  type SettingsSync,
  type SyncTimers,
} from './settingsSync';

/** In-memory localStorage fake — tests run in node, where localStorage is absent. */
class MemoryStorage implements KeyValueStorage {
  map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Timers driven by advance(): no global fake timers needed. */
class ManualTimers implements SyncTimers {
  now = 0;
  private next = 1;
  private pending = new Map<number, { at: number; callback: () => void }>();
  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  setInterval(): unknown {
    return 0; // the 60 s pull trigger is not under test here
  }
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = until;
  }
}

type Entry = { value: unknown; rev: number };

/** The settings server's protocol in memory, behind an injected fetch. */
class FakeServer {
  entries = new Map<string, Entry>();
  puts: { key: string; value: unknown; baseRev: number }[] = [];
  /** 'json' answers like the real server; 'html' like the Vite or nginx fallback. */
  mode: 'json' | 'html' | 'offline' = 'json';

  get rev(): number {
    return Math.max(0, ...[...this.entries.values()].map((e) => e.rev));
  }

  seed(key: string, value: unknown, rev: number): void {
    this.entries.set(key, { value, rev });
  }

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    if (this.mode === 'offline') throw new TypeError('Failed to fetch');
    if (this.mode === 'html') {
      return new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
      });
    if (input === '/api/settings' && (init.method ?? 'GET') === 'GET') {
      const etag = `"${this.rev}"`;
      const ifNoneMatch = new Headers(init.headers).get('if-none-match');
      if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
      return json(200, { user: 'default', rev: this.rev, entries: Object.fromEntries(this.entries) }, { ETag: etag });
    }
    const key = decodeURIComponent(input.slice('/api/settings/'.length));
    const { value, baseRev } = JSON.parse(String(init.body)) as { value: unknown; baseRev: number };
    this.puts.push({ key, value, baseRev });
    const stored = this.entries.get(key);
    if ((stored?.rev ?? 0) !== baseRev) return json(409, { rev: stored?.rev ?? 0, value: stored?.value ?? null });
    const rev = this.rev + 1;
    this.entries.set(key, { value, rev });
    return json(200, { rev });
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function setup() {
  const server = new FakeServer();
  const storage = new MemoryStorage();
  const timers = new ManualTimers();
  const fetchSpy = vi.fn(server.fetch);
  const sync: SettingsSync = createSettingsSync({
    fetch: fetchSpy,
    storage: () => storage,
    timers,
    events: () => undefined,
  });
  return { server, storage, timers, sync, fetchSpy };
}

const revs = (storage: MemoryStorage) => JSON.parse(storage.getItem('panda.sync.revs') ?? '{}') as Record<string, number>;
const changed = (storage: MemoryStorage) => JSON.parse(storage.getItem('panda.sync.changed') ?? '[]') as string[];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settingsSync pull', () => {
  it('rule 1: a server rev that differs from baseRev wins over the local value', async () => {
    const { server, storage, sync } = setup();
    storage.setItem('panda.theme', 'stone');
    storage.setItem('panda.sync.changed', JSON.stringify(['panda.theme']));
    server.seed('panda.theme', 'matcha', 3);
    const refreshed = vi.fn();
    sync.onRemoteChange('panda.theme', refreshed);

    await sync.pull();

    expect(storage.getItem('panda.theme')).toBe('matcha');
    expect(revs(storage)['panda.theme']).toBe(3);
    expect(changed(storage)).toEqual([]);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(sync.status()).toEqual({ state: 'on', user: 'default' });
    expect(server.puts).toEqual([]);
  });

  it('keeps a copy of the local value when the first sync replaces it', async () => {
    const { server, storage, sync } = setup();
    storage.setItem('panda.nav', 'phone-layout');
    storage.setItem('panda.theme', 'matcha');
    server.seed('panda.nav', 'desktop-layout', 3);
    server.seed('panda.theme', 'matcha', 4);

    await sync.pull();
    await flush();

    expect(storage.getItem('panda.nav')).toBe('desktop-layout');
    expect(storage.getItem('panda.sync.backup:panda.nav')).toBe('phone-layout');
    // An equal value needs no copy.
    expect(storage.getItem('panda.sync.backup:panda.theme')).toBeNull();

    // A later server change replaces a value this browser already synced: no new copy.
    server.seed('panda.nav', 'desktop-layout-2', 5);
    await sync.pull();
    await flush();
    expect(storage.getItem('panda.nav')).toBe('desktop-layout-2');
    expect(storage.getItem('panda.sync.backup:panda.nav')).toBe('phone-layout');
    expect(server.puts).toEqual([]);
  });

  it('gives each request a time limit', async () => {
    const { storage, sync, fetchSpy, timers } = setup();
    await sync.pull();
    storage.setItem('unrelated', 'x');
    sync.storage.setItem('panda.theme', 'matcha');
    timers.advance(PUSH_DEBOUNCE_MS);
    await flush();

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [, init] of fetchSpy.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rule 2: a local value the server lacks seeds the server', async () => {
    const { server, storage, sync } = setup();
    storage.setItem('panda.profiles', '[{"id":"a"}]');

    await sync.pull();
    await flush();

    expect(server.puts).toEqual([{ key: 'panda.profiles', value: '[{"id":"a"}]', baseRev: 0 }]);
    expect(server.entries.get('panda.profiles')).toEqual({ value: '[{"id":"a"}]', rev: 1 });
    expect(revs(storage)['panda.profiles']).toBe(1);
    expect(changed(storage)).toEqual([]);
  });

  it('rule 3: a local change on an unchanged server key is pushed', async () => {
    const { server, storage, sync } = setup();
    server.seed('panda.locale', 'en', 2);
    storage.setItem('panda.locale', 'zh');
    storage.setItem('panda.sync.revs', JSON.stringify({ 'panda.locale': 2 }));
    storage.setItem('panda.sync.changed', JSON.stringify(['panda.locale']));

    await sync.pull();
    await flush();

    expect(server.puts).toEqual([{ key: 'panda.locale', value: 'zh', baseRev: 2 }]);
    expect(revs(storage)['panda.locale']).toBe(3);
    expect(changed(storage)).toEqual([]);
  });

  it('a tombstone removes the local key', async () => {
    const { server, storage, sync } = setup();
    storage.setItem('panda.nav', '{"sections":[]}');
    storage.setItem('panda.sync.revs', JSON.stringify({ 'panda.nav': 1 }));
    server.seed('panda.nav', null, 4);
    const refreshed = vi.fn();
    sync.onRemoteChange('panda.nav', refreshed);

    await sync.pull();

    expect(storage.getItem('panda.nav')).toBeNull();
    expect(revs(storage)['panda.nav']).toBe(4);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('a local removal reaches the server as a tombstone', async () => {
    const { server, timers, sync } = setup();
    server.seed('panda.theme', 'matcha', 1);
    await sync.pull();
    sync.storage.removeItem('panda.theme');
    timers.advance(PUSH_DEBOUNCE_MS);
    await flush();
    expect(server.puts).toEqual([{ key: 'panda.theme', value: null, baseRev: 1 }]);
    expect(server.entries.get('panda.theme')).toEqual({ value: null, rev: 2 });
  });

  it('an HTML answer with status 200 leaves sync off and storage untouched', async () => {
    const { server, storage, timers, sync, fetchSpy } = setup();
    server.mode = 'html';
    storage.setItem('panda.theme', 'stone');

    await sync.pull();
    sync.storage.setItem('panda.theme', 'matcha');
    timers.advance(PUSH_DEBOUNCE_MS * 10);
    await flush();

    expect(sync.status()).toEqual({ state: 'off' });
    expect(storage.getItem('panda.theme')).toBe('matcha');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET');
  });

  it('an unreachable server leaves sync off', async () => {
    const { server, sync } = setup();
    server.mode = 'offline';
    await sync.pull();
    expect(sync.status()).toEqual({ state: 'off' });
  });

  it('sends the ETag once sync is on and pushes changed keys on a 304', async () => {
    const { server, storage, timers, sync, fetchSpy } = setup();
    server.seed('panda.theme', 'matcha', 1);
    await sync.pull();
    expect(storage.getItem('panda.sync.etag')).toBe('"1"');
    // A change whose debounced push has not run yet.
    sync.storage.setItem('panda.theme', 'stone');

    await sync.pull();
    await flush();

    const second = fetchSpy.mock.calls[1]?.[1];
    expect(new Headers(second?.headers).get('if-none-match')).toBe('"1"');
    expect(server.puts).toEqual([{ key: 'panda.theme', value: 'stone', baseRev: 1 }]);
    // The pull's push replaced the pending debounced one.
    timers.advance(PUSH_DEBOUNCE_MS);
    await flush();
    expect(server.puts).toHaveLength(1);
  });
});

describe('settingsSync push', () => {
  it('debounces writes to one PUT per key with the last value', async () => {
    const { server, timers, sync } = setup();
    await sync.pull();
    sync.storage.setItem('panda.fontSize.ui', '15');
    timers.advance(PUSH_DEBOUNCE_MS - 100);
    sync.storage.setItem('panda.fontSize.ui', '16');
    timers.advance(PUSH_DEBOUNCE_MS - 100);
    sync.storage.setItem('panda.fontSize.ui', '17');
    await flush();
    expect(server.puts).toEqual([]);

    timers.advance(PUSH_DEBOUNCE_MS);
    await flush();
    expect(server.puts).toEqual([{ key: 'panda.fontSize.ui', value: '17', baseRev: 0 }]);
  });

  it('takes the server value on a 409 and warns once', async () => {
    const { server, storage, timers, sync } = setup();
    server.seed('panda.theme', 'matcha', 2);
    await sync.pull();
    server.seed('panda.theme', 'butter', 5); // another device wrote meanwhile
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refreshed = vi.fn();
    sync.onRemoteChange('panda.theme', refreshed);

    sync.storage.setItem('panda.theme', 'stone');
    timers.advance(PUSH_DEBOUNCE_MS);
    await flush();

    expect(server.puts).toEqual([{ key: 'panda.theme', value: 'stone', baseRev: 2 }]);
    expect(storage.getItem('panda.theme')).toBe('butter');
    expect(revs(storage)['panda.theme']).toBe(5);
    expect(changed(storage)).toEqual([]);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the changed mark on a network failure and retries at the next pull', async () => {
    const { server, storage, timers, sync, fetchSpy } = setup();
    await sync.pull();
    server.mode = 'offline';
    sync.storage.setItem('panda.mcpServers', '[]');
    timers.advance(PUSH_DEBOUNCE_MS);
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(changed(storage)).toEqual(['panda.mcpServers']);

    // No retry loop between pulls.
    timers.advance(PUSH_DEBOUNCE_MS * 20);
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    server.mode = 'json';
    await sync.pull();
    await flush();
    expect(server.puts).toEqual([{ key: 'panda.mcpServers', value: '[]', baseRev: 0 }]);
    expect(changed(storage)).toEqual([]);
  });

  it('never sends keys outside SYNCED_KEYS', async () => {
    const { server, storage, timers, sync, fetchSpy } = setup();
    storage.setItem('panda.sessions:abc', '[]');
    storage.setItem('panda.acp.url', 'ws://x');
    await sync.pull();
    sync.storage.setItem('panda.acp.cwd', '/tmp');
    sync.storage.setItem('panda.acceptance', '1');
    sync.storage.setItem('panda.sessions:def', '[]');
    timers.advance(PUSH_DEBOUNCE_MS * 2);
    await sync.pull();
    await flush();

    expect(server.puts).toEqual([]);
    expect(fetchSpy.mock.calls.every(([url]) => url === '/api/settings')).toBe(true);
    expect(changed(storage)).toEqual([]);
  });

  it('does not mark a write that leaves the value unchanged', async () => {
    const { server, storage, timers, sync } = setup();
    server.seed('panda.theme', 'matcha', 1);
    await sync.pull();
    sync.storage.setItem('panda.theme', 'matcha');
    timers.advance(PUSH_DEBOUNCE_MS);
    await flush();
    expect(server.puts).toEqual([]);
    expect(changed(storage)).toEqual([]);
  });
});

describe('settingsSync boot', () => {
  it('stops waiting for the first pull after the boot limit', async () => {
    const timers = new ManualTimers();
    let answer: (response: Response) => void = () => undefined;
    const sync = createSettingsSync({
      fetch: () => new Promise<Response>((resolve) => { answer = resolve; }),
      storage: () => new MemoryStorage(),
      timers,
      events: () => undefined,
    });
    let booted = false;
    void sync.boot().then(() => { booted = true; });
    await flush();
    expect(booted).toBe(false);
    timers.advance(BOOT_WAIT_MS);
    await flush();
    expect(booted).toBe(true);
    expect(sync.status()).toEqual({ state: 'off' });

    answer(new Response(JSON.stringify({ user: 'default', rev: 0, entries: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
    await flush();
    expect(sync.status()).toEqual({ state: 'on', user: 'default' });
  });
});
