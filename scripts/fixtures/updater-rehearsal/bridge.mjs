// One-shot reporting over Panda's existing stdio boundary; no additional IPC grants.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [root, operation, payload = '{}'] = process.argv.slice(2);
const configuration = JSON.parse(readFileSync(join(root, 'run.json'), 'utf8'));
if (configuration.root !== root || !root.startsWith('/private/tmp/panda-updater-rehearsal-')) throw new Error('Invalid rehearsal root');
const value = JSON.parse(payload);
if (operation === 'mode') writeFileSync(join(root, 'mode'), value.mode);
else if (operation === 'report') {
  const binarySha256 = createHash('sha256').update(readFileSync(configuration.executable)).digest('hex');
  appendFileSync(join(root, 'events.jsonl'), `${JSON.stringify({ ...value, appPid: process.ppid, binarySha256, at: Date.now() })}\n`);
} else if (operation !== 'config') throw new Error('Unknown rehearsal operation');
process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 0, result: configuration })}\n`);
