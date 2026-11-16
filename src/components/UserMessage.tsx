import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Undo2 } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useImperativeAlertDialog } from '@astryxdesign/core/AlertDialog';
import type { Block } from '../protocol/types';
import { useI18n } from '../i18n/context';
import { markdownComponents } from './CodeBlock';
import { MessageImage } from './MessageImage';
import './messages.css';

type UserMessageBlock = Extract<Block, { kind: 'user_message' }>;

/**
 * Cuts the session back to before this message (creche rewind). Undefined:
 * no rewind here (the agent does not declare it, or a turn runs).
 */
export type RewindAction = (messageId: string, text: string) => void;

/** The text of a user block, as the composer takes it back. */
export function userText(block: UserMessageBlock): string {
  return block.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n\n');
}

/** How long the copy icon shows its check after a copy. */
const COPIED_MS = 1500;

/**
 * Right-aligned chat bubble, capped at 70% of the content column. Consecutive
 * text blocks render as one markdown document, images render in place, order
 * preserved. Under it: a copy icon, always, and on a protocol-confirmed
 * block a rewind icon behind a confirm.
 */
export function UserMessage({ block, onRewind }: { block: UserMessageBlock; onRewind?: RewindAction }) {
  const { t } = useI18n();
  const confirm = useImperativeAlertDialog();
  const messageId = block.optimistic === true ? undefined : block.protocolMessageId;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(userText(block));
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null;
        setCopied(false);
      }, COPIED_MS);
    } catch (err) {
      console.error('[panda/user-message] clipboard write failed', err);
    }
  };
  const children: ReactNode[] = [];
  let textBuffer: string[] = [];
  const flush = () => {
    if (textBuffer.length === 0) return;
    const md = textBuffer.join('\n\n');
    children.push(<ReactMarkdown key={`t-${children.length}`} remarkPlugins={[remarkGfm]} components={markdownComponents}>{md}</ReactMarkdown>);
    textBuffer = [];
  };
  for (const c of block.content) {
    if (c.type === 'text') textBuffer.push(c.text);
    else {
      flush();
      children.push(<MessageImage key={`i-${children.length}`} image={c} />);
    }
  }
  flush();

  return (
    <div className="user-message">
      <div className="md-body user-message-bubble">
        {children}
      </div>
      <div className="user-message-actions">
        <IconButton
          variant="ghost"
          size="sm"
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          label={copied ? t('msg.copied') : t('msg.copy')}
          tooltip={copied ? t('msg.copied') : t('msg.copy')}
          clickAction={() => void copy()}
        />
        {onRewind && messageId !== undefined && (
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Undo2 size={14} />}
            label={t('msg.rewind')}
            tooltip={t('msg.rewind')}
            clickAction={() =>
              confirm.show({
                title: t('msg.rewindTitle'),
                description: t('msg.rewindBody'),
                actionLabel: t('msg.rewindAction'),
                onAction: () => {
                  confirm.hide();
                  onRewind(messageId, userText(block));
                },
              })
            }
          />
        )}
      </div>
      {confirm.element}
    </div>
  );
}
