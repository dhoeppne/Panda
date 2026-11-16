import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Undo2 } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useImperativeAlertDialog } from '@astryxdesign/core/AlertDialog';
import {
  ATTACHMENT_URI_SCHEME,
  badgeOf,
  base64Bytes,
  formatBytes,
  kindLabel,
  kindOf,
} from '../attachments';
import type { AcpUserContentBlock, Block } from '../protocol/types';
import { useI18n } from '../i18n/context';
import { markdownComponents } from './CodeBlock';
import { FileChip } from './FileChip';
import { MessageImage } from './MessageImage';
import './messages.css';

type UserMessageBlock = Extract<Block, { kind: 'user_message' }>;
type FileBlock = Extract<AcpUserContentBlock, { type: 'resource' | 'resource_link' }>;

/** The shown name of a file: the link's name, or the name in an `attachment:` URI. */
function fileName(uri: string): string {
  if (uri.startsWith(ATTACHMENT_URI_SCHEME)) return uri.slice(ATTACHMENT_URI_SCHEME.length);
  return uri.split('/').filter(Boolean).at(-1) ?? uri;
}

/** The chip of one file block (no download: the chip only names the file). */
function fileChip(block: FileBlock, key: string): ReactNode {
  const { name, mimeType, size } =
    block.type === 'resource_link'
      ? { name: block.name, mimeType: block.mimeType ?? '', size: block.size }
      : {
          name: fileName(block.resource.uri),
          mimeType: block.resource.mimeType ?? '',
          size: base64Bytes(block.resource.blob),
        };
  const sub = size === undefined ? kindLabel(mimeType) : `${kindLabel(mimeType)} · ${formatBytes(size)}`;
  return <FileChip key={key} name={name} badge={badgeOf(name, kindOf(mimeType))} sub={sub} />;
}

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
 * Right-aligned chat bubble, capped at 70% of the content column. The text
 * blocks render as one markdown document; the images and files follow in
 * one row (images as pictures, files as chips), order preserved. A replay
 * names an image twice (a `resource_link` and the `image`): the link of an
 * image the message shows is not drawn. Under it: a copy icon, always, and
 * on a protocol-confirmed block a rewind icon behind a confirm.
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
  const text = block.content.flatMap((c) => (c.type === 'text' ? [c.text] : []));
  const imageUris = new Set(
    block.content.flatMap((c) => (c.type === 'image' && c.uri !== undefined ? [c.uri] : [])),
  );
  const attachments: ReactNode[] = [];
  block.content.forEach((c, index) => {
    if (c.type === 'image') attachments.push(<MessageImage key={`i-${index}`} image={c} />);
    else if (c.type === 'resource') attachments.push(fileChip(c, `f-${index}`));
    else if (c.type === 'resource_link' && !imageUris.has(c.uri)) attachments.push(fileChip(c, `f-${index}`));
  });

  return (
    <div className="user-message">
      <div className="md-body user-message-bubble">
        {text.length > 0 && (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {text.join('\n\n')}
          </ReactMarkdown>
        )}
        {attachments.length > 0 && <div className="user-message-attachments">{attachments}</div>}
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
