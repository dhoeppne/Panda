import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateNotificationChat, createAttentionDispatcher, notificationsEnabled, NOTIFICATIONS_KEY,
  notificationChat, setDesktopNotificationHost, setNotificationsEnabled,
  type ChatAttention, type DesktopNotificationHost,
} from './desktopNotifications';
import { SYNCED_KEYS } from './settingsSync';

const chat = { namespace: 'family', sessionId: 'session/one' };
const attention = (patch: Partial<ChatAttention> = {}): ChatAttention => ({
  id: 'event-1', sessionId: chat.sessionId, kind: 'completed', chat, isCurrent: () => true, ...patch,
});
function host(patch: Partial<DesktopNotificationHost> = {}): DesktopNotificationHost {
  return {
    requestPermission: vi.fn(async () => true), isFocused: vi.fn(async () => false),
    viewedChat: () => null, send: vi.fn(async () => {}), ...patch,
  };
}
afterEach(() => { setDesktopNotificationHost(null); vi.restoreAllMocks(); });

describe('desktop notification policy', () => {
  it('does nothing until the user opts in', async () => {
    const native = host();
    await createAttentionDispatcher({ enabled: () => false, host: native })(attention());
    expect(native.send).not.toHaveBeenCalled();
  });

  it('suppresses the chat being read, but alerts for another chat or a minimized app', async () => {
    const native = host({ isFocused: async () => true, viewedChat: () => chat });
    const notify = createAttentionDispatcher({ enabled: () => true, host: native });
    await notify(attention());
    expect(native.send).not.toHaveBeenCalled();
    await notify(attention({ id: 'other', chat: { ...chat, sessionId: 'other' } }));
    expect(native.send).toHaveBeenCalledTimes(1);
    const minimized = host({ viewedChat: () => chat });
    await createAttentionDispatcher({ enabled: () => true, host: minimized })(attention());
    expect(minimized.send).toHaveBeenCalledWith('completed', chat);
  });

  it('alerts while settings are open rather than treating a retained chat as visible', async () => {
    const native = host({ isFocused: async () => true, viewedChat: () => null });
    await createAttentionDispatcher({ enabled: () => true, host: native })(attention());
    expect(native.send).toHaveBeenCalledOnce();
  });

  it('deduplicates overlapping deliveries of the same event', async () => {
    const native = host();
    const notify = createAttentionDispatcher({ enabled: () => true, host: native });
    await Promise.all([notify(attention()), notify(attention()), notify(attention())]);
    expect(native.send).toHaveBeenCalledOnce();
  });

  it('drops approvals resolved during the native focus check', async () => {
    let active = true;
    const native = host({ isFocused: async () => { active = false; return false; } });
    await createAttentionDispatcher({ enabled: () => true, host: native })(attention({ kind: 'approval', isCurrent: () => active }));
    expect(native.send).not.toHaveBeenCalled();
  });

  it('honors disabling notifications during the native focus check', async () => {
    let enabled = true;
    const native = host({ isFocused: async () => { enabled = false; return false; } });
    await createAttentionDispatcher({ enabled: () => enabled, host: native })(attention());
    expect(native.send).not.toHaveBeenCalled();
  });

  it('contains native failures without rejecting the agent event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const native = host({ send: async () => { throw new Error('not available'); } });
    await expect(createAttentionDispatcher({ enabled: () => true, host: native })(attention())).resolves.toBeUndefined();
  });

  it('defaults off and saves opt-in locally only after a successful permission request', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(notificationsEnabled(storage)).toBe(false);
    setDesktopNotificationHost(host({ requestPermission: async () => false }));
    expect(await setNotificationsEnabled(true, storage)).toBe(false);
    expect(notificationsEnabled(storage)).toBe(false);
    setDesktopNotificationHost(host());
    expect(await setNotificationsEnabled(true, storage)).toBe(true);
    expect(notificationsEnabled(storage)).toBe(true);
    expect(await setNotificationsEnabled(false, storage)).toBe(true);
    expect(notificationsEnabled(storage)).toBe(false);
    expect(SYNCED_KEYS as readonly string[]).not.toContain(NOTIFICATIONS_KEY);
  });
});

describe('notification tap routing', () => {
  it.each([null, {}, { panda: {} }, { panda: { version: 2, ...chat } }, { panda: { version: 1, namespace: '', sessionId: 's' } }])(
    'ignores malformed or unavailable payloads: %j', async (payload) => {
      const show = vi.fn(async () => {});
      await activateNotificationChat(payload, { show, unminimize: show, focus: show, navigate: vi.fn() });
      expect(show).not.toHaveBeenCalled();
      expect(notificationChat(payload)).toBeNull();
    },
  );

  it('restores the app before opening exactly the chat in the notification', async () => {
    const calls: string[] = [];
    await activateNotificationChat({ panda: { version: 1, ...chat } }, {
      show: async () => { calls.push('show'); }, unminimize: async () => { calls.push('unminimize'); },
      focus: async () => { calls.push('focus'); }, navigate: (id) => { expect(id).toEqual(chat); calls.push('navigate'); },
    });
    expect(calls).toEqual(['show', 'unminimize', 'focus', 'navigate']);
  });
});
