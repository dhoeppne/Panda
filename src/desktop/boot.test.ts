import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { I18nProvider } from '../i18n/context';
import { DesktopUpdateSettings } from '../components/SettingsPage';
import { desktopUpdater } from '../desktopUpdater';
import { lockUpdaterWork } from '../updateSafety';

const native = vi.hoisted(() => ({
  invoke: vi.fn(async (command: string) => command === 'desktop_updater_info' ? { version: '0.2.20', supported: true } : undefined),
  check: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ Channel: class {}, invoke: native.invoke }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  onAction: vi.fn(async () => ({ unregister: vi.fn() })), requestPermission: vi.fn(async () => 'granted'),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  isFocused: vi.fn(async () => false), show: vi.fn(), unminimize: vi.fn(), setFocus: vi.fn(),
}) }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: native.check }));
// SSR deliberately uses Zustand's initial snapshot; this markup test renders
// the controller's current client snapshot without mounting a browser.
vi.mock('../desktopUpdater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../desktopUpdater')>();
  return { ...actual, useDesktopUpdater: () => actual.desktopUpdater.store.getState() };
});
import { bootDesktop } from './boot';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => {
  desktopUpdater.setHost(null);
  lockUpdaterWork(false);
  native.invoke.mockClear();
  native.check.mockReset();
  vi.unstubAllGlobals();
});

describe('native updater boundary with mocked IPC', () => {
  it('finishes desktop boot while the quiet network check is still pending', async () => {
    let finish!: (value: null) => void;
    native.check.mockReturnValue(new Promise<null>((resolve) => { finish = resolve; }));
    await bootDesktop();
    expect(native.check).toHaveBeenCalledWith({ timeout: 10_000 });
    expect(desktopUpdater.store.getState().phase).toBe('checking');
    finish(null);
    await desktopUpdater.check();
    expect(desktopUpdater.store.getState().phase).toBe('current');
  });

  it('wires a staged download/install and the guarded native restart, and renders notes as text', async () => {
    const update = {
      version: '0.2.21', body: '<img src=x onerror=alert(1)>',
      download: vi.fn(async (report: (event: unknown) => void) => {
        report({ event: 'Started', data: { contentLength: 20 } });
        report({ event: 'Progress', data: { chunkLength: 20 } });
        report({ event: 'Finished' });
      }),
      install: vi.fn(async () => {}), close: vi.fn(async () => {}),
    };
    native.check.mockResolvedValue(update);
    await bootDesktop();
    await desktopUpdater.check();
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(DesktopUpdateSettings)));
    expect(html).toContain('0.2.20');
    expect(html).toContain('Install and restart');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
    await desktopUpdater.installAndRestart();
    expect(update.download).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
    expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: false });
    expect(native.invoke).toHaveBeenCalledWith('desktop_update_restart');
  });

  it('pins the same public key and limits updater grants to the main window', () => {
    const config = JSON.parse(readFileSync(new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const key = readFileSync(new URL('../../desktop/updater.pub', import.meta.url), 'utf8').trim();
    expect(config.plugins.updater.pubkey).toBe(key);
    expect(config.plugins.updater.endpoints).toEqual(['https://git.davidhoeppner.ca/la-creche/Panda/releases/download/latest/latest.json']);
    const capability = JSON.parse(readFileSync(new URL('../../desktop/src-tauri/capabilities/updater.json', import.meta.url), 'utf8'));
    expect(capability.windows).toEqual(['main']);
    expect(capability.platforms).toEqual(['macOS']);
    expect(capability.remote).toBeUndefined();
    expect(capability.permissions).toEqual(['updater:allow-check', 'updater:allow-download', 'updater:allow-install']);
    expect(capability.permissions).not.toContain('updater:allow-download-and-install');
  });
});
