import type { AcpAvailableCommand } from './protocol/types';
import type { ConnectionStatus } from './store';

/**
 * Slash-command autocomplete for the composer: a family's skills, one
 * command each (creche#616). Pure functions — the panel's
 * open/closed state derives entirely from the input text, so a completed
 * command ("/name " with its trailing space) closes the panel by itself.
 */

/**
 * Where the menu's list comes from. A live session has its own list
 * (`available_commands_update`). A new chat has no session yet, so it shows
 * the list the family's door sent in its `initialize` answer
 * (`_meta["creche/commands"]`). `none` keeps the menu closed: the agent
 * offers no command.
 */
export type CommandSource =
  | { kind: 'ready'; family: string; commands: AcpAvailableCommand[] }
  | { kind: 'loading'; family: string }
  | { kind: 'offline'; family: string }
  | { kind: 'none' };

/** What the open menu shows. An empty `items` is the no-match state. */
export type CommandMenu =
  | { kind: 'list'; family: string; query: string; items: AcpAvailableCommand[]; total: number }
  | { kind: 'loading'; family: string }
  | { kind: 'offline'; family: string };

/**
 * The partial command name while the input is exactly `/` + a partial name
 * (no space yet), else null. Once the user types arguments ("/tag v1.3…")
 * the name is settled. A `/` later in a message never opens the menu.
 */
export function commandQuery(value: string): string | null {
  const token = /^\/(\S*)$/.exec(value);
  return token ? (token[1] ?? '') : null;
}

/**
 * The menu for the input, or null when it stays closed. Matching is a
 * case-insensitive name prefix, in the agent's list order.
 */
export function commandMenu(source: CommandSource, value: string): CommandMenu | null {
  const query = commandQuery(value);
  if (query === null || source.kind === 'none') return null;
  if (source.kind !== 'ready') return source;
  const lower = query.toLowerCase();
  const items = source.commands.filter((command) => command.name.toLowerCase().startsWith(lower));
  return { kind: 'list', family: source.family, query, items, total: source.commands.length };
}

/**
 * The source of a new chat: the family's `initialize` list, kept across a
 * drop. With no list yet, a connecting family is loading and a family that
 * is down is offline. A connected family that sent no list offers none.
 */
export function familyCommandSource(
  family: string,
  status: ConnectionStatus,
  commands: AcpAvailableCommand[] | null,
): CommandSource {
  if (commands !== null) return commands.length > 0 ? { kind: 'ready', family, commands } : { kind: 'none' };
  if (status === 'connecting') return { kind: 'loading', family };
  if (status === 'disconnected' || status === 'error') return { kind: 'offline', family };
  return { kind: 'none' };
}

/**
 * The source of a live chat: the session's own list, else the family's
 * `initialize` list (a session whose list has not arrived yet).
 */
export function sessionCommandSource(
  family: string,
  sessionCommands: AcpAvailableCommand[],
  familyCommands: AcpAvailableCommand[] | null,
): CommandSource {
  const commands = sessionCommands.length > 0 ? sessionCommands : (familyCommands ?? []);
  return commands.length > 0 ? { kind: 'ready', family, commands } : { kind: 'none' };
}

/** The completed input for a command: `/name ` — the trailing space starts the argument. */
export function commandCompletion(command: AcpAvailableCommand): string {
  return `/${command.name} `;
}

/**
 * Keyboard behavior while the panel is open. Enter completes the highlighted
 * command instead of submitting (Shift+Enter still inserts a newline — the
 * caller falls through to the default handling); Tab completes; arrows wrap
 * around; Escape dismisses until the input changes.
 */
export type CommandKeyAction =
  | { type: 'complete' }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'close' }
  | null;

export function commandKeyAction(
  e: {
    key: string;
    shiftKey: boolean;
    /** True while an IME composition is in progress — Enter then confirms the
     * candidate, not the panel action (see Composer's isImeComposition). */
    isComposing?: boolean;
  },
  /** Rows in the open menu. With none (no match, loading, offline) only
   * Escape acts: Enter sends the text as typed. */
  itemCount: number,
): CommandKeyAction {
  if (e.isComposing) return null;
  if (itemCount === 0) return e.key === 'Escape' ? { type: 'close' } : null;
  switch (e.key) {
    case 'ArrowDown':
      return { type: 'move', delta: 1 };
    case 'ArrowUp':
      return { type: 'move', delta: -1 };
    case 'Tab':
      return { type: 'complete' };
    case 'Enter':
      return e.shiftKey ? null : { type: 'complete' };
    case 'Escape':
      return { type: 'close' };
    default:
      return null;
  }
}

/** Wraps the highlighted index around the item list (arrow navigation). */
export function wrapIndex(index: number, delta: 1 | -1, length: number): number {
  return (index + delta + length) % length;
}
