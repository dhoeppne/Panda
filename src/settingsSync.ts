/**
 * Settings sync with the optional settings store (server/README.md).
 *
 * localStorage stays the single source of truth for every module. This
 * module mirrors SYNCED_KEYS to the server at /api/settings, so one Panda
 * URL shows the same agents, layout and preferences on every device.
 *
 * - The wire value of a key is its raw localStorage string, sent as a JSON
 *   string. This module never parses the modules' own formats.
 * - Writes go through `syncedStorage`: each module's defaultStorage()
 *   returns it, so a write marks the key as changed and a debounced PUT
 *   follows. A pull writes server values straight into localStorage and
 *   then runs the owning module's onRemoteChange callback, so this module
 *   never imports the modules it serves.
 * - Without a settings server (the Vite dev server and the nginx fallback
 *   answer unknown paths with index.html and status 200, the web image alone
 *   answers 502) sync stays off and Panda works from localStorage only.
 *
 * fetch, the raw storage, the timers and the event targets are injected
 * (browser defaults), so tests need no globals.
 */

export const SYNCED_KEYS = [
  'panda.profiles',
  'panda.nav',
  'panda.mcpServers',
  'panda.theme',
  'panda.fontSize.ui',
  'panda.fontSize.code',
  'panda.locale',
  'panda.lastFamily',
] as const;

export type SyncedKey = (typeof SYNCED_KEYS)[number];

/** Per-browser bookkeeping. These keys are not synced. */
const REVS_KEY = 'panda.sync.revs';
const ETAG_KEY = 'panda.sync.etag';
const CHANGED_KEY = 'panda.sync.changed';

export const SETTINGS_ENDPOINT = '/api/settings';
export const PUSH_DEBOUNCE_MS = 400;
export const PULL_INTERVAL_MS = 60_000;
export const BOOT_WAIT_MS = 1500;

/** localStorage-shaped backend. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SyncTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
}

/** The parts of window and document the pull triggers use. */
export interface SyncEventTargets {
  window: Pick<EventTarget, 'addEventListener'>;
  document: Pick<EventTarget, 'addEventListener'> & { readonly visibilityState: DocumentVisibilityState };
}

export type SyncStatus = { state: 'off' } | { state: 'on'; user: string };

export interface SettingsSyncDeps {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** The raw storage, read at each call. In a context with no localStorage
   * (node), calls fail exactly as they did before sync existed. */
  storage?: () => KeyValueStorage;
  timers?: SyncTimers;
  events?: () => SyncEventTargets | undefined;
}

export interface SettingsSync {
  /** Reads and writes the raw storage. A write to a synced key marks it for a push. */
  readonly storage: KeyValueStorage;
  /** GET /api/settings and apply the answer. Never rejects. */
  pull(): Promise<void>;
  status(): SyncStatus;
  subscribeStatus(listener: (status: SyncStatus) => void): () => void;
  /** Runs callback after a pull or a conflict changed the key's local value. */
  onRemoteChange(key: SyncedKey, callback: () => void): () => void;
  /** Registers the pull triggers and starts the first pull. Resolves when the
   * pull ends or after waitMs, whichever comes first. */
  boot(waitMs?: number): Promise<void>;
}

type Entry = { value: unknown; rev: number };
type Snapshot = { user: string; rev: number; entries: Record<string, Entry> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRev = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false;
  if (typeof value.user !== 'string' || value.user.length === 0 || !isRev(value.rev)) return false;
  if (!isRecord(value.entries)) return false;
  return Object.values(value.entries).every((entry) => isRecord(entry) && isRev(entry.rev) && 'value' in entry);
}

function isJsonResponse(response: Response): boolean {
  const type = response.headers.get('content-type') ?? '';
  return /^application\/json\s*(;|$)/i.test(type);
}

function isSyncedKey(key: string): key is SyncedKey {
  return (SYNCED_KEYS as readonly string[]).includes(key);
}

function browserTimers(): SyncTimers {
  return {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  };
}

function browserEvents(): SyncEventTargets | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  return { window, document };
}

export function createSettingsSync(deps: SettingsSyncDeps = {}): SettingsSync {
  const doFetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const raw = deps.storage ?? (() => globalThis.localStorage);
  const timers = deps.timers ?? browserTimers();
  const events = deps.events ?? browserEvents;

  let current: SyncStatus = { state: 'off' };
  const statusListeners = new Set<(status: SyncStatus) => void>();
  const remoteListeners = new Map<string, Set<() => void>>();
  const pushTimers = new Map<SyncedKey, unknown>();
  const inFlight = new Set<SyncedKey>();
  let pulling: Promise<void> | null = null;
  let triggersStarted = false;

  // --- bookkeeping (best effort: a storage failure must not break a write)

  function readJson(key: string): unknown {
    try {
      const text = raw().getItem(key);
      return text === null ? null : JSON.parse(text);
    } catch {
      return null;
    }
  }

  function writeBookkeeping(key: string, value: string | null): void {
    try {
      if (value === null) raw().removeItem(key);
      else raw().setItem(key, value);
    } catch (err) {
      console.warn('[panda/sync] could not write sync bookkeeping', err);
    }
  }

  function readRevs(): Record<string, number> {
    const parsed = readJson(REVS_KEY);
    const revs: Record<string, number> = {};
    if (isRecord(parsed)) {
      for (const [key, rev] of Object.entries(parsed)) if (isRev(rev)) revs[key] = rev;
    }
    return revs;
  }

  function baseRevOf(key: SyncedKey): number {
    return readRevs()[key] ?? 0;
  }

  function setBaseRev(key: SyncedKey, rev: number): void {
    const revs = readRevs();
    if (rev === 0) delete revs[key];
    else revs[key] = rev;
    writeBookkeeping(REVS_KEY, JSON.stringify(revs));
  }

  function readChanged(): Set<SyncedKey> {
    const parsed = readJson(CHANGED_KEY);
    const keys = Array.isArray(parsed) ? parsed.filter((key): key is SyncedKey => typeof key === 'string' && isSyncedKey(key)) : [];
    return new Set(keys);
  }

  function setChanged(key: SyncedKey, changed: boolean): void {
    const keys = readChanged();
    if (changed === keys.has(key)) return;
    if (changed) keys.add(key);
    else keys.delete(key);
    writeBookkeeping(CHANGED_KEY, keys.size === 0 ? null : JSON.stringify([...keys]));
  }

  function readEtag(): string | null {
    try {
      return raw().getItem(ETAG_KEY);
    } catch {
      return null;
    }
  }

  // --- status and callbacks

  function setStatus(next: SyncStatus): void {
    if (next.state === current.state && (next.state === 'off' || (current.state === 'on' && current.user === next.user))) return;
    current = next;
    for (const listener of statusListeners) listener(current);
  }

  function notifyRemote(key: SyncedKey): void {
    for (const callback of remoteListeners.get(key) ?? []) {
      try {
        callback();
      } catch (err) {
        console.warn(`[panda/sync] refresh after a remote change of ${key} failed`, err);
      }
    }
  }

  /** Writes a server value into localStorage. Returns true when the local
   * value changed. A value that is neither a string nor null is skipped. */
  function writeLocal(key: SyncedKey, value: unknown): boolean {
    if (value !== null && typeof value !== 'string') {
      console.warn(`[panda/sync] server value of ${key} is not a string — skipped`);
      return false;
    }
    try {
      const before = raw().getItem(key);
      if (before === value) return false;
      if (value === null) raw().removeItem(key);
      else raw().setItem(key, value);
      return true;
    } catch (err) {
      console.warn(`[panda/sync] could not store the server value of ${key}`, err);
      return false;
    }
  }

  // --- push

  function schedulePush(key: SyncedKey): void {
    if (current.state !== 'on') return;
    const pending = pushTimers.get(key);
    if (pending !== undefined) timers.clearTimeout(pending);
    pushTimers.set(key, timers.setTimeout(() => {
      pushTimers.delete(key);
      void push(key);
    }, PUSH_DEBOUNCE_MS));
  }

  async function push(key: SyncedKey): Promise<void> {
    if (inFlight.has(key)) return; // the running push pushes again when its 200 shows a newer value
    const pending = pushTimers.get(key);
    if (pending !== undefined) timers.clearTimeout(pending);
    pushTimers.delete(key);
    let value: string | null;
    try {
      value = raw().getItem(key);
    } catch {
      return;
    }
    const baseRev = baseRevOf(key);
    // True when the key changed again while this push ran: push once more.
    let changedMeanwhile = false;
    inFlight.add(key);
    try {
      let response: Response;
      try {
        response = await doFetch(`${SETTINGS_ENDPOINT}/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value, baseRev }),
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch {
        return; // network failure: the changed mark stays, the next pull retries
      }
      const body: unknown = isJsonResponse(response) ? await response.json().catch(() => null) : null;
      if (response.status === 200 && isRecord(body) && isRev(body.rev)) {
        setBaseRev(key, body.rev);
        let now: string | null = value;
        try {
          now = raw().getItem(key);
        } catch {
          // keep `now` equal to the pushed value
        }
        if (now === value) setChanged(key, false);
        else changedMeanwhile = true;
        return;
      }
      if (response.status === 409 && isRecord(body) && isRev(body.rev)) {
        console.warn(`[panda/sync] ${key} changed on another device — using the server value`);
        setBaseRev(key, body.rev);
        setChanged(key, false);
        if (writeLocal(key, body.value ?? null)) notifyRemote(key);
        return;
      }
      console.warn(`[panda/sync] push of ${key} failed with HTTP ${response.status}; retrying at the next pull`);
    } finally {
      inFlight.delete(key);
      if (changedMeanwhile) schedulePush(key);
    }
  }

  // --- pull

  function apply(snapshot: Snapshot): void {
    const changed = readChanged();
    const toPush: SyncedKey[] = [];
    const refreshed: SyncedKey[] = [];
    for (const key of SYNCED_KEYS) {
      if (inFlight.has(key)) continue; // its push answer records the rev
      const entry = snapshot.entries[key];
      const baseRev = baseRevOf(key);
      if (entry !== undefined) {
        if (entry.rev !== baseRev) {
          // Rule 1: the server changed the key since this browser last saw it.
          if (writeLocal(key, entry.value)) refreshed.push(key);
          setBaseRev(key, entry.rev);
          setChanged(key, false);
        } else if (changed.has(key)) {
          // Rule 3: changed here, unchanged on the server.
          toPush.push(key);
        }
        continue;
      }
      // The server has no entry: its rev for the key is 0.
      setBaseRev(key, 0);
      let local: string | null = null;
      try {
        local = raw().getItem(key);
      } catch {
        local = null;
      }
      if (local !== null) {
        // Rule 2: the first device seeds the server.
        setChanged(key, true);
        toPush.push(key);
      } else {
        setChanged(key, false);
      }
    }
    for (const key of refreshed) notifyRemote(key);
    for (const key of toPush) void push(key);
  }

  function pushChanged(): void {
    for (const key of readChanged()) {
      if (!inFlight.has(key)) void push(key);
    }
  }

  async function runPull(): Promise<void> {
    const headers: Record<string, string> = {};
    const etag = current.state === 'on' ? readEtag() : null;
    if (etag !== null) headers['If-None-Match'] = etag;
    let response: Response;
    try {
      response = await doFetch(SETTINGS_ENDPOINT, { headers, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      setStatus({ state: 'off' });
      return;
    }
    if (response.status === 304 && etag !== null) {
      pushChanged();
      return;
    }
    if (response.status !== 200 || !isJsonResponse(response)) {
      setStatus({ state: 'off' });
      return;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      setStatus({ state: 'off' });
      return;
    }
    if (!isSnapshot(body)) {
      setStatus({ state: 'off' });
      return;
    }
    writeBookkeeping(ETAG_KEY, response.headers.get('etag'));
    setStatus({ state: 'on', user: body.user });
    apply(body);
  }

  function pull(): Promise<void> {
    if (pulling === null) {
      pulling = runPull()
        .catch((err: unknown) => {
          console.warn('[panda/sync] pull failed', err);
        })
        .finally(() => {
          pulling = null;
        });
    }
    return pulling;
  }

  function startTriggers(): void {
    if (triggersStarted) return;
    const targets = events();
    if (targets === undefined) return;
    triggersStarted = true;
    const pullWhenVisible = () => {
      if (targets.document.visibilityState === 'visible') void pull();
    };
    targets.document.addEventListener('visibilitychange', pullWhenVisible);
    targets.window.addEventListener('focus', () => void pull());
    targets.window.addEventListener('online', () => void pull());
    timers.setInterval(pullWhenVisible, PULL_INTERVAL_MS);
  }

  function markChanged(key: string): void {
    if (!isSyncedKey(key)) return;
    setChanged(key, true);
    schedulePush(key);
  }

  const storage: KeyValueStorage = {
    getItem: (key) => raw().getItem(key),
    setItem: (key, value) => {
      const store = raw();
      const before = store.getItem(key);
      store.setItem(key, value);
      if (before !== value) markChanged(key);
    },
    removeItem: (key) => {
      const store = raw();
      const before = store.getItem(key);
      store.removeItem(key);
      if (before !== null) markChanged(key);
    },
  };

  return {
    storage,
    pull,
    status: () => current,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    onRemoteChange(key, callback) {
      let callbacks = remoteListeners.get(key);
      if (callbacks === undefined) {
        callbacks = new Set();
        remoteListeners.set(key, callbacks);
      }
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    boot(waitMs = BOOT_WAIT_MS) {
      startTriggers();
      const first = pull();
      return new Promise<void>((resolve) => {
        const timer = timers.setTimeout(resolve, waitMs);
        void first.then(() => {
          timers.clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

// --- the browser's instance (created on first use; creation touches no global)

let browserSync: SettingsSync | null = null;

function sync(): SettingsSync {
  browserSync ??= createSettingsSync();
  return browserSync;
}

/** The storage every synced module's defaultStorage() returns. */
export const syncedStorage: KeyValueStorage = {
  getItem: (key) => sync().storage.getItem(key),
  setItem: (key, value) => sync().storage.setItem(key, value),
  removeItem: (key) => sync().storage.removeItem(key),
};

export function onRemoteChange(key: SyncedKey, callback: () => void): () => void {
  return sync().onRemoteChange(key, callback);
}

export function getSyncStatus(): SyncStatus {
  return sync().status();
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  return sync().subscribeStatus(listener);
}

/** main.tsx: the first pull before the first render, waiting at most BOOT_WAIT_MS. */
export function bootSettingsSync(): Promise<void> {
  return sync().boot();
}
