import { sameChat, type ChatId } from './chatId';
import { parseHash, routeHash, type AppRoute } from './routes';

/** This device's selection, deliberately outside settings sync. */
export const LAST_CHAT_KEY = 'panda.lastChat';
type ChatRoute = Extract<AppRoute, { kind: 'chat' }>;
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Restore only an otherwise empty launch. Explicit links, including New chat, win. */
export function startupChatRoute(hash: string, storage?: StoragePort): ChatRoute | null {
  if (hash !== '' && hash !== '#' && hash !== '#/') return null;
  try {
    const saved = (storage ?? globalThis.localStorage).getItem(LAST_CHAT_KEY);
    if (!saved) return null;
    const route = parseHash(saved);
    return route.kind === 'chat' && !route.namespace.startsWith('direct:') ? route : null;
  } catch {
    // Storage can be unavailable or denied; launching Panda must still work.
    return null;
  }
}

/** Remember successful selections, never an unverified or failed incoming link. */
export function rememberChatSelection(route: AppRoute, foreground: ChatId | null, storage?: StoragePort): void {
  try {
    const target = storage ?? globalThis.localStorage;
    if (route.kind === 'new') {
      target.removeItem(LAST_CHAT_KEY);
    } else if (route.kind === 'chat' && sameChat(route, foreground) && !route.namespace.startsWith('direct:')) {
      target.setItem(LAST_CHAT_KEY, routeHash(route));
    }
  } catch {
    console.warn('[panda] could not remember the selected chat');
  }
}

/** One opening attempt. Leaving the route invalidates late failures from that attempt. */
export function beginChatRecovery(
  id: ChatId,
  open: (id: ChatId, signal?: AbortSignal) => Promise<boolean>,
  failed: () => void,
): () => void {
  const controller = new AbortController();
  void Promise.resolve().then(() => {
    if (controller.signal.aborted) return true;
    return open(id, controller.signal);
  }).then((ok) => {
    if (!ok && !controller.signal.aborted) failed();
  }).catch(() => {
    if (!controller.signal.aborted) failed();
  });
  return () => controller.abort();
}
