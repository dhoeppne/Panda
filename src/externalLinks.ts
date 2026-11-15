/**
 * How Panda hands an external URL to the platform.
 *
 * One decision point, three consumers: the anchor renderer for message
 * content (`components/ExternalLink.tsx`), the onboarding doc links, and the
 * url-mode elicitation card. Every one of them asks this module rather than
 * touching `window.open` itself.
 *
 * Two rules, in order:
 *   - every external link opens in a new tab, never in place;
 *   - in an iOS home-screen web app there are no tabs and no address bar, so
 *     "a new tab" would replace Panda with the destination page. There an
 *     out-of-scope navigation lets iOS choose the browser UI.
 */

/** The navigator facts iOS detection reads. Injectable so node tests can
 * pass fakes — the same shape as the storage fakes in fontSize/theme. */
export interface NavigatorFacts {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** iOS Safari only: true when the page runs from a home-screen icon. */
  standalone?: boolean;
}

/** The platform facts behind `isIosStandaloneWebApp`. */
export interface IosContext {
  navigator: NavigatorFacts;
  /** `(display-mode: standalone)` for the current window. */
  displayModeStandalone: boolean;
}

/** iPadOS 13+ reports a Mac desktop user agent; the touch count is the tell. */
function isIosDevice(nav: NavigatorFacts): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

function browserIosContext(): IosContext {
  return {
    navigator: typeof navigator === 'undefined' ? { userAgent: '' } : navigator,
    displayModeStandalone:
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches,
  };
}

/**
 * True when Panda runs as an iOS home-screen web app: an iOS device, and
 * either Safari's `navigator.standalone` or a standalone display mode.
 * Desktop-installed and Android web apps answer false — they have real tabs,
 * so the new tab is already the right answer there.
 */
export function isIosStandaloneWebApp(ctx?: IosContext): boolean {
  const facts = ctx ?? browserIosContext();
  if (!isIosDevice(facts.navigator)) return false;
  return facts.navigator.standalone === true || facts.displayModeStandalone;
}

/** Panda's Tauri desktop shell has one webview and no new-window handler.
 * Keep ordinary anchors there, preserving its existing in-webview behavior. */
export function isTauriDesktopShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function documentBaseUri(): string | undefined {
  return typeof document === 'undefined' ? undefined : document.baseURI;
}

function currentOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin;
}

/**
 * True when `href` leaves the app: an absolute http(s) URL on another
 * origin. Relative hrefs, Panda's own hash routes and non-http schemes
 * (`mailto:`, `tel:`) all stay internal, and keep the browser's default
 * handling — a new tab would break them, not fix them.
 *
 * `base` and `origin` default to the live document; tests pass them in.
 */
export function isExternalHref(
  href: string,
  base: string | undefined = documentBaseUri(),
  origin: string | undefined = currentOrigin(),
): boolean {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return origin === undefined || url.origin !== origin;
}

/**
 * Opens one external URL. Every caller reaches this in the click gesture —
 * an async `window.open` gets popup-blocked (see the elicitation card).
 *
 * Normal browsers get a new tab. On an iOS Home Screen web app, manifest
 * scope sends the external navigation to the system rather than keeping it
 * inside Panda.
 */
export function openExternal(url: string): void {
  if (isIosStandaloneWebApp()) {
    window.location.assign(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
