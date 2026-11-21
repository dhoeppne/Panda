import { describe, expect, it } from 'vitest';
import { resolveNewChatFamily } from './newChat';
import type { AgentProfile } from './profiles';

const profile = (id: string): AgentProfile => ({
  id,
  name: id,
  slug: id,
  kind: 'websocket',
  url: `wss://door/${id}`,
  workspace: { kind: 'none' },
  mcpServerIds: [],
});

describe('resolveNewChatFamily', () => {
  it('keeps the remembered family while it exists', () => {
    expect(resolveNewChatFamily('code', [profile('principal'), profile('code')])?.id).toBe('code');
  });

  it('falls back to the first family when the remembered one is gone', () => {
    expect(resolveNewChatFamily('code', [profile('principal')])?.id).toBe('principal');
    expect(resolveNewChatFamily(null, [profile('principal')])?.id).toBe('principal');
  });

  it('is null with no families', () => {
    expect(resolveNewChatFamily('code', [])).toBeNull();
  });
});
