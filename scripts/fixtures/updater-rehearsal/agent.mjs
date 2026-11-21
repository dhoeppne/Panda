// Deterministic, persistent ACP fixture. Never uses a model or a network service.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const root = process.argv[2];
const file = join(root, 'session.json');
const event = (kind) => appendFileSync(join(root, 'agents.jsonl'), `${JSON.stringify({ kind, pid: process.pid, at: Date.now() })}\n`);
event('start');
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const update = (sessionId, value) => send({ method: 'session/update', params: { sessionId, update: value } });
let closing = false;
const close = () => { if (!closing) { closing = true; event('exit'); process.exit(0); } };
process.on('SIGTERM', close);
process.stdin.on('end', close);

createInterface({ input: process.stdin }).on('line', async (line) => {
  const request = JSON.parse(line);
  if (!('id' in request)) return;
  const reply = (result) => send({ id: request.id, result });
  const session = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  switch (request.method) {
    case 'initialize':
      reply({ protocolVersion: 1, agentInfo: { name: 'updater-rehearsal', version: '1.0.0' },
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } } });
      break;
    case 'session/list': reply({ sessions: session ? [{ sessionId: session.id, cwd: root, title: 'Updater rehearsal' }] : [] }); break;
    case 'session/new': {
      const created = { id: 'rehearsal-session', history: [] };
      writeFileSync(file, JSON.stringify(created));
      reply({ sessionId: created.id });
      break;
    }
    case 'session/load':
      if (!session || session.id !== request.params.sessionId) {
        send({ id: request.id, error: { code: -32602, message: 'Unknown rehearsal session' } }); break;
      }
      event('load');
      for (const item of session.history) update(session.id, item);
      reply({});
      break;
    case 'session/prompt': {
      const text = request.params.prompt.filter((item) => item.type === 'text').map((item) => item.text).join('');
      const user = { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } };
      const answer = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Rehearsal reply: ${text}` } };
      await new Promise((done) => setTimeout(done, text === 'busy-guard' ? 1500 : 30));
      session.history.push(user, answer);
      writeFileSync(file, JSON.stringify(session));
      update(session.id, answer);
      reply({ stopReason: 'end_turn' });
      break;
    }
    default: send({ id: request.id, error: { code: -32601, message: 'Not implemented by rehearsal fixture' } });
  }
});
