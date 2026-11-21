import { describe, expect, it, vi } from 'vitest';
import {
  createComposerDraftStore, draftForKey, newChatDraftKey, stableComposerDraftKey, TEXT_DRAFTS_KEY,
} from './composerDrafts';
import { SYNCED_KEYS } from './settingsSync';
import { connectionStorePort, usePanda } from './store';
import { useComposerDrafts } from './composerDrafts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('text draft recovery across app launches', () => {
  it('restores exact text on the same family/session but strips attachments and errors', () => {
    const storage = memoryStorage();
    const first = createComposerDraftStore(storage);
    const key = stableComposerDraftKey('family#2', 'session/1');
    const text = '  unsent text\n日本語\n';
    first.getState().setDraft(key, {
      value: text,
      attachments: [{ id: 'secret-file', name: 'private.png', mimeType: 'image/png', data: 'AAAA', size: 3 }],
      attachmentError: 'temporary error',
    });
    const second = createComposerDraftStore(storage);
    expect(draftForKey(second.getState(), stableComposerDraftKey('family', 'session/1'))).toEqual({
      value: text, attachments: [], attachmentError: null,
    });
    const saved = storage.getItem(TEXT_DRAFTS_KEY)!;
    expect(saved).not.toContain('private.png');
    expect(saved).not.toContain('AAAA');
    expect(saved).not.toContain('temporary error');
    expect(SYNCED_KEYS as readonly string[]).not.toContain(TEXT_DRAFTS_KEY);
  });

  it('keeps families and sessions separate even when session ids coincide', () => {
    const storage = memoryStorage();
    const first = createComposerDraftStore(storage);
    first.getState().setDraft(stableComposerDraftKey('a', 'one'), { value: 'A one' });
    first.getState().setDraft(stableComposerDraftKey('a#3', 'two'), { value: 'A two' });
    first.getState().setDraft(stableComposerDraftKey('b', 'one'), { value: 'B one' });
    const second = createComposerDraftStore(storage);
    expect(draftForKey(second.getState(), stableComposerDraftKey('a#9', 'one')).value).toBe('A one');
    expect(draftForKey(second.getState(), stableComposerDraftKey('a', 'two')).value).toBe('A two');
    expect(draftForKey(second.getState(), stableComposerDraftKey('b', 'one')).value).toBe('B one');
  });

  it('restores a separate new-chat draft for each selected family', () => {
    const storage = memoryStorage();
    const first = createComposerDraftStore(storage);
    first.getState().setDraft(newChatDraftKey('a'), { value: 'new for A' });
    first.getState().setDraft(newChatDraftKey('b'), { value: 'new for B' });
    first.getState().setDraft(stableComposerDraftKey('a', 'none'), { value: 'existing chat' });
    const second = createComposerDraftStore(storage);
    expect(draftForKey(second.getState(), newChatDraftKey('a')).value).toBe('new for A');
    expect(draftForKey(second.getState(), newChatDraftKey('b')).value).toBe('new for B');
    expect(draftForKey(second.getState(), stableComposerDraftKey('a', 'none')).value).toBe('existing chat');
  });

  it('does not resurrect a cleared/submitted draft', () => {
    const storage = memoryStorage();
    const first = createComposerDraftStore(storage);
    const key = stableComposerDraftKey('a', 'one');
    first.getState().setDraft(key, { value: 'to send' });
    first.getState().clearDraft(key);
    expect(draftForKey(createComposerDraftStore(storage).getState(), key).value).toBe('');
    expect(storage.getItem(TEXT_DRAFTS_KEY)).toBeNull();
  });

  it('removes a saved draft when its text is erased, while attachments stay in memory', () => {
    const storage = memoryStorage();
    const first = createComposerDraftStore(storage);
    const key = stableComposerDraftKey('a', 'one');
    first.getState().setDraft(key, { value: 'erase me', attachments: [
      { id: 'file', name: 'file.txt', mimeType: 'text/plain', data: 'AAAA', size: 3 },
    ] });
    first.getState().setDraft(key, { value: '' });
    expect(createComposerDraftStore(storage).getState().drafts[key]).toBeUndefined();
    expect(draftForKey(first.getState(), key).attachments).toHaveLength(1);
  });

  it('deletes the matching family/session without deleting another family or a session prefix', () => {
    const storage = memoryStorage();
    const first = createComposerDraftStore(storage);
    for (const [family, session, value] of [['a', 'one', 'delete'], ['b', 'one', 'keep B'], ['a', 'one-more', 'keep A']]) {
      first.getState().setDraft(stableComposerDraftKey(family!, session!), { value: value! });
    }
    first.getState().clearSessionDrafts('one', 'a#2');
    const second = createComposerDraftStore(storage);
    expect(second.getState().drafts[stableComposerDraftKey('a', 'one')]).toBeUndefined();
    expect(draftForKey(second.getState(), stableComposerDraftKey('b', 'one')).value).toBe('keep B');
    expect(draftForKey(second.getState(), stableComposerDraftKey('a', 'one-more')).value).toBe('keep A');
  });

  it('does not persist direct connections or unstable connection keys', () => {
    const storage = memoryStorage();
    const first = createComposerDraftStore(storage);
    for (const key of ['direct:temporary::one', 'a#2::one', 'none::none', newChatDraftKey('none')]) {
      first.getState().setDraft(key, { value: 'temporary' });
    }
    expect(storage.getItem(TEXT_DRAFTS_KEY)).toBeNull();
  });

  it('clears persisted text through the real session-deletion path, scoped to the family', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    useComposerDrafts.setState({ drafts: {} });
    usePanda.getState().ensureConnection('delete-family#2');
    try {
      const deleted = stableComposerDraftKey('delete-family#2', 'shared-session');
      const kept = stableComposerDraftKey('keep-family', 'shared-session');
      useComposerDrafts.getState().setDraft(deleted, { value: 'delete me' });
      useComposerDrafts.getState().setDraft(kept, { value: 'keep me' });
      connectionStorePort('delete-family#2').removeSession('shared-session');
      const restarted = createComposerDraftStore(storage);
      expect(restarted.getState().drafts[deleted]).toBeUndefined();
      expect(draftForKey(restarted.getState(), kept).value).toBe('keep me');
    } finally {
      useComposerDrafts.setState({ drafts: {} });
      vi.unstubAllGlobals();
    }
  });

  it('preserves a different window’s draft when another chat changes', () => {
    const storage = memoryStorage();
    const first = createComposerDraftStore(storage);
    const second = createComposerDraftStore(storage);
    first.getState().setDraft(stableComposerDraftKey('a', 'one'), { value: 'first window' });
    second.getState().setDraft(stableComposerDraftKey('b', 'one'), { value: 'second window' });
    first.getState().setDraft(stableComposerDraftKey('a', 'one'), { value: 'edited' });
    const third = createComposerDraftStore(storage);
    expect(draftForKey(third.getState(), stableComposerDraftKey('a', 'one')).value).toBe('edited');
    expect(draftForKey(third.getState(), stableComposerDraftKey('b', 'one')).value).toBe('second window');
  });

  it.each(['bad json', '[]', '{"version":99,"drafts":{}}', '{"version":1,"drafts":null}'])(
    'ignores malformed or unsupported storage: %s', (raw) => {
      const storage = memoryStorage();
      storage.setItem(TEXT_DRAFTS_KEY, raw);
      expect(createComposerDraftStore(storage).getState().drafts).toEqual({});
    },
  );

  it('validates stored entries and restores only text', () => {
    const storage = memoryStorage();
    storage.setItem(TEXT_DRAFTS_KEY, JSON.stringify({ version: 1, drafts: {
      'a::one': 'valid', 'a::two': { value: 'invalid object' },
      'direct:temporary::one': 'temporary', 'a#2::one': 'unstable', 'a::empty': '',
    } }));
    expect(Object.keys(createComposerDraftStore(storage).getState().drafts)).toEqual(['a::one']);
  });

  it('keeps editing usable when writes fail and does not overwrite unreadable storage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const write = vi.fn();
      const unreadable = createComposerDraftStore({ getItem: () => { throw new Error('denied'); }, setItem: write, removeItem: vi.fn() });
      unreadable.getState().setDraft('a::one', { value: 'keep in memory' });
      expect(draftForKey(unreadable.getState(), 'a::one').value).toBe('keep in memory');
      expect(write).not.toHaveBeenCalled();
      const full = createComposerDraftStore({ getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: vi.fn() });
      expect(() => full.getState().setDraft('a::one', { value: 'also in memory' })).not.toThrow();
      expect(draftForKey(full.getState(), 'a::one').value).toBe('also in memory');
    } finally { warn.mockRestore(); }
  });
});
