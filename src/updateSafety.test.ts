import { afterEach, describe, expect, it } from 'vitest';
import { createComposerDraftStore, TEXT_DRAFTS_KEY } from './composerDrafts';
import { emptyConnectionState } from './store';
import { emptySession } from './protocol/reducer';
import { useMessageQueue } from './messageQueue';
import { beginAttachmentRead, lockUpdaterWork, restartBlocker, useUpdateSafety } from './updateSafety';

afterEach(() => { lockUpdaterWork(false); useUpdateSafety.setState({ attachmentReads: 0 }); useMessageQueue.setState({ queues: {} }); });

describe('restart safety across all chats', () => {
  const empty = () => ({ family: emptyConnectionState() });
  it('allows an idle app but catches an in-flight connection or session switch', () => {
    const connections = empty();
    expect(restartBlocker(connections, {}, {}, 0)).toBeNull();
    connections.family.connection.status = 'connecting';
    expect(restartBlocker(connections, {}, {}, 0)).toBe('activity');
    connections.family.connection.status = 'connected';
    connections.family.switching = { sessionId: 'other', selectionToken: 1 };
    expect(restartBlocker(connections, {}, {}, 0)).toBe('activity');
  });

  it('catches background running and approval-waiting documents', () => {
    const connections = empty();
    connections.family.docs.background = { ...emptySession(), status: 'running' };
    expect(restartBlocker(connections, {}, {}, 0)).toBe('activity');
    connections.family.docs.background.status = 'requires_action';
    expect(restartBlocker(connections, {}, {}, 0)).toBe('activity');
  });

  it('checks pending permission and URL consent even if the document is idle', () => {
    const connections = empty();
    const doc = emptySession();
    connections.family.docs.background = doc;
    doc.permissions.tool = { status: 'pending', request: { toolCallId: 'tool', title: 'Edit', options: [] }, response: null };
    expect(restartBlocker(connections, {}, {}, 0)).toBe('activity');
    doc.permissions.tool.status = 'resolved';
    doc.elicitations.consent = { status: 'opened', response: null, request: {
      mode: 'url', id: 'consent', toolCallId: null, message: null, url: 'https://example.com/consent',
    } };
    expect(restartBlocker(connections, {}, {}, 0)).toBe('activity');
    doc.elicitations.consent.status = 'completed';
    expect(restartBlocker(connections, {}, {}, 0)).toBeNull();
    connections.family.connection.authElicitation = doc.elicitations.consent.request;
    expect(restartBlocker(connections, {}, {}, 0)).toBe('activity');
  });

  it('catches paused queues and attachments belonging to another composer', () => {
    expect(restartBlocker({}, {}, { other: { items: [{ id: 'q', content: [] }], paused: true } }, 0)).toBe('queue');
    expect(restartBlocker({}, { other: { value: '', attachmentError: null, attachments: [{ id: 'file', name: 'x', size: 1, mimeType: 'text/plain', data: 'a' }] } }, {}, 0)).toBe('attachments');
  });

  it('tracks file reads before attachments exist and releases each read only once', () => {
    const finish = beginAttachmentRead();
    expect(restartBlocker({}, {}, {}, useUpdateSafety.getState().attachmentReads)).toBe('attachments');
    finish(); finish();
    expect(useUpdateSafety.getState().attachmentReads).toBe(0);
  });

  it('does not drain or enqueue messages while installation has locked the app', () => {
    useMessageQueue.getState().enqueue('chat', [{ type: 'text', text: 'keep me' }]);
    lockUpdaterWork(true);
    expect(useMessageQueue.getState().takeNext('chat')).toBeNull();
    useMessageQueue.getState().enqueue('other', [{ type: 'text', text: 'not accepted' }]);
    expect(useMessageQueue.getState().queues.other).toBeUndefined();
    lockUpdaterWork(false);
    expect(useMessageQueue.getState().takeNext('chat')?.content).toEqual([{ type: 'text', text: 'keep me' }]);
  });
});

describe('saving text before restart', () => {
  function storage() {
    const items = new Map<string, string>();
    return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
  }
  it('persists exact family/session text and leaves restored drafts intact', () => {
    const disk = storage();
    const first = createComposerDraftStore(disk);
    first.getState().setDraft('family::session', { value: 'unsent\ntext' });
    expect(first.getState().prepareForRestart()).toBe(true);
    expect(createComposerDraftStore(disk).getState().drafts['family::session']?.value).toBe('unsent\ntext');
    expect(disk.getItem(TEXT_DRAFTS_KEY)).toContain('unsent');
  });
  it('blocks transient text and unavailable storage', () => {
    const transient = createComposerDraftStore(storage());
    transient.getState().setDraft('direct:temporary::session', { value: 'do not lose' });
    expect(transient.getState().prepareForRestart()).toBe(false);
    const blocked = createComposerDraftStore({ getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} });
    blocked.getState().setDraft('family::session', { value: 'do not lose' });
    expect(blocked.getState().prepareForRestart()).toBe(false);
    expect(blocked.getState().drafts['family::session']?.value).toBe('do not lose');
  });
});
