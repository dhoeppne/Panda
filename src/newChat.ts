import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { loadProfiles, subscribeProfiles, type AgentProfile } from './profiles';
import { onRemoteChange, syncedStorage } from './settingsSync';

/**
 * The new-chat view (sidebar navigation): open while the user writes the
 * first message of a chat that does not exist yet. The chat is created on
 * the first send, on the family the picker names. `familyId` is a profile
 * id; the last pick is remembered per browser so the next new chat starts
 * on the same family.
 *
 * The view itself is a route now (#/new, ADR 0010). This store holds the
 * family the picker names, and nothing else.
 */
type NewChatState = {
  familyId: string | null;
  /** Preselects a family (the settings CTA adds one and opens the view). */
  pick(familyId: string): void;
};

const LAST_FAMILY_KEY = 'panda.lastFamily';

// Without localStorage (node tests) both helpers stay no-ops, as before sync.
function readLastFamily(): string | null {
  try {
    return globalThis.localStorage ? syncedStorage.getItem(LAST_FAMILY_KEY) : null;
  } catch {
    return null;
  }
}

function writeLastFamily(familyId: string): void {
  try {
    if (globalThis.localStorage) syncedStorage.setItem(LAST_FAMILY_KEY, familyId);
  } catch (err) {
    console.warn('[panda/new-chat] could not remember the last family', err);
  }
}

export const useNewChat = create<NewChatState>((set) => ({
  familyId: readLastFamily(),
  pick: (familyId) => {
    writeLastFamily(familyId);
    set({ familyId });
  },
}));

// A pull from the settings store replaced the remembered family (settingsSync.ts).
onRemoteChange('panda.lastFamily', () => useNewChat.setState({ familyId: readLastFamily() }));

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
