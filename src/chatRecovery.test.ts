import { describe, expect, it, vi } from 'vitest';
import { beginChatRecovery, LAST_CHAT_KEY, rememberChatSelection, startupChatRoute } from './chatRecovery';
import { routeHash } from './routes';
import { SYNCED_KEYS } from './settingsSync';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

const chat = { kind: 'chat' as const, namespace: 'family one', sessionId: 'session/1' };

describe('device-local chat selection recovery', () => {
  it('restores the confirmed family/session after an empty launch', () => {
    const storage = memoryStorage();
    rememberChatSelection(chat, chat, storage);
    expect(storage.getItem(LAST_CHAT_KEY)).toBe('#/chat/family%20one/session%2F1');
    for (const hash of ['', '#', '#/']) expect(startupChatRoute(hash, storage)).toEqual(chat);
    expect(SYNCED_KEYS as readonly string[]).not.toContain(LAST_CHAT_KEY);
  });

  it.each(['#/new', '#/settings', '#/chat/other/session', '#/unknown', '#/crash'])(
    'preserves explicit incoming route %s', (hash) => {
      const storage = memoryStorage();
      rememberChatSelection(chat, chat, storage);
      expect(startupChatRoute(hash, storage)).toBeNull();
      expect(storage.getItem(LAST_CHAT_KEY)).toBe(routeHash(chat));
    },
  );

  it('does not replace the last confirmed chat with a failed or pending link', () => {
    const storage = memoryStorage();
    rememberChatSelection(chat, chat, storage);
    const pending = { kind: 'chat' as const, namespace: 'missing', sessionId: 'missing' };
    rememberChatSelection(pending, chat, storage);
    rememberChatSelection(pending, null, storage);
    expect(startupChatRoute('', storage)).toEqual(chat);
  });

  it('keeps selection through settings but respects explicitly choosing New chat', () => {
    const storage = memoryStorage();
    rememberChatSelection(chat, chat, storage);
    rememberChatSelection({ kind: 'settings' }, chat, storage);
    expect(startupChatRoute('', storage)).toEqual(chat);
    rememberChatSelection({ kind: 'new' }, chat, storage);
    expect(startupChatRoute('', storage)).toBeNull();
  });

  it('does not save temporary direct connections', () => {
    const storage = memoryStorage();
    const direct = { kind: 'chat' as const, namespace: 'direct:temporary', sessionId: '1' };
    rememberChatSelection(direct, direct, storage);
    expect(startupChatRoute('', storage)).toBeNull();
  });

  it.each([null, '', 'broken', '#/new', '#/chat/missing', '#/chat/family/%E0%A4%A', '#/chat/direct%3Atemporary/1'])(
    'starts normally when saved selection is %j', (saved) => {
      const storage = memoryStorage();
      if (saved !== null) storage.setItem(LAST_CHAT_KEY, saved);
      expect(startupChatRoute('', storage)).toBeNull();
    },
  );

  it('starts normally when storage is blocked or full', () => {
    const blocked = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('full'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(startupChatRoute('', blocked)).toBeNull();
      expect(() => rememberChatSelection(chat, chat, blocked)).not.toThrow();
      expect(() => rememberChatSelection({ kind: 'new' }, null, blocked)).not.toThrow();
    } finally { warn.mockRestore(); }
  });
});

describe('opening a recovered chat', () => {
  it('keeps the same saved chat after offline failure and reopens it on Retry', async () => {
    const storage = memoryStorage();
    rememberChatSelection(chat, chat, storage);
    const requested = startupChatRoute('', storage)!;
    const open = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const failed = vi.fn();
    beginChatRecovery(requested, open, failed);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(startupChatRoute('', storage)).toEqual(chat);
    beginChatRecovery(requested, open, failed);
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls.map(([id]) => id)).toEqual([chat, chat]);
    expect(failed).toHaveBeenCalledOnce();
  });

  it('settles a rejected load as a retryable failure', async () => {
    const failed = vi.fn();
    beginChatRecovery(chat, async () => { throw new Error('offline'); }, failed);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  });

  it('ignores a late failure when the user has moved to another route', async () => {
    let resolve!: (ok: boolean) => void;
    const failed = vi.fn();
    const open = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const cancel = beginChatRecovery(chat, open, failed);
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    cancel();
    resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
  });

  it('does not open a chat if its effect was already cleaned up', async () => {
    const open = vi.fn(async () => true);
    beginChatRecovery(chat, open, vi.fn())();
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
  });
});
