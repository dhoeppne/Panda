import { describe, expect, it } from 'vitest';
import { agentLabel } from './StatusBar';

describe('agentLabel', () => {
  it('names the family the user picked, also when the agent reports a name', () => {
    expect(agentLabel('chat', 'unknown agent')).toBe('chat');
    expect(agentLabel('chat', 'Some Agent')).toBe('chat');
  });

  it('keeps the reported name for a custom address, which has no family', () => {
    expect(agentLabel(null, 'Some Agent')).toBe('Some Agent');
    expect(agentLabel(null, null)).toBeNull();
  });
});
