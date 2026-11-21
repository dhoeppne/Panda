// Copied into a temporary src/desktop/ directory and appended to that build's
// main entry only. This file is never imported by the normal Panda application.
import { getStdioTransportFactory } from '../acp/transport/stdioHost';
import { desktopUpdater } from '../desktopUpdater';
import { usePanda } from '../store';
import { useComposerDrafts, stableComposerDraftKey } from '../composerDrafts';
import { useMessageQueue } from '../messageQueue';
import { startChatSession, sendLive, disconnectLiveConnection } from '../liveConnections';
import { saveProfiles, loadProfiles, type AgentProfile } from '../profiles';
import { navigate } from '../routes';
import { LAST_CHAT_KEY } from '../chatRecovery';

// Replaced with JSON literals by the rehearsal runner, never runtime URL input.
const root = '__REHEARSAL_ROOT__';
const node = '__REHEARSAL_NODE__';
const expectedDraft = 'Unsent rehearsal draft\nPreserve exactly across the signed update.';
const stageKey = 'panda.updaterRehearsal.stage';
const sessionId = 'rehearsal-session';
const familyId = 'updater-rehearsal';
const draftKey = stableComposerDraftKey(familyId, sessionId);
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function waitFor(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 60_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await delay(50); }
}
async function bridge(operation: string, value: unknown = {}) {
  const factory = getStdioTransportFactory();
  if (!factory) throw new Error('Native stdio factory missing');
  const transport = factory({ program: node, args: [`${root}/bridge.mjs`, root, operation, JSON.stringify(value)], cwd: root });
  try {
    const stream = await transport.connect();
    const reader = stream.readable.getReader();
    const response = await reader.read();
    if (response.done) throw new Error('Rehearsal bridge exited before reporting');
    // Wait for the short-lived reporter to exit before requesting app restart.
    await reader.read();
  } finally { transport.disconnect(); }
}
const mark = (name: string, detail: Record<string, unknown> = {}) => bridge('report', { name, ...detail });
const mode = (value: string) => bridge('mode', { mode: value });
function restored() {
  const state = usePanda.getState();
  return state.activeSessionId === sessionId && state.connections[state.activeConnectionId ?? '']?.connection.status === 'connected';
}
async function check(modeName: string) { await mode(modeName); await desktopUpdater.check(); }
async function idle() {
  await waitFor(() => Object.values(usePanda.getState().connections).every((slot) =>
    slot.connection.status !== 'connecting' && !slot.switching && Object.values(slot.docs).every((doc) => doc.status === 'idle')),
  'Chats did not settle');
}

async function run() {
  assert(desktopUpdater.store.getState().version !== null, 'Updater unavailable in the bundled release app');
  await desktopUpdater.check();
  const version = desktopUpdater.store.getState().version;
  const stage = localStorage.getItem(stageKey);
  await mark('launch', { version, stage });
  if (!stage) {
    assert(version === '0.0.1', 'Bootstrap version differs');
    const profile: AgentProfile = { id: familyId, slug: familyId, name: 'Updater rehearsal', kind: 'stdio', command: node,
      args: `${root}/agent.mjs ${root}`, workspace: { kind: 'local-directory', path: root }, mcpServerIds: [] };
    assert(saveProfiles([profile]), 'Cannot save isolated profile');
    assert(await startChatSession(profile), 'Cannot create rehearsal chat');
    navigate({ kind: 'chat', namespace: familyId, sessionId });
    await sendLive([{ type: 'text', text: 'history-before-update' }]);
    await idle();
    useComposerDrafts.getState().setDraft(draftKey, { value: expectedDraft });
    await waitFor(() => localStorage.getItem(LAST_CHAT_KEY)?.includes(sessionId) === true, 'Last chat was not remembered');
    localStorage.setItem(stageKey, 'seeded');
    await mark('seeded');
    location.reload();
    return;
  }
  await waitFor(restored, 'Production startup did not recover the selected chat');
  await idle();
  assert(loadProfiles().length === 1 && loadProfiles()[0]?.id === familyId, 'Isolated profile did not survive');
  assert(useComposerDrafts.getState().drafts[draftKey]?.value === expectedDraft, 'Draft changed across restart');
  assert(location.hash.includes(sessionId), 'Startup route did not recover');
  const state = usePanda.getState();
  const doc = state.connections[state.activeConnectionId ?? '']?.docs[sessionId];
  assert(JSON.stringify(doc).includes('Rehearsal reply: history-before-update'), 'Transcript missing from the recovered document');
  await mark('recovery-state-verified', { version, visibility: document.visibilityState,
    focused: document.hasFocus(), viewport: { width: innerWidth, height: innerHeight },
    scroller: document.querySelector('.message-scroller')?.getBoundingClientRect().toJSON(), doc });
  await waitFor(() => document.body.textContent?.includes('Rehearsal reply: history-before-update') === true,
    'Transcript replay not rendered');
  await waitFor(() => Array.from(document.querySelectorAll('textarea')).some((input) => input.value === expectedDraft),
    'Recovered draft not rendered in the composer');
  if (version === '0.0.2') {
    assert(stage === 'upgrading', 'Unexpected upgraded launch');
    await mark('recovered', { version, draft: expectedDraft, sessionId });
    await check('older');
    assert(desktopUpdater.store.getState().phase === 'current', 'Older feed offered a downgrade');
    await mark('downgrade-refused');
    for (const id of Object.keys(usePanda.getState().connections)) disconnectLiveConnection(id);
    await delay(500);
    await mark('passed', { version });
    return;
  }
  assert(version === '0.0.1' && stage === 'seeded', 'Unexpected test state');
  await mark('reload-recovered');
  for (const failure of ['offline', 'malformed']) {
    await check(failure);
    assert(desktopUpdater.store.getState().error === 'check', `${failure} was not contained`);
    await sendLive([{ type: 'text', text: `chat-after-${failure}` }]); await idle();
    await mark(`${failure}-contained`);
  }
  await check('current');
  assert(desktopUpdater.store.getState().phase === 'current', 'No-update feed failed');
  await mark('no-update');
  for (const failure of ['tampered', 'wrong-key', 'interrupted']) {
    await check(failure);
    assert(desktopUpdater.store.getState().phase === 'available', `${failure} feed not offered`);
    await desktopUpdater.installAndRestart();
    assert(desktopUpdater.store.getState().error === 'download', `${failure} archive was not rejected`);
    await mark(`${failure}-rejected`);
  }
  await check('good');
  const busy = sendLive([{ type: 'text', text: 'busy-guard' }]);
  await waitFor(() => Object.values(usePanda.getState().connections).some((slot) =>
    Object.values(slot.docs).some((doc) => doc.status !== 'idle')), 'Prompt never became busy');
  await desktopUpdater.installAndRestart();
  assert(desktopUpdater.store.getState().blocked === 'activity', 'Running prompt did not block installation');
  await busy; await idle();
  useMessageQueue.getState().enqueue('rehearsal-paused', [{ type: 'text', text: 'keep queued' }]);
  useMessageQueue.getState().pause('rehearsal-paused');
  await desktopUpdater.installAndRestart();
  assert(desktopUpdater.store.getState().blocked === 'queue', 'Paused queue did not block installation');
  const queued = useMessageQueue.getState().queues['rehearsal-paused']!.items[0]!;
  useMessageQueue.getState().remove('rehearsal-paused', queued.id);
  useComposerDrafts.getState().setDraft(draftKey, { attachments: [{ id: 'fixture', name: 'unsent.txt',
    size: 1, mimeType: 'text/plain', data: 'eA==' }] });
  await desktopUpdater.installAndRestart();
  assert(desktopUpdater.store.getState().blocked === 'attachments', 'Attachment did not block installation');
  useComposerDrafts.getState().setDraft(draftKey, { attachments: [] });
  await mark('work-guards-passed');
  assert(useComposerDrafts.getState().drafts[draftKey]?.value === expectedDraft, 'A failed update changed the draft');
  assert(localStorage.getItem(LAST_CHAT_KEY)?.includes(sessionId), 'Selection changed before update');
  localStorage.setItem(stageKey, 'upgrading');
  await mark('before-upgrade', { version });
  await desktopUpdater.installAndRestart();
  assert(desktopUpdater.store.getState().phase === 'restarting', 'Signed upgrade did not request guarded restart');
}

void run().catch(async (error: unknown) => {
  try { await mark('failed', { error: error instanceof Error ? error.message : String(error), hash: location.hash,
    body: document.body.textContent?.slice(-4000), drafts: useComposerDrafts.getState().drafts,
    session: usePanda.getState().activeSessionId, connections: usePanda.getState().connections }); } catch { console.error(error); }
});
