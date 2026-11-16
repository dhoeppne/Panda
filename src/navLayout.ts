/**
 * Sidebar navigation layout: the user's sections, folders, pins and local
 * titles over the one merged chat list. Sessions live with their agents;
 * only the PLACEMENT of a session is Panda's, so the layout is pure data
 * keyed by `navKey(endpoint, sessionId)` — the endpoint, not the per-browser
 * profile id, so the same chat has the same key on every device.
 *
 * Persisted per browser in localStorage (`panda.nav`), with the same
 * injected-storage and subscribe contract as profiles.ts. A synced store can
 * replace load/save later without touching the sidebar.
 */
import { onRemoteChange, syncedStorage } from './settingsSync';
import { randomUuid } from './uuid';

export type NavFolder = { id: string; name: string; collapsed: boolean };
export type NavSection = { id: string; name: string; collapsed: boolean; folders: NavFolder[] };

/** Where one chat sits. A chat with no placement is in Recents. */
export type NavPlacement =
  | { kind: 'pinned' }
  | { kind: 'section'; sectionId: string; folderId: string | null };

export type NavLayout = {
  sections: NavSection[];
  placements: Record<string, NavPlacement>;
  /** Local titles from Rename: ACP has no rename method. */
  titles: Record<string, string>;
  pinnedCollapsed: boolean;
  recentsCollapsed: boolean;
};

export const EMPTY_NAV_LAYOUT: NavLayout = {
  sections: [],
  placements: {},
  titles: {},
  pinnedCollapsed: false,
  recentsCollapsed: false,
};

/** One chat's layout key. A newline never occurs in an endpoint or an ACP session id. */
export function navKey(endpoint: string, sessionId: string): string {
  return `${endpoint}\n${sessionId}`;
}

export function newNavId(): string {
  return randomUuid();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface NavStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const NAV_KEY = 'panda.nav';

type NavListener = (layout: NavLayout) => void;
const listeners = new Set<NavListener>();

export function subscribeNavLayout(listener: NavListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function defaultStorage(): NavStorage {
  return syncedStorage;
}

// A pull from the settings store replaced the stored layout (settingsSync.ts).
onRemoteChange('panda.nav', () => {
  const layout = loadNavLayout(defaultStorage());
  for (const listener of listeners) listener(layout);
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function readFolder(value: unknown): NavFolder | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.name)) return null;
  return { id: value.id, name: value.name, collapsed: value.collapsed === true };
}

function readSection(value: unknown): NavSection | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.name)) return null;
  const folders = Array.isArray(value.folders)
    ? value.folders.map(readFolder).filter((folder): folder is NavFolder => folder !== null)
    : [];
  return { id: value.id, name: value.name, collapsed: value.collapsed === true, folders };
}

function readPlacement(value: unknown): NavPlacement | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'pinned') return { kind: 'pinned' };
  if (value.kind === 'section' && isNonEmptyString(value.sectionId)) {
    return {
      kind: 'section',
      sectionId: value.sectionId,
      folderId: isNonEmptyString(value.folderId) ? value.folderId : null,
    };
  }
  return null;
}

/** Validates stored JSON field by field. Malformed parts are dropped loudly;
 * the rest of the layout survives. */
export function parseNavLayout(raw: string): NavLayout {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('[panda/nav] layout storage is not JSON — starting empty', err);
    return EMPTY_NAV_LAYOUT;
  }
  if (!isRecord(parsed)) {
    console.warn('[panda/nav] layout storage is not an object — starting empty');
    return EMPTY_NAV_LAYOUT;
  }
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.map(readSection).filter((section): section is NavSection => section !== null)
    : [];
  const placements: Record<string, NavPlacement> = {};
  if (isRecord(parsed.placements)) {
    for (const [key, value] of Object.entries(parsed.placements)) {
      const placement = readPlacement(value);
      if (placement) placements[key] = placement;
      else console.warn(`[panda/nav] malformed placement dropped: ${JSON.stringify(value)}`);
    }
  }
  const titles: Record<string, string> = {};
  if (isRecord(parsed.titles)) {
    for (const [key, value] of Object.entries(parsed.titles)) {
      if (isNonEmptyString(value)) titles[key] = value;
    }
  }
  return {
    sections,
    placements,
    titles,
    pinnedCollapsed: parsed.pinnedCollapsed === true,
    recentsCollapsed: parsed.recentsCollapsed === true,
  };
}

export function loadNavLayout(storage: NavStorage = defaultStorage()): NavLayout {
  let raw: string | null;
  try {
    raw = storage.getItem(NAV_KEY);
  } catch (err) {
    console.warn('[panda/nav] could not read the layout', err);
    return EMPTY_NAV_LAYOUT;
  }
  return raw === null ? EMPTY_NAV_LAYOUT : parseNavLayout(raw);
}

/** Persists the layout and notifies subscribers. Returns false when storage
 * rejected the write; the caller tells the user. */
export function saveNavLayout(layout: NavLayout, storage: NavStorage = defaultStorage()): boolean {
  try {
    storage.setItem(NAV_KEY, JSON.stringify(layout));
  } catch (err) {
    console.warn('[panda/nav] could not persist the layout', err);
    return false;
  }
  for (const listener of listeners) listener(layout);
  return true;
}

// ---------------------------------------------------------------------------
// Pure edits. Each returns a new layout and leaves the input unchanged.
// ---------------------------------------------------------------------------

export function addSection(layout: NavLayout, id: string, name: string): NavLayout {
  return { ...layout, sections: [...layout.sections, { id, name, collapsed: false, folders: [] }] };
}

export function renameSection(layout: NavLayout, sectionId: string, name: string): NavLayout {
  return {
    ...layout,
    sections: layout.sections.map((section) => (section.id === sectionId ? { ...section, name } : section)),
  };
}

/** Removes a section. Its chats return to Recents. */
export function removeSection(layout: NavLayout, sectionId: string): NavLayout {
  const placements = Object.fromEntries(
    Object.entries(layout.placements).filter(
      ([, placement]) => !(placement.kind === 'section' && placement.sectionId === sectionId),
    ),
  );
  return { ...layout, sections: layout.sections.filter((section) => section.id !== sectionId), placements };
}

export function toggleSection(layout: NavLayout, sectionId: string): NavLayout {
  return {
    ...layout,
    sections: layout.sections.map((section) =>
      section.id === sectionId ? { ...section, collapsed: !section.collapsed } : section,
    ),
  };
}

export function addFolder(layout: NavLayout, sectionId: string, id: string, name: string): NavLayout {
  return {
    ...layout,
    sections: layout.sections.map((section) =>
      section.id === sectionId
        ? { ...section, collapsed: false, folders: [...section.folders, { id, name, collapsed: false }] }
        : section,
    ),
  };
}

function mapFolder(layout: NavLayout, sectionId: string, folderId: string, fn: (folder: NavFolder) => NavFolder): NavLayout {
  return {
    ...layout,
    sections: layout.sections.map((section) =>
      section.id === sectionId
        ? { ...section, folders: section.folders.map((folder) => (folder.id === folderId ? fn(folder) : folder)) }
        : section,
    ),
  };
}

export function renameFolder(layout: NavLayout, sectionId: string, folderId: string, name: string): NavLayout {
  return mapFolder(layout, sectionId, folderId, (folder) => ({ ...folder, name }));
}

export function toggleFolder(layout: NavLayout, sectionId: string, folderId: string): NavLayout {
  return mapFolder(layout, sectionId, folderId, (folder) => ({ ...folder, collapsed: !folder.collapsed }));
}

/** Removes a folder. Its chats stay in the section, outside any folder. */
export function removeFolder(layout: NavLayout, sectionId: string, folderId: string): NavLayout {
  const placements: Record<string, NavPlacement> = {};
  for (const [key, placement] of Object.entries(layout.placements)) {
    placements[key] =
      placement.kind === 'section' && placement.sectionId === sectionId && placement.folderId === folderId
        ? { kind: 'section', sectionId, folderId: null }
        : placement;
  }
  return {
    ...layout,
    placements,
    sections: layout.sections.map((section) =>
      section.id === sectionId ? { ...section, folders: section.folders.filter((folder) => folder.id !== folderId) } : section,
    ),
  };
}

/** Places one chat. `null` returns it to Recents. */
export function placeChat(layout: NavLayout, key: string, placement: NavPlacement | null): NavLayout {
  const placements = { ...layout.placements };
  if (placement === null) delete placements[key];
  else placements[key] = placement;
  return { ...layout, placements };
}

/** Sets a local title. A blank title removes the override. */
export function setChatTitle(layout: NavLayout, key: string, title: string): NavLayout {
  const titles = { ...layout.titles };
  const trimmed = title.trim();
  if (trimmed) titles[key] = trimmed;
  else delete titles[key];
  return { ...layout, titles };
}

/** Drops every trace of one chat (after session/delete). */
export function forgetChat(layout: NavLayout, key: string): NavLayout {
  const placements = { ...layout.placements };
  const titles = { ...layout.titles };
  delete placements[key];
  delete titles[key];
  return { ...layout, placements, titles };
}

// ---------------------------------------------------------------------------
// The tree the sidebar renders
// ---------------------------------------------------------------------------

/** One chat of the merged list, from any family connection. */
export type NavRow = {
  key: string;
  connectionId: string;
  sessionId: string;
  cwd: string;
  updatedAt: string | null;
};

export type RecencyBucket = 'today' | 'yesterday' | 'week' | 'older';

export type NavTree<R extends NavRow> = {
  pinned: R[];
  sections: Array<{
    section: NavSection;
    folders: Array<{ folder: NavFolder; rows: R[] }>;
    loose: R[];
  }>;
  recents: Array<{ bucket: RecencyBucket; rows: R[] }>;
};

/** Most recent first; no timestamp sorts last; ties by key so order is stable. */
export function byRecency(a: NavRow, b: NavRow): number {
  const byTime = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  return byTime !== 0 ? byTime : a.key.localeCompare(b.key);
}

/** Calendar buckets in local time: today, yesterday, the 7 days before, older. */
export function recencyBucket(updatedAt: string | null, now: Date): RecencyBucket {
  if (updatedAt === null) return 'older';
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return 'older';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const time = at.getTime();
  if (time >= startOfToday) return 'today';
  if (time >= startOfToday - day) return 'yesterday';
  if (time >= startOfToday - 7 * day) return 'week';
  return 'older';
}

const BUCKET_ORDER: RecencyBucket[] = ['today', 'yesterday', 'week', 'older'];

/**
 * Sorts the merged rows into Pinned, sections (folders, then loose chats)
 * and Recents. A placement that names a section or folder that no longer
 * exists falls back: a lost folder to its section, a lost section to Recents.
 */
export function buildNavTree<R extends NavRow>(rows: R[], layout: NavLayout, now: Date): NavTree<R> {
  const sorted = [...rows].sort(byRecency);
  const sectionIds = new Set(layout.sections.map((section) => section.id));
  const pinned: R[] = [];
  const bySection = new Map<string, R[]>();
  const byFolder = new Map<string, R[]>();
  const recentRows: R[] = [];
  for (const row of sorted) {
    const placement = layout.placements[row.key];
    if (placement?.kind === 'pinned') {
      pinned.push(row);
    } else if (placement?.kind === 'section' && sectionIds.has(placement.sectionId)) {
      const section = layout.sections.find((entry) => entry.id === placement.sectionId);
      const folderKnown = placement.folderId !== null && section?.folders.some((folder) => folder.id === placement.folderId);
      if (folderKnown) {
        const folderKey = `${placement.sectionId}/${placement.folderId}`;
        byFolder.set(folderKey, [...(byFolder.get(folderKey) ?? []), row]);
      } else {
        bySection.set(placement.sectionId, [...(bySection.get(placement.sectionId) ?? []), row]);
      }
    } else {
      recentRows.push(row);
    }
  }
  const recents = BUCKET_ORDER.map((bucket) => ({
    bucket,
    rows: recentRows.filter((row) => recencyBucket(row.updatedAt, now) === bucket),
  })).filter((group) => group.rows.length > 0);
  return {
    pinned,
    sections: layout.sections.map((section) => ({
      section,
      folders: section.folders.map((folder) => ({ folder, rows: byFolder.get(`${section.id}/${folder.id}`) ?? [] })),
      loose: bySection.get(section.id) ?? [],
    })),
    recents,
  };
}

/**
 * A family's badge: the shortest prefix of its name that no other family
 * name starts with (principal → P, code → Co, creche → Cr). Works for any
 * number of families; a name that is a prefix of another gets the whole name.
 */
export function familyGlyph(name: string, allNames: readonly string[]): string {
  const others = allNames.filter((other) => other !== name).map((other) => other.toLowerCase());
  const lower = name.toLowerCase();
  for (let length = 1; length <= name.length; length++) {
    const prefix = lower.slice(0, length);
    if (!others.some((other) => other.startsWith(prefix))) {
      const glyph = name.slice(0, length);
      return glyph.charAt(0).toUpperCase() + glyph.slice(1);
    }
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}
