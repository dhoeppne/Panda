import { beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, agent, methods, type AnyMessage, type Stream } from '@agentclientprotocol/sdk';
import { LiveAcpClient } from './LiveAcpClient';
import { StreamTransport } from './transport/StreamTransport';
import { connectionStorePort, usePanda, type SessionSwitchSnapshot } from '../store';

/**
 * The session switch and the store marker behind the content column's
 * loading state: opening another session replays its history over the wire,
 * so the store must say that a switch is in flight while it runs — until
 * the switch commits, the pointer still names the session being left.
 */

function streamPair(): { clientStream: Stream; serverStream: Stream } {
  const c2s = new TransformStream<AnyMessage>();
  const s2c = new TransformStream<AnyMessage>();
  return {
    clientStream: { writable: c2s.writable, readable: s2c.readable },
    serverStream: { writable: s2c.writable, readable: c2s.readable },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('a session switch in flight', () => {
  beforeEach(() => {
    usePanda.setState({
      connections: {},
      activeConnectionId: null,
      activeSessionId: null,
      selectionGeneration: 0,
    });
  });

  it('marks the store as switching until the switch settles', async () => {
    usePanda.getState().ensureConnection('live');
    const port = connectionStorePort('live');
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => (releaseLoad = resolve));
    const { clientStream, serverStream } = streamPair();
    agent({ name: 'fake-agent' })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentInfo: { name: 'fake-agent', version: '0.0.0' },
        agentCapabilities: { loadSession: true },
      }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: 'A' }))
      .onRequest(methods.agent.session.load, async () => {
        await loadGate;
        return {};
      })
      .connect(serverStream);

    let staged: SessionSwitchSnapshot | null = null;
    const acpClient = new LiveAcpClient({
      onUpdate: (update) => port.update(update),
      onSessionModes: () => {},
      onSessionConfigOptions: () => {},
      onConnected: () => {},
      onSessionId: (id, cwd) => port.adoptSession(id, cwd),
      onDisconnected: () => {},
      onAuthChallenge: () => {},
      onAuthElicitation: () => {},
      onAuthMethods: () => {},
      onAuthenticated: () => {},
      onCapabilities: () => {},
      onSessions: () => {},
      onSessionInfo: () => {},
      onReplayStart: () => port.resetDocument(),
      onSessionDeleted: () => {},
      onSessionSwitchStage: (id, cwd) => {
        staged = port.stageSession(id, cwd);
      },
      onSessionSwitchCommit: () => {
        const snapshot = staged;
        staged = null;
        port.commitStagedSession(snapshot);
      },
      onSessionSwitchRollback: () => {
        const snapshot = staged;
        staged = null;
        if (snapshot) port.rollbackStagedSession(snapshot);
      },
    });
    await acpClient.connect(new StreamTransport(clientStream), '/tmp/project', { intent: 'new-session' });

    const pending = acpClient.loadSession('B', '/tmp/project');
    await waitFor(() => usePanda.getState().connections['live']!.switching !== null);

    // The marker is what the content column reads to wait for the target.
    expect(usePanda.getState().connections['live']!.switching).toMatchObject({ sessionId: 'B' });
    // The pointer still names the session being left: the switch has not
    // committed, so the target is not viewable yet.
    expect(usePanda.getState().activeSessionId).toBe('A');

    releaseLoad();
    await pending;
    expect(usePanda.getState().connections['live']!.switching).toBeNull();
    expect(usePanda.getState().activeSessionId).toBe('B');
    acpClient.disconnect();
  });
});
