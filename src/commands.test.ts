import { describe, expect, it } from 'vitest';
import type { AcpAvailableCommand } from './protocol/types';
import {
  commandCompletion,
  commandKeyAction,
  commandMenu,
  familyCommandSource,
  sessionCommandSource,
  wrapIndex,
} from './commands';

const commands: AcpAvailableCommand[] = [
  { name: 'status', description: '查看状态', inputHint: null },
  { name: 'tag', description: '打 tag', inputHint: '版本号' },
  { name: 'ci', description: '触发 CI', inputHint: null },
];

const ready = { kind: 'ready', family: 'principal', commands } as const;

describe('commandMenu (open/close + filtering)', () => {
  it('opens on a bare slash and lists every command', () => {
    expect(commandMenu(ready, '/')).toEqual({ kind: 'list', family: 'principal', query: '', items: commands, total: 3 });
  });

  it('filters by command-name prefix, case-insensitively, preserving agent order', () => {
    expect(commandMenu(ready, '/t')).toMatchObject({ items: [commands[1]], total: 3 });
    expect(commandMenu(ready, '/STATUS')).toMatchObject({ items: [commands[0]] });
  });

  it('stays open with no row when nothing matches (the no-match state)', () => {
    expect(commandMenu(ready, '/zzz')).toEqual({ kind: 'list', family: 'principal', query: 'zzz', items: [], total: 3 });
  });

  it('opens only for `/` as the first token, before any space', () => {
    expect(commandMenu(ready, '普通消息')).toBe(null);
    expect(commandMenu(ready, '/tag v1.3.0')).toBe(null); // space: the name is settled
    expect(commandMenu(ready, '见 /tag')).toBe(null); // not at position zero
    expect(commandMenu(ready, ' /tag')).toBe(null);
  });

  it('shows the loading and offline states, and stays closed with no source', () => {
    expect(commandMenu({ kind: 'loading', family: 'creche' }, '/gr')).toEqual({ kind: 'loading', family: 'creche' });
    expect(commandMenu({ kind: 'offline', family: 'creche' }, '/')).toEqual({ kind: 'offline', family: 'creche' });
    expect(commandMenu({ kind: 'loading', family: 'creche' }, 'hi')).toBe(null);
    expect(commandMenu({ kind: 'none' }, '/')).toBe(null);
  });
});

describe('familyCommandSource (a new chat, before any session)', () => {
  it('uses the initialize list whatever the link state, so a drop keeps it', () => {
    for (const status of ['connected', 'connecting', 'disconnected', 'error', 'auth_required'] as const) {
      expect(familyCommandSource('principal', status, commands)).toEqual(ready);
    }
  });

  it('is loading while the family connects and offline while it is down', () => {
    expect(familyCommandSource('creche', 'connecting', null)).toEqual({ kind: 'loading', family: 'creche' });
    expect(familyCommandSource('creche', 'disconnected', null)).toEqual({ kind: 'offline', family: 'creche' });
    expect(familyCommandSource('creche', 'error', null)).toEqual({ kind: 'offline', family: 'creche' });
  });

  it('offers none for a connected family that sent no list, or an empty one', () => {
    expect(familyCommandSource('creche', 'connected', null)).toEqual({ kind: 'none' });
    expect(familyCommandSource('creche', 'connected', [])).toEqual({ kind: 'none' });
  });
});

describe('sessionCommandSource (a live chat)', () => {
  it("prefers the session's own list, then the family's initialize list", () => {
    const other = [commands[0]!];
    expect(sessionCommandSource('principal', commands, other)).toEqual(ready);
    expect(sessionCommandSource('principal', [], commands)).toEqual(ready);
    expect(sessionCommandSource('principal', [], null)).toEqual({ kind: 'none' });
  });
});

describe('commandCompletion', () => {
  it('produces /name with a trailing space so the argument starts immediately', () => {
    expect(commandCompletion({ name: 'tag', description: '打 tag', inputHint: '版本号' })).toBe('/tag ');
  });
});

describe('commandKeyAction (keyboard while the panel is open)', () => {
  it('Enter completes; Shift+Enter falls through to a newline', () => {
    expect(commandKeyAction({ key: 'Enter', shiftKey: false }, 3)).toEqual({ type: 'complete' });
    expect(commandKeyAction({ key: 'Enter', shiftKey: true }, 3)).toBe(null);
  });

  it('Tab completes, arrows move, Escape closes, everything else falls through', () => {
    expect(commandKeyAction({ key: 'Tab', shiftKey: false }, 3)).toEqual({ type: 'complete' });
    expect(commandKeyAction({ key: 'ArrowDown', shiftKey: false }, 3)).toEqual({ type: 'move', delta: 1 });
    expect(commandKeyAction({ key: 'ArrowUp', shiftKey: false }, 3)).toEqual({ type: 'move', delta: -1 });
    expect(commandKeyAction({ key: 'Escape', shiftKey: false }, 3)).toEqual({ type: 'close' });
    expect(commandKeyAction({ key: 'a', shiftKey: false }, 3)).toBe(null);
  });

  it('with no row (no match, loading, offline) only Escape acts, so Enter sends', () => {
    expect(commandKeyAction({ key: 'Enter', shiftKey: false }, 0)).toBe(null);
    expect(commandKeyAction({ key: 'Tab', shiftKey: false }, 0)).toBe(null);
    expect(commandKeyAction({ key: 'ArrowDown', shiftKey: false }, 0)).toBe(null);
    expect(commandKeyAction({ key: 'Escape', shiftKey: false }, 0)).toEqual({ type: 'close' });
  });

  it('IME-composition keys take no panel action (bug hunt #2: Enter confirms the candidate)', () => {
    expect(commandKeyAction({ key: 'Enter', shiftKey: false, isComposing: true }, 3)).toBe(null);
    expect(commandKeyAction({ key: 'Tab', shiftKey: false, isComposing: true }, 3)).toBe(null);
    expect(commandKeyAction({ key: 'ArrowDown', shiftKey: false, isComposing: true }, 3)).toBe(null);
    expect(commandKeyAction({ key: 'Escape', shiftKey: false, isComposing: true }, 3)).toBe(null);
  });
});

describe('wrapIndex', () => {
  it('wraps around both ends of the list', () => {
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, -1, 3)).toBe(2);
  });
});
