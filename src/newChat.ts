import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { loadProfiles, subscribeProfiles, type AgentProfile } from './profiles';

/**
 * The new-chat view (sidebar navigation): open while the user writes the
 * first message of a chat that does not exist yet. The chat is created on
 * the first send, on the family the picker names. `familyId` is a profile
 * id; the last pick is remembered per browser so the next new chat starts
 * on the same family.
 */
type NewChatState = {
  open: boolean;
  familyId: string | null;
  /** Opens the view; a family id preselects that family (settings CTA). */
  start(familyId?: string): void;
  pick(familyId: string): void;
  close(): void;
};

const LAST_FAMILY_KEY = 'panda.lastFamily';

function readLastFamily(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_FAMILY_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLastFamily(familyId: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_FAMILY_KEY, familyId);
  } catch (err) {
    console.warn('[panda/new-chat] could not remember the last family', err);
  }
}

export const useNewChat = create<NewChatState>((set) => ({
  open: false,
  familyId: readLastFamily(),
  start: (familyId) => {
    if (familyId) writeLastFamily(familyId);
    set((s) => ({ open: true, familyId: familyId ?? s.familyId }));
  },
  pick: (familyId) => {
    writeLastFamily(familyId);
    set({ familyId });
  },
  close: () => set({ open: false }),
}));

/** The family a new chat goes to: the remembered pick when it still exists,
 * else the first saved family. Null only with no families at all. */
export function resolveNewChatFamily(familyId: string | null, profiles: AgentProfile[]): AgentProfile | null {
  return profiles.find((profile) => profile.id === familyId) ?? profiles[0] ?? null;
}

/** The saved families (Agent profiles), kept current with storage. */
export function useProfiles(): AgentProfile[] {
  const [profiles, setProfiles] = useState<AgentProfile[]>(() => loadProfiles());
  useEffect(() => subscribeProfiles(setProfiles), []);
  return profiles;
}
