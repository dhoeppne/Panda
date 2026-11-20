import { describe, expect, it } from 'vitest';
import {
  chatKey,
  connectionOfNamespace,
  extraConnectionId,
  namespaceOfConnection,
  profileIdOfConnection,
  sameChat,
} from './chatId';
import type { AgentProfile } from './profiles';

const profile = (id: string, slug: string): AgentProfile => ({
  id,
  name: id,
  slug,
  kind: 'websocket',
  url: `ws://${id}/acp`,
  workspace: { kind: 'none' },
  mcpServerIds: [],
});

describe('chatKey', () => {
  it('names a chat by its namespace and its session id', () => {
    expect(chatKey({ namespace: 'principal', sessionId: 'abc' })).toBe('principal\nabc');
  });

  it('keeps two chats apart', () => {
    expect(chatKey({ namespace: 'a', sessionId: '1' })).not.toBe(chatKey({ namespace: 'a', sessionId: '2' }));
    expect(chatKey({ namespace: 'a', sessionId: '1' })).not.toBe(chatKey({ namespace: 'b', sessionId: '1' }));
  });
});

describe('sameChat', () => {
  it('compares both halves', () => {
    expect(sameChat({ namespace: 'a', sessionId: '1' }, { namespace: 'a', sessionId: '1' })).toBe(true);
    expect(sameChat({ namespace: 'a', sessionId: '1' }, { namespace: 'a', sessionId: '2' })).toBe(false);
  });

  it('treats null as no chat', () => {
    expect(sameChat(null, null)).toBe(true);
    expect(sameChat(null, { namespace: 'a', sessionId: '1' })).toBe(false);
  });
});

describe('profileIdOfConnection', () => {
  it('reads the owner of a connection id', () => {
    expect(profileIdOfConnection('agent-a')).toBeNull();
    expect(profileIdOfConnection(extraConnectionId('agent-a', 2))).toBe('agent-a');
    expect(profileIdOfConnection('direct:abc')).toBeNull();
  });
});

describe('namespaceOfConnection', () => {
  it('is the slug of the family that owns the connection', () => {
    const profiles = [profile('agent-a', 'agent-a')];
    expect(namespaceOfConnection('agent-a', profiles)).toBe('agent-a');
    expect(namespaceOfConnection(extraConnectionId('agent-a', 1), profiles)).toBe('agent-a');
  });

  it('is the connection id of a 临时直连 — it owns no family', () => {
    expect(namespaceOfConnection('direct:abc', [])).toBe('direct:abc');
  });
});

describe('connectionOfNamespace', () => {
  it('finds the family whose slug it is', () => {
    const profiles = [profile('agent-a', 'agent-a')];
    expect(connectionOfNamespace('agent-a', profiles, [])).toBe('agent-a');
  });

  it('finds a 临时直连 by its id', () => {
    expect(connectionOfNamespace('direct:abc', [], ['direct:abc'])).toBe('direct:abc');
  });

  it('is null for a namespace nobody carries', () => {
    expect(connectionOfNamespace('ghost', [profile('agent-a', 'agent-a')], [])).toBeNull();
  });
});
