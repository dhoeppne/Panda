import { sameChat, type ChatId } from './chatId';

export type AttentionKind = 'completed' | 'approval';
export interface ClientAttention {
  id: string;
  kind: AttentionKind;
  sessionId: string;
  /** Pending approval/connection identity may expire while native focus is queried. */
  isCurrent(): boolean;
}
export interface ChatAttention extends ClientAttention { chat: ChatId }
export interface DesktopNotificationHost {
  requestPermission(): Promise<boolean>;
  isFocused(): Promise<boolean>;
  viewedChat(): ChatId | null;
  send(kind: AttentionKind | 'test', chat: ChatId | null): Promise<void>;
}

export const NOTIFICATIONS_KEY = 'panda.desktopNotifications';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
const listeners = new Set<(enabled: boolean) => void>();
let host: DesktopNotificationHost | null = null;
let dispatch: ((event: ChatAttention) => Promise<void>) | null = null;

export function notificationsEnabled(storage?: PreferenceStorage): boolean {
  try { return (storage ?? globalThis.localStorage)?.getItem(NOTIFICATIONS_KEY) === 'true'; }
  catch { return false; }
}

export function desktopNotificationsAvailable(): boolean { return host !== null; }

export function subscribeNotificationPreference(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function setNotificationsEnabled(enabled: boolean, storage?: PreferenceStorage): Promise<boolean> {
  if (enabled && (!host || !(await host.requestPermission()))) return false;
  try { (storage ?? globalThis.localStorage).setItem(NOTIFICATIONS_KEY, String(enabled)); }
  catch { return false; }
  for (const listener of listeners) listener(enabled);
  return true;
}

/** Duplicate events, stale waiters and delivery failures never affect the agent turn. */
export function createAttentionDispatcher(env: {
  enabled(): boolean;
  host: DesktopNotificationHost;
}): (event: ChatAttention) => Promise<void> {
  const seen = new Set<string>();
  return async (event) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 1024) seen.delete(seen.values().next().value!);
    try {
      if (!env.enabled() || !event.isCurrent()) return;
      const focused = await env.host.isFocused();
      if (!env.enabled() || !event.isCurrent()) return;
      if (focused && sameChat(event.chat, env.host.viewedChat())) return;
      await env.host.send(event.kind, event.chat);
    } catch {
      console.warn('[panda/notifications] could not request a desktop notification');
    }
  };
}

export function setDesktopNotificationHost(next: DesktopNotificationHost | null): void {
  host = next;
  dispatch = next ? createAttentionDispatcher({ enabled: () => host === next && notificationsEnabled(), host: next }) : null;
}

export function publishChatAttention(event: ChatAttention): void { void dispatch?.(event); }

export async function testDesktopNotification(): Promise<void> {
  if (!host || !notificationsEnabled()) return;
  await host.send('test', null);
}

/** OS payloads may outlive their chat. Accept only our versioned chat identity. */
export function notificationChat(extra: unknown): ChatId | null {
  if (!extra || typeof extra !== 'object' || !('panda' in extra)) return null;
  const value = extra.panda;
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
      !('namespace' in value) || typeof value.namespace !== 'string' || !value.namespace ||
      !('sessionId' in value) || typeof value.sessionId !== 'string' || !value.sessionId) return null;
  return { namespace: value.namespace, sessionId: value.sessionId };
}

export async function activateNotificationChat(extra: unknown, actions: {
  show(): Promise<void>;
  unminimize(): Promise<void>;
  focus(): Promise<void>;
  navigate(chat: ChatId): void;
}): Promise<void> {
  const chat = notificationChat(extra);
  if (!chat) return;
  await actions.show();
  await actions.unminimize();
  await actions.focus();
  actions.navigate(chat);
}
