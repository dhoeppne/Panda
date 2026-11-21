import { describe, expect, it } from 'vitest';
import { parseDevPage, parseHash, routeHash, sameRoute } from './routes';

describe('parseHash', () => {
  it.each([
    ['', { kind: 'new' }],
    ['#', { kind: 'new' }],
    ['#/', { kind: 'new' }],
    ['#//', { kind: 'new' }],
    ['#/new', { kind: 'new' }],
    ['#/settings', { kind: 'settings' }],
    ['#settings', { kind: 'settings' }],
    ['#/settings/', { kind: 'settings' }],
    ['#/settings//', { kind: 'settings' }],
    // Unknown or stale links fall back to the new-chat view — never a blank app.
    ['#/nope', { kind: 'new' }],
    ['#/settings/extra', { kind: 'new' }],
    // The scripted demo route is gone: an old #/demo link opens the app.
    ['#/demo', { kind: 'new' }],
  ])('parses %j', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('parses a chat route: the namespace and the session id', () => {
    expect(parseHash('#/chat/principal/6f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f')).toEqual({
      kind: 'chat',
      namespace: 'principal',
      sessionId: '6f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
    });
  });

  it('decodes an encoded segment', () => {
    expect(parseHash('#/chat/family%20one/session%2F1')).toEqual({
      kind: 'chat',
      namespace: 'family one',
      sessionId: 'session/1',
    });
  });

  it('falls back to the new-chat view on a malformed chat route', () => {
    expect(parseHash('#/chat/principal')).toEqual({ kind: 'new' });
    expect(parseHash('#/chat/principal/a/b')).toEqual({ kind: 'new' });
    expect(parseHash('#/chat/principal/%E0%A4%A')).toEqual({ kind: 'new' });
  });
});

describe('parseDevPage', () => {
  it('recognizes the dev-only smoke page', () => {
    expect(parseDevPage('#/astryx-smoke')).toBe('astryx-smoke');
    expect(parseDevPage('#astryx-smoke/')).toBe('astryx-smoke');
    expect(parseDevPage('#/settings')).toBe(null);
    expect(parseDevPage('')).toBe(null);
  });
});

describe('routeHash / navigate round-trip', () => {
  it('produces canonical hashes parseHash round-trips', () => {
    expect(routeHash({ kind: 'new' })).toBe('#/new');
    expect(routeHash({ kind: 'settings' })).toBe('#/settings');
    expect(parseHash(routeHash({ kind: 'new' }))).toEqual({ kind: 'new' });
    expect(parseHash(routeHash({ kind: 'settings' }))).toEqual({ kind: 'settings' });
  });

  it('encodes the parts of a chat route', () => {
    const route = { kind: 'chat' as const, namespace: 'family one', sessionId: 'session/1' };
    expect(routeHash(route)).toBe('#/chat/family%20one/session%2F1');
    expect(parseHash(routeHash(route))).toEqual(route);
  });
});

describe('sameRoute', () => {
  it('compares the chat parts', () => {
    expect(sameRoute({ kind: 'chat', namespace: 'a', sessionId: '1' }, { kind: 'chat', namespace: 'a', sessionId: '1' })).toBe(true);
    expect(sameRoute({ kind: 'chat', namespace: 'a', sessionId: '1' }, { kind: 'chat', namespace: 'a', sessionId: '2' })).toBe(false);
    expect(sameRoute({ kind: 'chat', namespace: 'a', sessionId: '1' }, { kind: 'chat', namespace: 'b', sessionId: '1' })).toBe(false);
  });

  it('compares the kinds', () => {
    expect(sameRoute({ kind: 'new' }, { kind: 'new' })).toBe(true);
    expect(sameRoute({ kind: 'new' }, { kind: 'settings' })).toBe(false);
  });
});
