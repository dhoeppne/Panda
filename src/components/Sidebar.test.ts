import { describe, expect, it } from 'vitest';
import { emptySession } from '../protocol/reducer';
import type { SessionDocument } from '../protocol/types';
import { emptyConnectionState, type ConnectionState, type SessionEntry } from '../store';
import { chatRows, familyLifecycle, firstUserMessageText, sessionRowLabel, sessionRowMeta } from './Sidebar';
import type { AgentProfile } from '../profiles';

/** A document whose turns carry the given user-message content parts. */
function docWith(parts: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>): SessionDocument {
  const doc = emptySession();
  doc.turns.push({ id: 't-1', blocks: [{ kind: 'user_message', content: parts }] });
  return doc;
}

const entry = (patch: Partial<SessionEntry> = {}): SessionEntry => ({
  sessionId: 'session-91f53c9a',
  cwd: '/Users/dev/sandbox',
  title: null,
  updatedAt: null,
  ...patch,
});

describe('sessionRowLabel (#221: the conversation names itself)', () => {
  it('an agent-provided title always wins', () => {
    expect(sessionRowLabel(entry({ title: 'Refactor auth' }), docWith([{ type: 'text', text: 'hi' }]))).toBe('Refactor auth');
  });

  it('falls back to the first user message — the old `cwd · short-id` label helped nobody', () => {
    expect(sessionRowLabel(entry(), docWith([{ type: 'text', text: '为什么这个测试挂了?' }]))).toBe('为什么这个测试挂了?');
  });

  it('collapses whitespace across text parts before showing', () => {
    const doc = docWith([
      { type: 'text', text: '  fix\n  the' },
      { type: 'text', text: 'flaky test  ' },
    ]);
    expect(sessionRowLabel(entry(), doc)).toBe('fix the flaky test');
  });

  it('truncates long openings with an ellipsis', () => {
    const text = 'a'.repeat(60);
    expect(sessionRowLabel(entry(), docWith([{ type: 'text', text }]))).toBe(`${'a'.repeat(48)}…`);
    expect(sessionRowLabel(entry(), docWith([{ type: 'text', text }]), 10)).toBe('aaaaaaaaaa…');
  });

  it('an image-only opener yields no text — the workspace label stands in', () => {
    const doc = docWith([{ type: 'image', data: 'x', mimeType: 'image/png' }]);
    expect(sessionRowLabel(entry(), doc)).toBe('sandbox');
  });

  it('sessions never loaded locally (no document) fall back to the workspace label', () => {
    expect(sessionRowLabel(entry(), undefined)).toBe('sandbox');
  });
});

describe('firstUserMessageText', () => {
  it('scans forward: the first message with text wins, later turns are never consulted', () => {
    const doc = emptySession();
    doc.turns.push({ id: 't-1', blocks: [{ kind: 'agent_message', messageId: 'm-1', parts: [{ type: 'text', text: 'greeting' }] }] });
    doc.turns.push({ id: 't-2', blocks: [{ kind: 'user_message', content: [{ type: 'text', text: 'the opener' }] }] });
    doc.turns.push({ id: 't-3', blocks: [{ kind: 'user_message', content: [{ type: 'text', text: 'later' }] }] });
    expect(firstUserMessageText(doc)).toBe('the opener');
  });

  it('an empty document yields null', () => {
    expect(firstUserMessageText(emptySession())).toBeNull();
  });
});

describe('sessionRowMeta (#221: the short id demotes to hover meta)', () => {
  it('pairs the workspace label with the id\'s last six characters', () => {
    expect(sessionRowMeta(entry())).toBe('sandbox · f53c9a');
  });
});

describe('chatRows (the merged list of a family with two connections)', () => {
  const profile = (id: string): AgentProfile => ({
    id,
    name: id,
    kind: 'websocket',
    url: `ws://${id}/acp`,
    workspace: { kind: 'none' },
    mcpServerIds: [],
  });

  it('lists one row per chat when two connections share the endpoint', () => {
    const sessions = [entry({ sessionId: 's-1' }), entry({ sessionId: 's-2' })];
    const rows = chatRows(
      [
        { connectionId: 'family-a', endpoint: 'ws://family-a/acp', heldSessionId: 's-1', sessions },
        { connectionId: 'family-a#1', endpoint: 'ws://family-a/acp', heldSessionId: 's-2', sessions },
      ],
      [profile('family-a')],
    );

    expect(rows.map((row) => row.sessionId)).toEqual(['s-1', 's-2']);
  });

  it('gives each chat the connection that holds it', () => {
    const sessions = [entry({ sessionId: 's-1' }), entry({ sessionId: 's-2' })];
    const rows = chatRows(
      [
        { connectionId: 'family-a', endpoint: 'ws://family-a/acp', heldSessionId: 's-1', sessions },
        { connectionId: 'family-a#1', endpoint: 'ws://family-a/acp', heldSessionId: 's-2', sessions },
      ],
      [profile('family-a')],
    );

    expect(rows.find((row) => row.sessionId === 's-1')?.connectionId).toBe('family-a');
    expect(rows.find((row) => row.sessionId === 's-2')?.connectionId).toBe('family-a#1');
  });

  it('names the family of an extra connection', () => {
    const rows = chatRows(
      [{ connectionId: 'family-a#1', endpoint: 'ws://family-a/acp', heldSessionId: 's-1', sessions: [entry()] }],
      [profile('family-a')],
    );

    expect(rows[0]?.familyName).toBe('family-a');
  });

  it('keeps the chats of two families apart', () => {
    const rows = chatRows(
      [
        { connectionId: 'family-a', endpoint: 'ws://family-a/acp', heldSessionId: 's-1', sessions: [entry({ sessionId: 's-1' })] },
        { connectionId: 'family-b', endpoint: 'ws://family-b/acp', heldSessionId: 's-1', sessions: [entry({ sessionId: 's-1' })] },
      ],
      [profile('family-a'), profile('family-b')],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.familyName)).toEqual(['family-a', 'family-b']);
  });
});

describe('familyLifecycle (the dot of a family with two connections)', () => {
  const slot = (patch: Partial<ConnectionState> = {}): ConnectionState => ({
    ...emptyConnectionState(),
    ...patch,
  });

  it('follows the first connection of the family that is up', () => {
    const facts = familyLifecycle([
      slot({ connection: { ...emptyConnectionState().connection, status: 'disconnected' } }),
      slot({ connection: { ...emptyConnectionState().connection, status: 'connected' } }),
    ]);

    expect(facts.phase).toBe('connected');
  });

  it('lights the dot when any connection of the family runs a turn', () => {
    const running = slot({
      connection: { ...emptyConnectionState().connection, status: 'connected' },
      docs: { 's-1': { ...emptySession(), status: 'running' } },
    });

    const facts = familyLifecycle([slot(), running]);

    expect(facts.running).toBe(true);
  });

  it('has no dot without a connection', () => {
    expect(familyLifecycle([]).phase).toBe('disconnected');
    expect(familyLifecycle([]).running).toBe(false);
  });
});
