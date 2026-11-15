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
 *     "a new tab" would replace Panda with the destination page. There the
 *     URL is handed to the Safari app instead.
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
 * The Safari hand-off URL for an http(s) URL, or null for anything else.
 *
 * iOS maps `x-safari-https://host/path` onto `https://host/path` opened in
 * the Safari app. The scheme is undocumented — Apple commits to nothing —
 * so `openExternal` always keeps an in-app fallback behind it.
 */
export function safariSchemeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return `x-safari-${parsed.href}`;
}

/** How long the Safari hand-off gets before the in-app fallback fires. */
export const SAFARI_HANDOFF_MS = 700;

/**
 * Opens one external URL. Every caller reaches this in the click gesture —
 * an async `window.open` gets popup-blocked (see the elicitation card).
 *
 * Normal browsers get a new tab. An iOS home-screen web app gets the Safari
 * hand-off above; when iOS does not act on the scheme the app is still on
 * screen, so the timer navigates in-app rather than leaving the tap dead.
 * When Safari does take over, the app is hidden and the fallback never runs.
 */
export function openExternal(url: string): void {
  const safari = safariSchemeUrl(url);
  if (safari !== null && isIosStandaloneWebApp()) {
    window.location.assign(safari);
    window.setTimeout(() => {
      if (!document.hidden) window.location.assign(url);
    }, SAFARI_HANDOFF_MS);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
