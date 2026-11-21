import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStdioTransportFactory } from './acp/transport/StdioTransport';
import { setStdioTransportFactory } from './acp/transport/stdioHost';
import { __resetLiveConnections, openChatRoute, sendLive, startChatSession } from './liveConnections';
import { saveProfiles, type AgentProfile } from './profiles';
import { usePanda } from './store';

const children: ChildProcessWithoutNullStreams[] = [];
let root = '';
afterEach(async () => {
  __resetLiveConnections();
  setStdioTransportFactory(null);
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGTERM'); await exited;
  }
  if (root) rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

it('replays the rehearsal agent transcript through the production stdio client and connection manager', async () => {
  root = mkdtempSync(join(tmpdir(), 'panda-updater-agent-test-'));
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  usePanda.setState({ connections: {}, activeConnectionId: null, activeSessionId: null, selectionGeneration: 0 });
  setStdioTransportFactory(createStdioTransportFactory(async ({ program, args, cwd }) => {
    const child = spawn(program, args, { cwd, stdio: 'pipe' }); children.push(child);
    return { write: (data) => new Promise<void>((done, reject) => child.stdin.write(data, (error) => error ? reject(error) : done())),
      onStdoutChunk: (handler) => { child.stdout.on('data', handler); },
      onExit: (handler) => { child.on('exit', handler); }, kill: async () => { child.kill('SIGTERM'); } };
  }));
  const profile: AgentProfile = { id: 'fixture', slug: 'fixture', name: 'Fixture', kind: 'stdio', command: process.execPath,
    args: `${fileURLToPath(new URL('../scripts/fixtures/updater-rehearsal/agent.mjs', import.meta.url))} ${root}`,
    workspace: { kind: 'local-directory', path: root }, mcpServerIds: [] };
  expect(saveProfiles([profile])).toBe(true);
  expect(await startChatSession(profile)).toBe(true);
  await sendLive([{ type: 'text', text: 'history-before-update' }]);
  const text = () => JSON.stringify(Object.values(usePanda.getState().connections).flatMap((slot) => Object.values(slot.docs)));
  expect(text()).toContain('Rehearsal reply: history-before-update');
  __resetLiveConnections();
  usePanda.setState({ connections: {}, activeConnectionId: null, activeSessionId: null, selectionGeneration: 0 });
  expect(await openChatRoute({ namespace: 'fixture', sessionId: 'rehearsal-session' })).toBe(true);
  expect(text()).toContain('Rehearsal reply: history-before-update');
}, 10_000);
