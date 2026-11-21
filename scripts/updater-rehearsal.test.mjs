import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cachedRehearsalIdentity, isolateWebKit, rehearsalConfig, rehearsalFeed, verifyRehearsal } from './updater-rehearsal.mjs';

const storeId = Array.from({ length: 16 }, (_, index) => index);
describe('isolated updater rehearsal', () => {
  it('requires a loopback feed and isolates identity, storage and insecure transport from production', () => {
    const config = rehearsalConfig({ endpoint: 'http://127.0.0.1:45321/latest.json', storeId });
    expect(config.identifier).not.toBe('com.lukaisluka.panda');
    expect(config.identifier).toContain('.rehearsal.');
    expect(config.app.windows[0]).toMatchObject({ label: 'main', visible: true, focus: true, backgroundThrottling: 'disabled', create: false });
    expect(isolateWebKit('builder.build(tauri::generate_context!())', storeId)).toContain(`.data_store_identifier(${JSON.stringify(storeId)})`);
    expect(() => isolateWebKit('changed native source', storeId)).toThrow('single native app builder');
    expect(config.plugins.updater.endpoints).toEqual(['http://127.0.0.1:45321/latest.json']);
    expect(config.bundle.macOS.signingIdentity).toBe('-');
  });
  it.each(['https://github.com/example/latest.json', 'http://example.com:80/latest.json',
    'http://127.0.0.1:4321/other.json', 'http://user@127.0.0.1:4321/latest.json',
    'http://127.0.0.1:4321/latest.json?redirect=remote'])('refuses a nonisolated endpoint: %s', (endpoint) => {
    expect(() => rehearsalConfig({ endpoint, storeId })).toThrow('loopback');
  });
  it('requires an explicit data-store identifier', () => {
    expect(() => rehearsalConfig({ endpoint: 'http://127.0.0.1:4321/latest.json', storeId: [] })).toThrow('WebKit');
  });
  it('recovers the existing isolated identity without allocating a different data store', () => {
    const config = rehearsalConfig({ endpoint: 'http://127.0.0.1:4321/latest.json', storeId });
    expect(cachedRehearsalIdentity(config)).toEqual(storeId);
  });
  it('refuses to resume the personal app or an unrelated cached bundle', () => {
    const config = rehearsalConfig({ endpoint: 'http://127.0.0.1:4321/latest.json', storeId });
    expect(() => cachedRehearsalIdentity({ ...config, identifier: 'com.lukaisluka.panda' })).toThrow('isolated rehearsal');
    expect(() => cachedRehearsalIdentity({ ...config, productName: 'Panda' })).toThrow('isolated rehearsal');
  });
  it('refuses a remote or ambiguous cached feed before opening an app', () => {
    const config = rehearsalConfig({ endpoint: 'http://127.0.0.1:4321/latest.json', storeId });
    config.plugins.updater.endpoints = ['https://github.com/example/latest.json'];
    expect(() => cachedRehearsalIdentity(config)).toThrow('loopback');
    config.plugins.updater.endpoints = ['http://127.0.0.1:4321/latest.json', 'http://127.0.0.1:4322/latest.json'];
    expect(() => cachedRehearsalIdentity(config)).toThrow('isolated rehearsal');
  });
  it('serves failure modes and never uses GitHub for archives', () => {
    expect(rehearsalFeed('offline')).toMatchObject({ status: 503 });
    expect(rehearsalFeed('current')).toEqual({ status: 204 });
    expect(() => JSON.parse(rehearsalFeed('malformed').body)).toThrow();
    const feed = JSON.parse(rehearsalFeed('wrong-key', 'http://127.0.0.1:4321', 'trusted', 'untrusted').body);
    expect(feed.platforms['darwin-aarch64']).toEqual({ url: 'http://127.0.0.1:4321/wrong-key.tar.gz', signature: 'untrusted' });
    expect(JSON.parse(rehearsalFeed('older', 'http://127.0.0.1:4321', 'trusted').body).version).toBe('0.0.0');
  });
  it('keeps the acceptance entry and insecure transport out of normal builds', () => {
    const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const config = JSON.parse(readFileSync(new URL('../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    expect(main).not.toContain('updater-rehearsal');
    expect(config.plugins.updater.dangerousInsecureTransportProtocol).toBeUndefined();
    expect(config.identifier).toBe('com.lukaisluka.panda');
  });
  function complete() {
    const names = ['reload-recovered', 'offline-contained', 'malformed-contained', 'no-update', 'tampered-rejected',
      'wrong-key-rejected', 'interrupted-rejected', 'work-guards-passed', 'before-upgrade', 'recovered', 'downgrade-refused', 'passed'];
    return names.map((name) => ({ name, binarySha256: name === 'recovered' ? 'new' : 'old', version: '0.0.2', sessionId: 'rehearsal-session' }));
  }
  it('requires complete evidence and refuses a mutation after a rejected archive', () => {
    const events = complete();
    expect(() => verifyRehearsal(events, 'old', 'new')).not.toThrow();
    expect(() => verifyRehearsal(events.filter((event) => event.name !== 'recovered'), 'old', 'new')).toThrow('Missing acceptance');
    events.find((event) => event.name === 'tampered-rejected').binarySha256 = 'changed';
    expect(() => verifyRehearsal(events, 'old', 'new')).toThrow('changed the installed executable');
  });
  it('rejects a nominal success when restart loaded the wrong binary or a step failed', () => {
    expect(() => verifyRehearsal(complete(), 'old', 'other')).toThrow('Restarted application');
    expect(() => verifyRehearsal([...complete(), { name: 'failed', error: 'lost draft' }], 'old', 'new')).toThrow('lost draft');
  });
});

describe('acceptance evidence', () => {
  const fixture = () => ['reload-recovered', 'offline-contained', 'malformed-contained', 'no-update', 'tampered-rejected',
    'wrong-key-rejected', 'interrupted-rejected', 'work-guards-passed', 'before-upgrade', 'recovered', 'downgrade-refused', 'passed']
    .map((name) => ({ name, binarySha256: name === 'recovered' ? 'new' : 'old',
      ...(name === 'recovered' ? { version: '0.0.2', sessionId: 'rehearsal-session' } : {}) }));
  it('requires all real-app acceptance steps', () => {
    expect(() => verifyRehearsal(fixture(), 'old', 'new')).not.toThrow();
    expect(() => verifyRehearsal(fixture().slice(1), 'old', 'new')).toThrow('reload-recovered');
  });
  it('rejects executable changes following a failed signature/download', () => {
    const events = fixture();
    events.find((event) => event.name === 'wrong-key-rejected').binarySha256 = 'changed';
    expect(() => verifyRehearsal(events, 'old', 'new')).toThrow('changed the installed executable');
  });
  it('rejects a nominal success with the wrong installed version or recovered session', () => {
    const events = fixture();
    events.find((event) => event.name === 'recovered').sessionId = 'different';
    expect(() => verifyRehearsal(events, 'old', 'new')).toThrow('recovered chat');
  });
  it('surfaces a failure even if later events claim success', () => {
    expect(() => verifyRehearsal([...fixture(), { name: 'failed', error: 'draft lost' }], 'old', 'new')).toThrow('draft lost');
  });
});
