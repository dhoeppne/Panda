import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { usePanda } from './store';
import { useComposerDrafts } from './composerDrafts';
import { useMessageQueue } from './messageQueue';
import { lockUpdaterWork, restartBlocker, useUpdateSafety, type UpdateBlocker } from './updateSafety';

export interface UpdaterCandidate {
  version: string;
  notes: string;
  download(progress: (downloaded: number, total?: number) => void): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}
export interface DesktopUpdaterHost {
  version: string;
  check(): Promise<UpdaterCandidate | null>;
  restart(): Promise<void>;
}
type Phase = 'unavailable' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'installed' | 'restarting' | 'error';
export type UpdaterError = 'check' | 'download' | 'install' | 'restart' | 'persist';
export interface UpdaterState {
  phase: Phase;
  version: string | null;
  update: { version: string; notes: string } | null;
  downloaded: number;
  total: number | null;
  error: UpdaterError | null;
  blocked: UpdateBlocker | null;
}

const initialState = (): UpdaterState => ({ phase: 'unavailable', version: null, update: null,
  downloaded: 0, total: null, error: null, blocked: null });
const release = (candidate: UpdaterCandidate | null) => { void candidate?.close().catch(() => {}); };

/** The controller owns resources and async eras; React only renders its snapshot. */
export function createDesktopUpdater(env: {
  blocker(): UpdateBlocker | null;
  persist(): boolean;
  lock(locked: boolean): void;
}) {
  const store = createStore<UpdaterState>(initialState);
  let host: DesktopUpdaterHost | null = null;
  let candidate: UpdaterCandidate | null = null;
  let downloaded = false;
  let era = 0;
  let operation: Promise<void> | null = null;
  const current = (generation: number, owner: DesktopUpdaterHost) => era === generation && host === owner;
  const blocked = (phase: 'available' | 'installed'): boolean => {
    const reason = env.blocker();
    if (reason) { store.setState({ phase, blocked: reason, error: null }); return true; }
    if (!env.persist()) { store.setState({ phase, blocked: 'drafts', error: 'persist' }); return true; }
    store.setState({ blocked: null, error: null });
    return false;
  };
  const run = (work: () => Promise<void>): Promise<void> => {
    if (operation) return operation;
    // Schedule work after assigning ownership, including synchronously failing adapters.
    const task = Promise.resolve().then(work).finally(() => { if (operation === task) operation = null; });
    operation = task;
    return task;
  };
  const restart = async (owner: DesktopUpdaterHost, generation: number) => {
    if (!current(generation, owner) || blocked('installed')) return;
    env.lock(true);
    store.setState({ phase: 'restarting', error: null });
    try { await owner.restart(); }
    catch {
      if (current(generation, owner)) store.setState({ phase: 'installed', error: 'restart' });
      env.lock(false);
    }
  };
  return {
    store,
    setHost(next: DesktopUpdaterHost | null) {
      era++;
      const previous = candidate;
      candidate = null;
      downloaded = false;
      if (!operation) env.lock(false);
      if (operation) void operation.then(() => release(previous));
      else release(previous);
      host = next;
      store.setState({ ...initialState(), phase: next ? 'idle' : 'unavailable', version: next?.version ?? null });
    },
    check(): Promise<void> {
      if (!host || store.getState().phase === 'installed' || store.getState().phase === 'restarting') return Promise.resolve();
      return run(async () => {
        const owner = host;
        if (!owner) return;
        const generation = ++era;
        release(candidate);
        candidate = null;
        downloaded = false;
        store.setState({ phase: 'checking', update: null, error: null, blocked: null, downloaded: 0, total: null });
        try {
          const next = await owner.check();
          if (!current(generation, owner)) { release(next); return; }
          candidate = next;
          store.setState({ phase: next ? 'available' : 'current', update: next ? { version: next.version, notes: next.notes } : null });
        } catch {
          if (current(generation, owner)) store.setState({ phase: 'error', error: 'check' });
        }
      });
    },
    installAndRestart(): Promise<void> {
      return run(async () => {
        const owner = host;
        const update = candidate;
        const generation = era;
        if (!owner) return;
        if (store.getState().phase === 'installed') { await restart(owner, generation); return; }
        if (!update || blocked('available')) return;
        let stage: UpdaterError = 'download';
        try {
          if (!downloaded) {
            store.setState({ phase: 'downloading', error: null, downloaded: 0, total: null });
            await update.download((bytes, total) => {
              if (current(generation, owner) && store.getState().phase === 'downloading') store.setState({
                downloaded: Number.isFinite(bytes) ? Math.max(0, bytes) : 0,
                total: total !== undefined && Number.isFinite(total) && total > 0 ? total : null,
              });
            });
            if (!current(generation, owner)) return;
            downloaded = true;
          }
          if (blocked('available')) return;
          stage = 'install';
          env.lock(true);
          store.setState({ phase: 'installing', error: null });
          await update.install();
          if (!current(generation, owner)) return;
          release(update);
          candidate = null;
          store.setState({ phase: 'installed' });
          await restart(owner, generation);
        } catch {
          if (current(generation, owner)) {
            release(update);
            candidate = null;
            downloaded = false;
            store.setState({ phase: 'error', error: stage });
          }
        } finally {
          if (!current(generation, owner) || store.getState().phase !== 'restarting') env.lock(false);
        }
      });
    },
  };
}

export function currentUpdateBlocker(): UpdateBlocker | null {
  return restartBlocker(usePanda.getState().connections, useComposerDrafts.getState().drafts,
    useMessageQueue.getState().queues, useUpdateSafety.getState().attachmentReads);
}
export const desktopUpdater = createDesktopUpdater({ blocker: currentUpdateBlocker,
  persist: () => useComposerDrafts.getState().prepareForRestart(), lock: lockUpdaterWork });
export const useDesktopUpdater = () => useStore(desktopUpdater.store);
