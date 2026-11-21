import { create } from 'zustand';
import type { ConnectionState } from './store';
import type { ComposerDraft } from './composerDrafts';
import type { MessageQueue } from './messageQueue';

export type UpdateBlocker = 'activity' | 'queue' | 'attachments' | 'drafts';

export const useUpdateSafety = create(() => ({ locked: false, attachmentReads: 0 }));
export const updaterWorkLocked = () => useUpdateSafety.getState().locked;
export const lockUpdaterWork = (locked: boolean) => useUpdateSafety.setState({ locked });

/** File reads are asynchronous work even before their attachments reach the draft. */
export function beginAttachmentRead(): () => void {
  useUpdateSafety.setState((state) => ({ attachmentReads: state.attachmentReads + 1 }));
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    useUpdateSafety.setState((state) => ({ attachmentReads: state.attachmentReads - 1 }));
  };
}

export function restartBlocker(
  connections: Record<string, ConnectionState>,
  drafts: Record<string, ComposerDraft>,
  queues: Record<string, MessageQueue>,
  attachmentReads: number,
): UpdateBlocker | null {
  for (const slot of Object.values(connections)) {
    if (slot.connection.status === 'connecting' || slot.switching || slot.connection.authElicitation) return 'activity';
    for (const doc of Object.values(slot.docs)) {
      if (doc.status !== 'idle' || Object.values(doc.permissions).some((request) => request.status === 'pending') ||
          Object.values(doc.elicitations).some((request) => request.status === 'pending' || request.status === 'opened') ||
          Object.values(doc.compactions).some((compaction) => compaction.status === 'in_progress')) return 'activity';
    }
  }
  if (Object.values(queues).some((queue) => queue.items.length > 0)) return 'queue';
  if (attachmentReads > 0 || Object.values(drafts).some((draft) => draft.attachments.length > 0)) return 'attachments';
  return null;
}
