import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_NAV_LAYOUT,
  addFolder,
  addSection,
  buildNavTree,
  familyGlyph,
  forgetChat,
  loadNavLayout,
  navKey,
  parseNavLayout,
  placeChat,
  recencyBucket,
  removeFolder,
  removeSection,
  saveNavLayout,
  setChatTitle,
  subscribeNavLayout,
  toggleSection,
  type NavLayout,
  type NavRow,
  type NavStorage,
} from './navLayout';

function memoryStorage(initial: Record<string, string> = {}): NavStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const NOW = new Date(2026, 10, 15, 15, 0, 0);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString();

const row = (sessionId: string, updatedAt: string | null, endpoint = 'wss://door/principal'): NavRow => ({
  key: navKey(endpoint, sessionId),
  connectionId: endpoint,
  sessionId,
  cwd: '/',
  updatedAt,
});

function layoutWithSection(): NavLayout {
  let layout = addSection(EMPTY_NAV_LAYOUT, 's1', 'Lacreche');
  layout = addFolder(layout, 's1', 'f1', 'Panda');
  return layout;
}

describe('navKey', () => {
  it('keys a chat by endpoint and session id, so every device agrees', () => {
    expect(navKey('wss://door/code', 'abc')).toBe('wss://door/code\nabc');
    expect(navKey('wss://door/code', 'abc')).not.toBe(navKey('wss://door/creche', 'abc'));
  });
});

describe('persistence', () => {
  it('round-trips a layout through storage and notifies subscribers', () => {
    const storage = memoryStorage();
    const seen: NavLayout[] = [];
    const unsubscribe = subscribeNavLayout((layout) => seen.push(layout));
    const layout = placeChat(layoutWithSection(), 'k', { kind: 'section', sectionId: 's1', folderId: 'f1' });
    expect(saveNavLayout(layout, storage)).toBe(true);
    unsubscribe();
    expect(seen).toEqual([layout]);
    expect(loadNavLayout(storage)).toEqual(layout);
  });

  it('starts empty when nothing is stored or storage throws', () => {
    expect(loadNavLayout(memoryStorage())).toEqual(EMPTY_NAV_LAYOUT);
    const throwing: NavStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadNavLayout(throwing)).toEqual(EMPTY_NAV_LAYOUT);
    warn.mockRestore();
  });

  it('reports a rejected write instead of throwing', () => {
    const full: NavStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(saveNavLayout(EMPTY_NAV_LAYOUT, full)).toBe(false);
    warn.mockRestore();
  });

  it('drops malformed parts and keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const layout = parseNavLayout(
      JSON.stringify({
        sections: [{ id: 's1', name: 'Home', folders: [{ id: '', name: 'x' }, { id: 'f1', name: 'House', collapsed: true }] }, { name: 'no id' }],
        placements: { a: { kind: 'pinned' }, b: { kind: 'section' }, c: { kind: 'section', sectionId: 's1' } },
        titles: { a: 'Mine', b: 7 },
      }),
    );
    warn.mockRestore();
    expect(layout.sections).toEqual([
      { id: 's1', name: 'Home', collapsed: false, folders: [{ id: 'f1', name: 'House', collapsed: true }] },
    ]);
    expect(layout.placements).toEqual({ a: { kind: 'pinned' }, c: { kind: 'section', sectionId: 's1', folderId: null } });
    expect(layout.titles).toEqual({ a: 'Mine' });
  });

  it('starts empty on JSON that is not an object', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseNavLayout('[1]')).toEqual(EMPTY_NAV_LAYOUT);
    expect(parseNavLayout('{oops')).toEqual(EMPTY_NAV_LAYOUT);
    warn.mockRestore();
  });
});

describe('edits', () => {
  it('removing a section returns its chats to Recents', () => {
    let layout = placeChat(layoutWithSection(), 'k1', { kind: 'section', sectionId: 's1', folderId: 'f1' });
    layout = placeChat(layout, 'k2', { kind: 'pinned' });
    layout = removeSection(layout, 's1');
    expect(layout.sections).toEqual([]);
    expect(layout.placements).toEqual({ k2: { kind: 'pinned' } });
  });

  it('removing a folder keeps its chats in the section', () => {
    let layout = placeChat(layoutWithSection(), 'k1', { kind: 'section', sectionId: 's1', folderId: 'f1' });
    layout = removeFolder(layout, 's1', 'f1');
    expect(layout.sections[0]?.folders).toEqual([]);
    expect(layout.placements.k1).toEqual({ kind: 'section', sectionId: 's1', folderId: null });
  });

  it('adding a folder opens a collapsed section', () => {
    const collapsed = toggleSection(addSection(EMPTY_NAV_LAYOUT, 's1', 'Home'), 's1');
    expect(collapsed.sections[0]?.collapsed).toBe(true);
    expect(addFolder(collapsed, 's1', 'f1', 'House').sections[0]?.collapsed).toBe(false);
  });

  it('placing null returns a chat to Recents; a blank title clears the override', () => {
    let layout = placeChat(EMPTY_NAV_LAYOUT, 'k', { kind: 'pinned' });
    layout = placeChat(layout, 'k', null);
    expect(layout.placements).toEqual({});
    layout = setChatTitle(layout, 'k', '  Trip  ');
    expect(layout.titles).toEqual({ k: 'Trip' });
    expect(setChatTitle(layout, 'k', '  ').titles).toEqual({});
  });

  it('forgetting a chat drops its placement and title', () => {
    let layout = placeChat(EMPTY_NAV_LAYOUT, 'k', { kind: 'pinned' });
    layout = setChatTitle(layout, 'k', 'x');
    expect(forgetChat(layout, 'k')).toEqual(EMPTY_NAV_LAYOUT);
  });
});

describe('recencyBucket', () => {
  it('buckets by local calendar day', () => {
    expect(recencyBucket(hoursAgo(1), NOW)).toBe('today');
    expect(recencyBucket(hoursAgo(20), NOW)).toBe('yesterday');
    expect(recencyBucket(hoursAgo(24 * 4), NOW)).toBe('week');
    expect(recencyBucket(hoursAgo(24 * 30), NOW)).toBe('older');
    expect(recencyBucket(null, NOW)).toBe('older');
    expect(recencyBucket('not a date', NOW)).toBe('older');
  });
});

describe('buildNavTree', () => {
  it('merges rows of several families into pinned, sections and dated recents', () => {
    let layout = layoutWithSection();
    const pinned = row('p', hoursAgo(30), 'wss://door/creche');
    const inFolder = row('f', hoursAgo(2), 'wss://door/code');
    const loose = row('l', hoursAgo(5));
    const today = row('t', hoursAgo(1));
    const old = row('o', hoursAgo(24 * 40), 'wss://door/code');
    layout = placeChat(layout, pinned.key, { kind: 'pinned' });
    layout = placeChat(layout, inFolder.key, { kind: 'section', sectionId: 's1', folderId: 'f1' });
    layout = placeChat(layout, loose.key, { kind: 'section', sectionId: 's1', folderId: null });
    const tree = buildNavTree([old, loose, pinned, today, inFolder], layout, NOW);
    expect(tree.pinned).toEqual([pinned]);
    expect(tree.sections[0]?.folders[0]?.rows).toEqual([inFolder]);
    expect(tree.sections[0]?.loose).toEqual([loose]);
    expect(tree.recents).toEqual([
      { bucket: 'today', rows: [today] },
      { bucket: 'older', rows: [old] },
    ]);
  });

  it('sorts most recent first inside a group', () => {
    const a = row('a', hoursAgo(3));
    const b = row('b', hoursAgo(1));
    const c = row('c', null);
    expect(buildNavTree([a, c, b], EMPTY_NAV_LAYOUT, NOW).recents.flatMap((group) => group.rows)).toEqual([b, a, c]);
  });

  it('falls back when a placement names a lost folder or section', () => {
    let layout = layoutWithSection();
    const lostFolder = row('lf', hoursAgo(1));
    const lostSection = row('ls', hoursAgo(1));
    layout = placeChat(layout, lostFolder.key, { kind: 'section', sectionId: 's1', folderId: 'gone' });
    layout = placeChat(layout, lostSection.key, { kind: 'section', sectionId: 'gone', folderId: null });
    const tree = buildNavTree([lostFolder, lostSection], layout, NOW);
    expect(tree.sections[0]?.loose).toEqual([lostFolder]);
    expect(tree.recents[0]?.rows).toEqual([lostSection]);
  });
});

describe('familyGlyph', () => {
  it('uses the shortest prefix no other family shares', () => {
    const names = ['principal', 'code', 'creche'];
    expect(familyGlyph('principal', names)).toBe('P');
    expect(familyGlyph('code', names)).toBe('Co');
    expect(familyGlyph('creche', names)).toBe('Cr');
  });

  it('works with one family and with any number of them', () => {
    expect(familyGlyph('principal', ['principal'])).toBe('P');
    expect(familyGlyph('ab', ['ab', 'abc'])).toBe('Ab');
  });
});
