/**
 * Panda's routes (ADR 0010). The hash names what the user looks at: a chat,
 * the new-chat view, or the settings.
 *
 * A chat route carries the namespace of the family that owns the chat and
 * the session id the agent minted. The id is the server's own, so a link to
 * a chat opens the same conversation on any device.
 *
 * No router dependency: a `hashchange` listener and this module are the
 * entire mechanism. An unknown hash falls back to the new-chat view (a
 * stale or mistyped link must never blank the app).
 */
import { useEffect, useState } from 'react';

/** What the hash names. */
export type AppRoute =
  /** A chat: the namespace of the family that owns it, and its session id. */
  | { kind: 'chat'; namespace: string; sessionId: string }
  /** The new-chat view: a chat that does not exist yet. */
  | { kind: 'new' }
  /** The settings. */
  | { kind: 'settings' };

export type DevPage = 'astryx-smoke' | 'crash';

/** The path segment of a chat route. */
const CHAT_SEGMENT = 'chat';

/** One decoded path segment, or null when the escape is malformed. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** `''` · `'#'` · `'#/'` → the new-chat view; `#/new` → the new-chat view;
 * `#/settings` → the settings; `#/chat/<ns>/<id>` → that chat. */
export function parseHash(hash: string): AppRoute {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (path === 'settings') return { kind: 'settings' };
  if (path === '' || path === 'new') return { kind: 'new' };
  const parts = path.split('/');
  if (parts[0] === CHAT_SEGMENT && parts.length === 3) {
    const namespace = decodeSegment(parts[1]!);
    const sessionId = decodeSegment(parts[2]!);
    if (namespace !== null && sessionId !== null && namespace !== '' && sessionId !== '') {
      return { kind: 'chat', namespace, sessionId };
    }
  }
  return { kind: 'new' };
}

/** Dev-only tree-level pages (main.tsx renders a different root for these). */
export function parseDevPage(hash: string): DevPage | null {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (import.meta.env.DEV && path === 'astryx-smoke') return 'astryx-smoke';
  if (import.meta.env.DEV && path === 'crash') return 'crash';
  return null;
}

/** The canonical hash for a route — the single spelling authority. */
export function routeHash(route: AppRoute): string {
  if (route.kind === 'chat') {
    return `#/${CHAT_SEGMENT}/${encodeURIComponent(route.namespace)}/${encodeURIComponent(route.sessionId)}`;
  }
  return route.kind === 'settings' ? '#/settings' : '#/new';
}

/** True when two routes name the same thing. */
export function sameRoute(a: AppRoute, b: AppRoute): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'chat' && b.kind === 'chat') {
    return a.namespace === b.namespace && a.sessionId === b.sessionId;
  }
  return true;
}

/**
 * The last route the app itself wrote. A route that arrives from elsewhere
 * (a pasted link, the back button of another site) is not this one, and the
 * app opens the chat it names. The marker is cleared once it is consumed.
 */
let written: AppRoute | null = null;

/** True when the route is the one the app last wrote itself. */
export function wasWrittenByApp(route: AppRoute): boolean {
  return written !== null && sameRoute(written, route);
}

/** Forgets the written marker, so the next route reads as an outside one. */
export function forgetWrittenRoute(): void {
  written = null;
}

/**
 * Moves to a route.
 *
 * `replace` is the default: the chats do not grow the browser's history
 * (ADR 0010), so the back button leaves Panda instead of walking the chats.
 * `push` is for the few moves that deserve a history entry of their own.
 */
export function navigate(route: AppRoute, opts?: { replace?: boolean }): void {
  const hash = routeHash(route);
  if (window.location.hash === hash) return; // nothing changes, and nothing is written
  written = route;
  if (opts?.replace === false) {
    window.location.hash = hash;
    return;
  }
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  // replaceState does not fire hashchange, so the route is re-read here.
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new Event('hashchange'));
}

/** The current route, re-resolved on every `hashchange`. Navigation goes
 * through `navigate()` — it flips the hash and the listener re-resolves. */
export function useHashRoute(): AppRoute {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
