import { create } from 'zustand';
import { profileIdOfConnection } from './chatId';
import type { FileAttachment } from './attachments';

/**
 * Composer drafts, keyed by foreground session (bug hunt #15): the composer
 * is a single instance across the app, but a message composed for one
 * session must never be sent to another. The key swaps whenever the
 * foreground does. Saved-family drafts use a stable family/session key;
 * their text survives restart. Attachments and errors stay in memory.
 */

export type ComposerDraft = {
  value: string;
  attachments: FileAttachment[];
  attachmentError: string | null;
};

/** Draft identity of a foreground session: the (connection, session) pair. */
export function composerDraftKey(connectionId: string, sessionId: string | null): string {
  return `${connectionId}::${sessionId ?? 'none'}`;
}

/** A draft follows its logical family/session even when the live connection changes. */
export function stableComposerDraftKey(connectionId: string, sessionId: string | null): string {
  return composerDraftKey(profileIdOfConnection(connectionId) ?? connectionId, sessionId);
}

/** New-chat drafts belong to their selected family, not the shared new-chat view. */
export function newChatDraftKey(familyId: string): string {
  return composerDraftKey(`new-chat:${familyId}`, null);
}

export const TEXT_DRAFTS_KEY = 'panda.textDrafts';
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function durableKey(key: string): boolean {
  const separator = key.indexOf('::');
  if (separator < 1 || key.slice(separator + 2) === '') return false;
  const owner = key.slice(0, separator);
  return !owner.includes('#') && !owner.startsWith('direct:') &&
    owner !== 'none' && owner !== 'new-chat' && owner !== 'new-chat:none';
}

function readTexts(storage: DraftStorage | undefined): Record<string, string> {
  const raw = storage?.getItem(TEXT_DRAFTS_KEY);
  if (!raw) return {};
  let saved: unknown;
  try { saved = JSON.parse(raw); } catch { return {}; }
  if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1 ||
      !('drafts' in saved) || !saved.drafts || typeof saved.drafts !== 'object' || Array.isArray(saved.drafts)) return {};
  return Object.fromEntries(Object.entries(saved.drafts).filter(
    ([key, value]) => durableKey(key) && typeof value === 'string' && value.length > 0,
  ));
}

const NO_DRAFT: ComposerDraft = { value: '', attachments: [], attachmentError: null };

interface ComposerDraftsState {
  drafts: Record<string, ComposerDraft>;
  setDraft: (key: string, patch: Partial<ComposerDraft>) => void;
  clearDraft: (key: string) => void;
  /** Delete a session's draft in its family; the optional legacy form clears all matching sessions. */
  clearSessionDrafts: (sessionId: string, connectionId?: string) => void;
}

/** Injectable storage lets tests simulate separate app launches without browser globals. */
export function createComposerDraftStore(providedStorage?: DraftStorage) {
  const storage = () => providedStorage ?? globalThis.localStorage;
  let texts: Record<string, string> = {};
  try { texts = readTexts(storage()); } catch { /* Storage unavailable or malformed. */ }
  const initial = Object.fromEntries(Object.entries(texts).map(([key, value]) =>
    [key, { value, attachments: [], attachmentError: null } satisfies ComposerDraft],
  ));

  const persist = (update: (saved: Record<string, string>) => void) => {
    try {
      const target = storage();
      if (!target) return;
      // Read fresh so editing one chat does not overwrite another window's drafts.
      const saved = readTexts(target);
      update(saved);
      if (Object.keys(saved).length === 0) target.removeItem(TEXT_DRAFTS_KEY);
      else target.setItem(TEXT_DRAFTS_KEY, JSON.stringify({ version: 1, drafts: saved }));
    } catch {
      console.warn('[panda/drafts] could not save text drafts on this device');
    }
  };

  return create<ComposerDraftsState>((set, get) => ({
    drafts: initial,
    setDraft: (key, patch) => {
      const draft = { ...draftOf(get(), key), ...patch };
      set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
      if (durableKey(key) && 'value' in patch) persist((saved) => {
        if (draft.value) saved[key] = draft.value;
        else delete saved[key];
      });
    },
    clearDraft: (key) => {
      set((s) => {
        if (!(key in s.drafts)) return s;
        const drafts = { ...s.drafts };
        delete drafts[key];
        return { drafts };
      });
      if (durableKey(key)) persist((saved) => { delete saved[key]; });
    },
    clearSessionDrafts: (sessionId, connectionId) => {
      const exact = connectionId === undefined ? null : stableComposerDraftKey(connectionId, sessionId);
      const matches = (key: string) => exact === null ? key.endsWith(`::${sessionId}`) : key === exact;
      set((s) => ({ drafts: Object.fromEntries(Object.entries(s.drafts).filter(([key]) => !matches(key))) }));
      persist((saved) => {
        for (const key of Object.keys(saved)) if (matches(key)) delete saved[key];
      });
    },
  }));
}

export const useComposerDrafts = createComposerDraftStore();

function draftOf(s: ComposerDraftsState, key: string): ComposerDraft {
  return s.drafts[key] ?? NO_DRAFT;
}

/** Stable read for the composer render (a missing key must not produce a
 * fresh object per render — zustand selectors compare by identity). */
export function draftForKey(s: ComposerDraftsState, key: string): ComposerDraft {
  return draftOf(s, key);
}
