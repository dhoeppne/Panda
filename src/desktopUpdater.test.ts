import { describe, expect, it, vi } from 'vitest';
import { createDesktopUpdater, type DesktopUpdaterHost, type UpdaterCandidate } from './desktopUpdater';
import type { UpdateBlocker } from './updateSafety';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  let blocker: UpdateBlocker | null = null;
  const env = { blocker: () => blocker, persist: vi.fn(() => true), lock: vi.fn() };
  const candidate = {
    version: '0.2.21', notes: 'A useful update',
    download: vi.fn<UpdaterCandidate['download']>(async (progress) => { progress(20, 100); progress(100, 100); }),
    install: vi.fn(async () => {}), close: vi.fn(async () => {}),
  };
  const host = { version: '0.2.20', check: vi.fn<DesktopUpdaterHost['check']>(async () => candidate), restart: vi.fn(async () => {}) };
  const updater = createDesktopUpdater(env);
  updater.setHost(host);
  env.lock.mockClear();
  return { updater, env, host, candidate, block: (reason: UpdateBlocker | null) => { blocker = reason; } };
}

describe('desktop updater lifecycle', () => {
  it('checks without downloading, installing, restarting or locking chat', async () => {
    const h = harness();
    await h.updater.check();
    expect(h.updater.store.getState()).toMatchObject({ phase: 'available', version: '0.2.20', update: { version: '0.2.21' } });
    expect(h.candidate.download).not.toHaveBeenCalled();
    expect(h.candidate.install).not.toHaveBeenCalled();
    expect(h.host.restart).not.toHaveBeenCalled();
    expect(h.env.persist).not.toHaveBeenCalled();
    expect(h.env.lock).not.toHaveBeenCalledWith(true);
  });

  it('reports current only after a successful no-update response', async () => {
    const h = harness();
    h.host.check.mockResolvedValue(null);
    await h.updater.check();
    expect(h.updater.store.getState().phase).toBe('current');
    h.host.check.mockRejectedValue(new Error('offline'));
    await expect(h.updater.check()).resolves.toBeUndefined();
    expect(h.updater.store.getState()).toMatchObject({ phase: 'error', error: 'check', version: '0.2.20' });
  });

  it('coalesces concurrent checks and closes a superseded candidate', async () => {
    const h = harness();
    const gate = deferred<UpdaterCandidate | null>();
    h.host.check.mockReturnValueOnce(gate.promise);
    const first = h.updater.check();
    const second = h.updater.check();
    expect(first).toBe(second);
    await Promise.resolve();
    gate.resolve(h.candidate);
    await first;
    await h.updater.check();
    expect(h.host.check).toHaveBeenCalledTimes(2);
    expect(h.candidate.close).toHaveBeenCalledTimes(1);
  });

  it('drops and releases a check result from an abandoned host', async () => {
    const h = harness();
    const gate = deferred<UpdaterCandidate | null>();
    h.host.check.mockReturnValue(gate.promise);
    const checking = h.updater.check();
    await Promise.resolve();
    h.updater.setHost({ ...h.host, version: '0.3.0' });
    gate.resolve(h.candidate);
    await checking;
    expect(h.updater.store.getState()).toMatchObject({ phase: 'idle', version: '0.3.0', update: null });
    expect(h.candidate.close).toHaveBeenCalledOnce();
  });

  it.each<UpdateBlocker>(['activity', 'queue', 'attachments'])(
    'defers every destructive step while %s needs attention', async (reason) => {
      const h = harness();
      await h.updater.check();
      h.block(reason);
      await h.updater.installAndRestart();
      expect(h.updater.store.getState()).toMatchObject({ phase: 'available', blocked: reason });
      expect(h.candidate.download).not.toHaveBeenCalled();
      expect(h.candidate.install).not.toHaveBeenCalled();
      expect(h.host.restart).not.toHaveBeenCalled();
    },
  );

  it('refuses to install when drafts cannot be saved', async () => {
    const h = harness();
    await h.updater.check();
    h.env.persist.mockReturnValue(false);
    await h.updater.installAndRestart();
    expect(h.updater.store.getState()).toMatchObject({ phase: 'available', error: 'persist', blocked: 'drafts' });
    expect(h.candidate.install).not.toHaveBeenCalled();
  });

  it('downloads separately, then requires another explicit click if work arrived mid-download', async () => {
    const h = harness();
    await h.updater.check();
    const gate = deferred();
    h.candidate.download.mockImplementation(async (progress) => { progress(50, 100); await gate.promise; });
    const installing = h.updater.installAndRestart();
    await Promise.resolve();
    expect(h.updater.store.getState()).toMatchObject({ phase: 'downloading', downloaded: 50, total: 100 });
    h.block('activity');
    gate.resolve();
    await installing;
    expect(h.candidate.install).not.toHaveBeenCalled();
    expect(h.env.lock).not.toHaveBeenCalledWith(true);
    h.block(null);
    await h.updater.installAndRestart();
    expect(h.candidate.download).toHaveBeenCalledOnce();
    expect(h.candidate.install).toHaveBeenCalledOnce();
    expect(h.host.restart).toHaveBeenCalledOnce();
    expect(h.env.persist).toHaveBeenCalled();
    expect(h.env.lock).toHaveBeenCalledWith(true);
  });

  it('defers restart if a request arrived while installation was in progress', async () => {
    const h = harness();
    await h.updater.check();
    h.candidate.install.mockImplementation(async () => { h.block('activity'); });
    await h.updater.installAndRestart();
    expect(h.updater.store.getState().phase).toBe('installed');
    expect(h.host.restart).not.toHaveBeenCalled();
    expect(h.env.lock).toHaveBeenLastCalledWith(false);
    h.block(null);
    await h.updater.installAndRestart();
    expect(h.host.restart).toHaveBeenCalledOnce();
    expect(h.candidate.install).toHaveBeenCalledOnce();
  });

  it.each(['download', 'install'] as const)('contains %s/signature failures and unlocks the app', async (stage) => {
    const h = harness();
    await h.updater.check();
    h.candidate[stage].mockRejectedValue(new Error('signature or I/O failure'));
    await expect(h.updater.installAndRestart()).resolves.toBeUndefined();
    expect(h.updater.store.getState()).toMatchObject({ phase: 'error', error: stage });
    expect(h.host.restart).not.toHaveBeenCalled();
    expect(h.env.lock).toHaveBeenLastCalledWith(false);
    expect(h.candidate.close).toHaveBeenCalledOnce();
  });

  it('retries a failed restart without reinstalling or losing the installed state', async () => {
    const h = harness();
    await h.updater.check();
    h.host.restart.mockRejectedValueOnce(new Error('child is still closing'));
    await h.updater.installAndRestart();
    expect(h.updater.store.getState()).toMatchObject({ phase: 'installed', error: 'restart' });
    expect(h.env.lock).toHaveBeenLastCalledWith(false);
    await h.updater.installAndRestart();
    expect(h.host.restart).toHaveBeenCalledTimes(2);
    expect(h.candidate.install).toHaveBeenCalledOnce();
    expect(h.updater.store.getState().phase).toBe('restarting');
  });

  it('ignores late download/progress after its host was abandoned', async () => {
    const h = harness();
    await h.updater.check();
    const gate = deferred();
    let report!: (bytes: number, total?: number) => void;
    h.candidate.download.mockImplementation(async (progress) => { report = progress; await gate.promise; });
    const installing = h.updater.installAndRestart();
    await Promise.resolve();
    h.updater.setHost(null);
    report(100, 100);
    gate.resolve();
    await installing;
    expect(h.updater.store.getState()).toMatchObject({ phase: 'unavailable', downloaded: 0 });
    expect(h.candidate.install).not.toHaveBeenCalled();
    expect(h.candidate.close).toHaveBeenCalledOnce();
  });
});
