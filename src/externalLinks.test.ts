import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAFARI_HANDOFF_MS,
  isExternalHref,
  isIosStandaloneWebApp,
  openExternal,
  safariSchemeUrl,
} from './externalLinks';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

const BASE = 'https://panda.example/Panda/';
const ORIGIN = 'https://panda.example';

describe('isExternalHref', () => {
  it('accepts an absolute http(s) URL on another origin', () => {
    expect(isExternalHref('https://github.com/la-creche/Panda', BASE, ORIGIN)).toBe(true);
    expect(isExternalHref('http://127.0.0.1:8530/healthz', BASE, ORIGIN)).toBe(true);
  });

  it('rejects the app’s own origin, relative hrefs and non-http schemes', () => {
    expect(isExternalHref('https://panda.example/Panda/#/demo', BASE, ORIGIN)).toBe(false);
    expect(isExternalHref('docs/agent-quickstart.md', BASE, ORIGIN)).toBe(false);
    expect(isExternalHref('/Panda/og-image.png', BASE, ORIGIN)).toBe(false);
    expect(isExternalHref('#/demo', BASE, ORIGIN)).toBe(false);
    expect(isExternalHref('mailto:tech@example.com', BASE, ORIGIN)).toBe(false);
  });

  it('rejects an unparseable href', () => {
    expect(isExternalHref('https://[not a host', BASE, ORIGIN)).toBe(false);
  });

  it('answers with no base or origin, the way the anchor component calls it', () => {
    expect(isExternalHref('docs/agent-quickstart.md', undefined, undefined)).toBe(false);
    expect(isExternalHref('https://github.com/la-creche/Panda', undefined, undefined)).toBe(true);
  });
});

describe('safariSchemeUrl', () => {
  it('prefixes http(s) URLs', () => {
    expect(safariSchemeUrl('https://example.com/a?b=1#c')).toBe('x-safari-https://example.com/a?b=1#c');
    expect(safariSchemeUrl('http://127.0.0.1:8530/')).toBe('x-safari-http://127.0.0.1:8530/');
  });

  it('answers null for anything that is not http(s)', () => {
    expect(safariSchemeUrl('mailto:tech@example.com')).toBeNull();
    expect(safariSchemeUrl('x-safari-https://example.com')).toBeNull();
    expect(safariSchemeUrl('not a url')).toBeNull();
  });
});

describe('isIosStandaloneWebApp', () => {
  it('is true on an iOS device running from a home-screen icon', () => {
    expect(
      isIosStandaloneWebApp({
        navigator: { userAgent: IPHONE_UA, standalone: true },
        displayModeStandalone: false,
      }),
    ).toBe(true);
    expect(
      isIosStandaloneWebApp({
        navigator: { userAgent: IPHONE_UA },
        displayModeStandalone: true,
      }),
    ).toBe(true);
  });

  it('is false in iOS Safari and on every other platform', () => {
    expect(
      isIosStandaloneWebApp({
        navigator: { userAgent: IPHONE_UA },
        displayModeStandalone: false,
      }),
    ).toBe(false);
    expect(
      isIosStandaloneWebApp({
        navigator: { userAgent: ANDROID_UA, standalone: true },
        displayModeStandalone: true,
      }),
    ).toBe(false);
  });

  it('recognizes an iPadOS desktop-mode user agent by its touch points', () => {
    expect(
      isIosStandaloneWebApp({
        navigator: { userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 5, standalone: true },
        displayModeStandalone: false,
      }),
    ).toBe(true);
    expect(
      isIosStandaloneWebApp({
        navigator: { userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 0, standalone: true },
        displayModeStandalone: false,
      }),
    ).toBe(false);
  });
});

/** Stubs the three globals `openExternal` reads and records its effects. */
function stubPlatform({ ios, hidden }: { ios: boolean; hidden: boolean }): string[] {
  const calls: string[] = [];
  vi.stubGlobal('navigator', { userAgent: ios ? IPHONE_UA : ANDROID_UA, standalone: ios });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    location: { assign: (url: string) => calls.push(`assign:${url}`) },
    open: (url: string) => calls.push(`open:${url}`),
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
  });
  vi.stubGlobal('document', { hidden });
  return calls;
}

describe('openExternal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens a new tab on every platform but an iOS home-screen web app', () => {
    const calls = stubPlatform({ ios: false, hidden: false });
    openExternal('https://example.com/a');
    expect(calls).toEqual(['open:https://example.com/a']);
  });

  it('hands the URL to Safari on an iOS home-screen web app', () => {
    vi.useFakeTimers();
    const calls = stubPlatform({ ios: true, hidden: false });
    openExternal('https://example.com/a');
    expect(calls).toEqual(['assign:x-safari-https://example.com/a']);
  });

  it('falls back to in-app navigation when iOS ignores the Safari scheme', () => {
    vi.useFakeTimers();
    const calls = stubPlatform({ ios: true, hidden: false });
    openExternal('https://example.com/a');
    vi.advanceTimersByTime(SAFARI_HANDOFF_MS);
    expect(calls).toEqual([
      'assign:x-safari-https://example.com/a',
      'assign:https://example.com/a',
    ]);
  });

  it('stays put when Safari did take the hand-off', () => {
    vi.useFakeTimers();
    const calls = stubPlatform({ ios: true, hidden: true });
    openExternal('https://example.com/a');
    vi.advanceTimersByTime(SAFARI_HANDOFF_MS);
    expect(calls).toEqual(['assign:x-safari-https://example.com/a']);
  });
});
