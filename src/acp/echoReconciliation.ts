// Echo reconciliation (issue #15), extracted so the whole state machine —
// buffering, window closing, relation judgment, flushing — lives in one
// independently testable module. The client only drives it: construct on
// `send()`, `feed()` every notification, `settle()` at turn end.
import {
  toAcpUpdates,
  toUserContentBlock,
} from './wire';
import type { ContentBlock, SessionNotification } from '@agentclientprotocol/sdk';
import type { AcpSessionUpdate, AcpUserContentBlock } from '../protocol/types';

/** Order-insensitive structural equality — JSON.stringify would be key-order sensitive. */
function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    );
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}

/** Folds adjacent text blocks so a segmented echo compares as one message. */
function coalesceText(blocks: readonly AcpUserContentBlock[]): AcpUserContentBlock[] {
  const result: AcpUserContentBlock[] = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    if (block.type === 'text' && previous?.type === 'text') {
      result[result.length - 1] = { type: 'text', text: previous.text + block.text };
    } else {
      result.push(block);
    }
  }
  return result;
}

/**
 * `complete`: the echo names the whole prompt in the file-tolerant shape,
 * but more chunks of the same file may follow (an image replays as a link
 * and then as an image). The reconciler confirms it when the echo window
 * closes, not at once, so a trailing chunk is not rendered twice.
 */
export type EchoRelation = 'prefix' | 'equal' | 'complete' | 'different';

/**
 * Compares the content the client sent (`prompt`, internal blocks) against
 * the echo the agent has produced so far (wire `user_message_chunk` contents).
 * Text allows a trailing partial (`prefix` — echo still streaming); anything
 * else must match structurally. An echo containing content Panda cannot map
 * (audio/…) can never equal a prompt Panda sent, so it counts as `different`.
 *
 * A prompt with files also matches an echo that names the same files in
 * another shape (`fileRelation`): an agent that stores the files replays
 * them as links, after the text, with rebuilt image bytes.
 */
export function echoRelation(
  prompt: readonly AcpUserContentBlock[],
  echoChunks: readonly ContentBlock[],
): EchoRelation {
  const mapped: (AcpUserContentBlock | null)[] = echoChunks.map((chunk) =>
    toUserContentBlock(chunk, 'echo reconciliation'),
  );
  if (mapped.some((block) => block === null)) return 'different';
  const echo = mapped as AcpUserContentBlock[];
  const exact = exactRelation(prompt, echo);
  if (exact !== 'different' || !prompt.some((block) => block.type !== 'text')) return exact;
  return fileRelation(prompt, echo);
}

/** The identity of a file block: its `attachment:` URI, or its bytes for an image with none. */
function fileKey(block: Exclude<AcpUserContentBlock, { type: 'text' }>): string {
  switch (block.type) {
    case 'image':
      return block.uri ?? `data:${block.mimeType};base64,${block.data}`;
    case 'resource':
      return block.resource.uri;
    case 'resource_link':
      return block.uri;
  }
}

/**
 * The file-tolerant relation, order-insensitive: the echo text (all its text
 * blocks, joined) must be the prompt text or a prefix of it, and every echo
 * file must name a file of the prompt. `equal` once the text is complete and
 * every prompt file was named. Image bytes are not compared: the agent may
 * replay a rebuilt image under the same URI.
 */
function fileRelation(
  prompt: readonly AcpUserContentBlock[],
  echo: readonly AcpUserContentBlock[],
): EchoRelation {
  const textOf = (blocks: readonly AcpUserContentBlock[]) =>
    blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  const promptText = textOf(prompt);
  const echoText = textOf(echo);
  if (!promptText.startsWith(echoText)) return 'different';

  const promptFiles = new Set(prompt.flatMap((block) => (block.type === 'text' ? [] : [fileKey(block)])));
  const echoFiles = new Set(echo.flatMap((block) => (block.type === 'text' ? [] : [fileKey(block)])));
  for (const key of echoFiles) {
    if (!promptFiles.has(key)) return 'different';
  }
  return echoText === promptText && echoFiles.size === promptFiles.size ? 'complete' : 'prefix';
}

/** Block-by-block relation: the echo is the prompt verbatim, text segments folded. */
function exactRelation(
  prompt: readonly AcpUserContentBlock[],
  echo: readonly AcpUserContentBlock[],
): EchoRelation {
  const expected = coalesceText(prompt);
  const actual = coalesceText(echo);

  if (actual.length > expected.length) return 'different';
  for (let index = 0; index < actual.length; index += 1) {
    const incoming = actual[index]!;
    const target = expected[index];
    if (!target || incoming.type !== target.type) return 'different';
    if (incoming.type === 'text' && target.type === 'text') {
      const last = index === actual.length - 1;
      if (last ? !target.text.startsWith(incoming.text) : target.text !== incoming.text) {
        return 'different';
      }
    } else if (!deepEqual(incoming, target)) {
      return 'different';
    }
  }
  if (actual.length !== expected.length) return 'prefix';
  const lastActual = actual.at(-1);
  const lastExpected = expected.at(-1);
  if (lastActual?.type === 'text' && lastExpected?.type === 'text') {
    return lastActual.text === lastExpected.text ? 'equal' : 'prefix';
  }
  return 'equal';
}

/**
 * Echo reconciliation state for the outbound message of the in-flight turn
 * (issue #15): the agent's `user_message_chunk` echo is compared against what
 * `send()` dispatched optimistically. Equal → the optimistic block is
 * protocol-confirmed; different or boundary-closed → the buffered echo is
 * re-dispatched as real events and renders separately (never merged, never
 * tampered). Modeled on react-acp's PendingOutbound.
 */
interface PendingOutbound {
  prompt: AcpUserContentBlock[];
  /** Echo notifications held while the relation is still `prefix`. */
  buffered: SessionNotification[];
  /** Protocol messageId seen on the first echo chunk, if the agent sent one. */
  protocolMessageId?: string;
  /** Echo window closed (matched, diverged, or boundary passed) — pass through. */
  echoWindowClosed: boolean;
}

/** One `feed()` decision: whether the notification was absorbed, and which updates to dispatch now. */
export type EchoFeed = {
  /** True when the notification was consumed (held, confirmed, or flushed) and must not take the regular mapping path. */
  consumed: boolean;
  /** Updates to dispatch immediately — a `user_message_confirmed` event, or flushed real events that must precede the pass-through notification. */
  events: AcpSessionUpdate[];
};

export class EchoReconciler {
  private readonly pending: PendingOutbound;

  constructor(prompt: AcpUserContentBlock[]) {
    this.pending = { prompt, buffered: [], echoWindowClosed: false };
  }

  /**
   * Feeds one notification into the reconciliation. Any non-echo update while
   * a partial echo is buffered closes the echo window: the partial echo is
   * flushed as real events before it.
   */
  feed(notification: SessionNotification): EchoFeed {
    if (this.pending.echoWindowClosed) return { consumed: false, events: [] };
    const update = notification.update;
    if (update.sessionUpdate !== 'user_message_chunk') {
      if (this.pending.buffered.length > 0) {
        console.info('[panda/acp] echo window closed by non-echo update');
        return { consumed: false, events: this.close() };
      }
      return { consumed: false, events: [] };
    }
    const incomingId = update.messageId ?? undefined;
    if (this.pending.protocolMessageId && incomingId && this.pending.protocolMessageId !== incomingId) {
      // A second protocol message started echoing — the buffered one belongs
      // elsewhere; render the buffer and let this chunk through as-is.
      console.info(
        `[panda/acp] echo messageId changed (${this.pending.protocolMessageId} -> ${incomingId}) — closing the echo window`,
      );
      return { consumed: false, events: this.close() };
    }
    const previous = this.relation();
    const buffered = [...this.pending.buffered, notification];
    const relation = this.relation(buffered);
    if (previous === 'complete' && relation === 'different') {
      // A complete file-tolerant echo, then a chunk that is not part of it:
      // the next message started without a messageId. Confirm the held echo
      // and let this chunk through.
      return { consumed: false, events: this.confirm() };
    }
    this.pending.protocolMessageId ??= incomingId;
    this.pending.buffered = buffered;
    if (relation === 'equal') return { consumed: true, events: this.confirm() };
    if (relation === 'different') {
      // The agent echoed something else: keep the optimistic block untouched
      // and render the protocol version as its own message. Note a `prefix`
      // that never completes is also flushed here or at turn end — an
      // incomplete echo cannot be merged into the optimistic block because
      // it may still diverge later (react-acp semantics, doc §4.7).
      console.info('[panda/acp] echo diverged from outbound message — rendering protocol version');
      return { consumed: true, events: this.flush() };
    }
    return { consumed: true, events: [] }; // prefix and complete keep buffering
  }

  /** Turn settled: close the echo window. After this the caller drops the reconciler. */
  settle(): AcpSessionUpdate[] {
    return this.close();
  }

  /** The relation of the held echo (or of `buffered`) to the prompt. */
  private relation(buffered = this.pending.buffered): EchoRelation | null {
    if (buffered.length === 0) return null;
    return echoRelation(
      this.pending.prompt,
      buffered.map((n) => (n.update as { content: ContentBlock }).content),
    );
  }

  /** Closes the echo window: a complete echo confirms, any other is flushed. */
  private close(): AcpSessionUpdate[] {
    return this.relation() === 'complete' ? this.confirm() : this.flush();
  }

  /** Confirms the optimistic block with the held echo as its attribution. */
  private confirm(): AcpSessionUpdate[] {
    console.info(
      `[panda/acp] echo matched outbound message${this.pending.protocolMessageId ? ` (messageId ${this.pending.protocolMessageId})` : ''}`,
    );
    const confirmed: AcpSessionUpdate = {
      sessionUpdate: 'user_message_confirmed',
      protocolMessageId: this.pending.protocolMessageId,
      notifications: this.pending.buffered,
    };
    this.pending.buffered = [];
    this.pending.echoWindowClosed = true;
    return [confirmed];
  }

  /** Renders the held echo notifications as real events and closes the echo window. */
  private flush(): AcpSessionUpdate[] {
    if (this.pending.buffered.length === 0) return [];
    const events: AcpSessionUpdate[] = [];
    for (const notification of this.pending.buffered) {
      events.push(...toAcpUpdates(notification));
    }
    this.pending.buffered = [];
    this.pending.echoWindowClosed = true;
    return events;
  }
}
