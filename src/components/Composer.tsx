import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ListPlus, Paperclip, Play, SlidersHorizontal, Square, X } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_MESSAGE_BYTES,
  acceptAttribute,
  acceptsKind,
  badgeOf,
  buildPromptContent,
  classifyAttachments,
  fileToAttachment,
  formatBytes,
  kindLabel,
  kindOf,
  refusalText,
  resolveMimeType,
  type AttachmentAccept,
  type FileAttachment,
} from '../attachments';
import { draftForKey, useComposerDrafts } from '../composerDrafts';
import { queueForKey, useMessageQueue, type QueuedMessage } from '../messageQueue';
import { beginAttachmentRead, updaterWorkLocked } from '../updateSafety';
import type {
  AcpAvailableCommand,
  AcpConfigOption,
  AcpSessionModeState,
  AcpUserContentBlock,
} from '../protocol/types';
import {
  commandCompletion,
  commandKeyAction,
  commandMenu,
  wrapIndex,
  type CommandSource,
} from '../commands';
import { ConfigPanelCard } from './ConfigPanel';
import { FileChip } from './FileChip';
import { usePopoverDismiss } from './usePopoverDismiss';
import { ContentColumn } from './ContentColumn';
import { followsCaretToEnd, useComposerInputMaxHeight } from './composerSizing';
import { ModePicker } from './ModePicker';
import './Composer.css';
import { useI18n } from '../i18n/context';

/**
 * True while a keydown belongs to an IME composition (bug hunt #2). Enter
 * during composition confirms the candidate — Safari/WKWebView (the desktop
 * shell) dispatches it BEFORE `compositionend`, Firefox after; both must be
 * ignored, or the raw pinyin ("nihao") gets submitted and the composer is
 * cleared mid-composition. keyCode 229 is the legacy marker some engines
 * set on every composition keydown.
 */
export function isImeComposition(e: { isComposing?: boolean; keyCode?: number }): boolean {
  return e.isComposing === true || e.keyCode === 229;
}

/**
 * The composer's attachment-hint decision (#214): a verdict only when the
 * foreground agent's capabilities are negotiated; `undefined` (no agent,
 * still connecting) renders no hint at all — a "this agent does not take
 * files" line used to greet a first run with zero agents. `images` and
 * `files` name the one kind group the agent takes.
 */
export function attachHintState(
  accept: AttachmentAccept | undefined,
): 'all' | 'images' | 'files' | 'unavailable' | null {
  if (accept === undefined) return null;
  if (accept.image && accept.files) return 'all';
  if (accept.image) return 'images';
  if (accept.files) return 'files';
  return 'unavailable';
}

/** True when the agent takes at least one kind of file. */
function acceptsAny(accept: AttachmentAccept | undefined): accept is AttachmentAccept {
  return accept !== undefined && (accept.image || accept.files);
}

/**
 * One line of a queued message for the queue strip: its text, flattened,
 * plus a file count (images included) when it carries files.
 */
export function queuedPreview(
  message: QueuedMessage,
  filesLabel: (count: number) => string,
): string {
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const files = message.content.filter((block) => block.type !== 'text').length;
  if (files === 0) return text;
  return text === '' ? filesLabel(files) : `${text} · ${filesLabel(files)}`;
}

/** True when a drag carries files (not text or a link). */
function dragHasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/**
 * What Enter (or the trailing button) does with the composer's content:
 * send it now, hold it in the queue behind the running turn, or nothing.
 */
export function submitAction(input: {
  hasContent: boolean;
  disabled: boolean;
  canQueue: boolean;
}): 'send' | 'queue' | 'none' {
  if (!input.hasContent) return 'none';
  if (!input.disabled) return 'send';
  return input.canQueue ? 'queue' : 'none';
}

export function Composer({ onSend, disabled, inputLocked, canQueue, hint, attachAccept, canStop, onStop, modes, onSetMode, commandSource, configOptions, onSetConfigOption, sessionKey, draftKey = sessionKey, family }: {
  /** The family chip (picker in a new chat, locked label in an existing one). */
  family?: React.ReactNode;
  onSend: (content: AcpUserContentBlock[]) => void;
  /** Sends and popovers are closed (turn running, link down, switching). */
  disabled: boolean;
  /** The text field itself is closed — everything but awaiting-approval
   * (#216): while a permission waits the composer stays writable so the
   * next message can be drafted, sending is still held back by disabled. */
  inputLocked: boolean;
  /** A turn is running or awaiting approval: Enter queues the message, and
   * the queue sends it when the turn ends (messageQueue.ts). */
  canQueue: boolean;
  hint?: string;
  /**
   * Attachment verdict for the foreground agent (#214): which kinds it
   * takes (`image` → images, `embeddedContext` → other files), only once
   * capabilities are negotiated; `undefined` = no agent connected (or still
   * connecting) — the attach stays inert and NO hint renders, because a
   * nonexistent agent cannot "fail to declare" anything.
   */
  attachAccept: AttachmentAccept | undefined;
  /** True while a live turn runs — the send button becomes a stop button. */
  canStop?: boolean;
  onStop?: () => void;
  /** Session modes from the document; null hides the picker entirely. */
  modes: AcpSessionModeState | null;
  onSetMode: (modeId: string) => void;
  /** Where the `/` menu's list comes from (commands.ts CommandSource). */
  commandSource: CommandSource;
  /** Agent-advertised session config options; null/[] hides the settings entry. */
  configOptions: AcpConfigOption[] | null;
  onSetConfigOption: (configId: string, value: string | boolean) => void;
  /** Live connection/session identity for the queue, and default draft key. */
  sessionKey: string;
  /** Durable family/session identity; live queues keep their connection-specific sessionKey. */
  draftKey?: string;
}) {
  const { t } = useI18n();
  const draft = useComposerDrafts((s) => draftForKey(s, draftKey));
  const { value, attachments, attachmentError } = draft;
  const queue = useMessageQueue((s) => queueForKey(s, sessionKey));
  const setDraft = (patch: Partial<{ value: string; attachments: FileAttachment[]; attachmentError: string | null }>) =>
    useComposerDrafts.getState().setDraft(draftKey, patch);
  // Function-form attachment update reads through the store (not the render
  // closure) — addFiles resolves asynchronously, where `draft` may be stale.
  const setAttachments = (update: (current: FileAttachment[]) => FileAttachment[]) => {
    const current = useComposerDrafts.getState().drafts[draftKey]?.attachments ?? [];
    useComposerDrafts.getState().setDraft(draftKey, { attachments: update(current) });
  };
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandsDismissed, setCommandsDismissed] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  // #215: the settings card is a popover anchored like the mode menu —
  // Escape / outside pointerdown close it via the shared dismiss hook.
  const closeConfig = useCallback(() => setConfigOpen(false), []);
  const configAnchorRef = usePopoverDismiss(configOpen, closeConfig);
  // #215: an open panel whose controls just went disabled (turn running,
  // link down) is dead UI hanging over the stream — collapse it; and a
  // session switch re-targets the whole composer, so the panel can't stay
  // open across it.
  useEffect(() => {
    if (configOpen && disabled) closeConfig();
  }, [configOpen, disabled, closeConfig]);
  useEffect(closeConfig, [sessionKey]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag-over overlay: enter/leave fire for every child, so a depth count
  // tells when the drag really left the card.
  const [dragDepth, setDragDepth] = useState(0);
  const accept: AttachmentAccept = attachAccept ?? { image: false, files: false };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputMaxHeight = useComposerInputMaxHeight();
  // Runs after the text field took its new height for this value.
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (
      field &&
      followsCaretToEnd({
        focused: document.activeElement === field,
        selectionEnd: field.selectionEnd,
        length: field.value.length,
      })
    ) {
      field.scrollTop = field.scrollHeight;
    }
  }, [value]);
  const promptContent = buildPromptContent(attachments, value, accept);
  const action = submitAction({ hasContent: promptContent.length > 0, disabled, canQueue });
  const canSend = action === 'send';
  const queueing = canQueue && disabled;
  const stopping = canStop === true && onStop !== undefined;
  const attachmentDisabled = inputLocked || !acceptsAny(attachAccept);
  // Panel visibility derives from the text (open only while typing the
  // command name); Escape suppresses it until the input changes again.
  const menu = commandsDismissed || inputLocked ? null : commandMenu(commandSource, value);
  const commandItems = menu?.kind === 'list' ? menu.items : [];
  const menuFamily = menu?.family ?? null;
  // A family switch swaps the list: the highlight starts at the top again.
  useEffect(() => setCommandIndex(0), [menuFamily]);
  const activeCommandRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeCommandRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [commandIndex, menuFamily]);
  const hasConfigOptions = configOptions !== null && configOptions.length > 0;

  const completeCommand = (command: AcpAvailableCommand) => {
    // The trailing space starts the argument; the panel closes itself
    // because the value no longer matches /^\/\S*$/.
    setDraft({ value: commandCompletion(command) });
  };

  const submit = () => {
    if (action === 'none' || updaterWorkLocked()) return;
    if (action === 'send') onSend(promptContent);
    else useMessageQueue.getState().enqueue(sessionKey, promptContent);
    useComposerDrafts.getState().clearDraft(draftKey);
  };

  const addFiles = async (files: File[]) => {
    if (attachmentDisabled || updaterWorkLocked() || files.length === 0) return;
    const finishRead = beginAttachmentRead();
    setDraft({ attachmentError: null });
    try {
      const added = await Promise.all(files.map(fileToAttachment));
      setAttachments((current) => [...current, ...added]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[panda/composer] failed to read a file attachment', err);
      setDraft({ attachmentError: t('composer.readFileFailed', { message }) });
    } finally { finishRead(); }
  };

  // Drag and drop: the card always takes a file drop (the browser would
  // otherwise open the file in the tab), but adds files only when the agent
  // takes some. A dropped file of a refused kind shows red and is not sent.
  const handleDragEnter = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    setDragDepth((depth) => depth + 1);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = attachmentDisabled ? 'none' : 'copy';
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    setDragDepth((depth) => Math.max(0, depth - 1));
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    setDragDepth(0);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(e.nativeEvent)) return;
    if (menu) {
      const action = commandKeyAction(e, commandItems.length);
      if (action) {
        e.preventDefault();
        if (action.type === 'complete') {
          const command = commandItems[commandIndex];
          if (command) completeCommand(command);
        } else if (action.type === 'move') {
          setCommandIndex(wrapIndex(commandIndex, action.delta, commandItems.length));
        } else {
          setCommandsDismissed(true);
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Paste takes only the files the agent takes: a rich-text paste often
  // carries an image of itself, and the text must still paste.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (attachmentDisabled) return;
    const files = Array.from(e.clipboardData.files).filter((file) =>
      acceptsKind(kindOf(resolveMimeType(file.name, file.type)), accept),
    );
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  };

  const classified = classifyAttachments(attachments, accept);
  const anyRefused = classified.some((item) => item.refusal !== null);
  const hintState = attachHintState(attachAccept);
  const hintLimits = {
    files: MAX_FILES,
    fileMb: MAX_FILE_BYTES / (1024 * 1024),
    messageMb: MAX_MESSAGE_BYTES / (1024 * 1024),
  };
  const dragging = dragDepth > 0 && !attachmentDisabled;
  const removeAttachment = (id: string) =>
    setAttachments((current) => current.filter((entry) => entry.id !== id));

  return (
    <ContentColumn className="composer-column">
        {queue.items.length > 0 && (
          <div className="composer-queue" role="region" aria-label={t('composer.queueLabel')}>
            <div className="composer-queue-head">
              <span className="composer-queue-title">
                {queue.paused
                  ? t('composer.queuePaused', { count: String(queue.items.length) })
                  : t('composer.queued', { count: String(queue.items.length) })}
              </span>
              {queue.paused && (
                <IconButton
                  variant="secondary"
                  size="sm"
                  icon={<Play size={14} />}
                  label={t('composer.queueResume')}
                  tooltip={t('composer.queueResume')}
                  clickAction={() => useMessageQueue.getState().resume(sessionKey)}
                />
              )}
            </div>
            <ol className="composer-queue-list">
              {queue.items.map((item) => {
                const preview = queuedPreview(item, (count) =>
                  t('composer.queuedFiles', { count: String(count) }),
                );
                return (
                  <li key={item.id} className="composer-queue-item">
                    <span className="composer-queue-text" title={preview}>
                      {preview}
                    </span>
                    <button
                      type="button"
                      className="composer-queue-remove"
                      aria-label={t('composer.queueRemove', { preview })}
                      onClick={() => useMessageQueue.getState().remove(sessionKey, item.id)}
                    >
                      <X size={12} />
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <div
          className={`composer-card ${disabled ? 'composer-card--disabled' : ''} ${dragging ? 'composer-card--drop' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragging && (
            <div className="composer-drop-overlay" aria-hidden="true">
              {t('composer.dropFiles')}
            </div>
          )}
          {menu && (
            <div className="composer-commands">
              <div className="composer-commands-head">
                <span>{t('composer.skills', { family: menu.family })}</span>
                {menu.kind === 'list' && (
                  <span>
                    {menu.query
                      ? t('composer.skillsMatched', { count: String(menu.items.length), total: String(menu.total) })
                      : String(menu.total)}
                  </span>
                )}
              </div>
              {menu.kind === 'loading' && (
                <div className="composer-commands-state" role="status">
                  <span className="composer-commands-spinner" aria-hidden="true" />
                  {t('composer.skillsLoading', { family: menu.family })}
                </div>
              )}
              {menu.kind === 'offline' && (
                <div className="composer-commands-state" role="status">
                  {t('composer.skillsOffline', { family: menu.family })}
                </div>
              )}
              {menu.kind === 'list' && menu.items.length === 0 && (
                <div className="composer-commands-state" role="status">
                  {t('composer.skillsNoMatch', { query: `/${menu.query}` })}
                </div>
              )}
              {commandItems.length > 0 && (
                <>
                  <div className="composer-commands-list" role="listbox" aria-label={t('composer.commands')}>
                    {commandItems.map((command, index) => (
                      <button
                        key={command.name}
                        ref={index === commandIndex ? activeCommandRef : undefined}
                        type="button"
                        role="option"
                        aria-selected={index === commandIndex}
                        className={`composer-command ${index === commandIndex ? 'composer-command--active' : ''}`}
                        // mousedown (not click): completes before the textarea loses
                        // focus, so typing can continue in the argument right away.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          completeCommand(command);
                        }}
                        onMouseEnter={() => setCommandIndex(index)}
                      >
                        <span className="composer-command-name">/{command.name}</span>
                        <span className="composer-command-desc">{command.description}</span>
                      </button>
                    ))}
                  </div>
                  {commandItems[commandIndex]?.inputHint && (
                    <div className="composer-commands-hint">
                      {t('composer.paramHint', { hint: commandItems[commandIndex].inputHint })}
                    </div>
                  )}
                  <div className="composer-commands-keys">{t('composer.skillsKeys')}</div>
                </>
              )}
            </div>
          )}
          {classified.length > 0 && (
            <div className="composer-attachments">
              {classified.map((item) =>
                // Image tiles show the picture; every other file (and an
                // image whose bytes were never read) is a chip.
                item.kind === 'image' && item.data !== '' ? (
                  <div
                    key={item.id}
                    className={`composer-tile ${item.refusal ? 'composer-tile--error' : ''}`}
                  >
                    <div
                      className={`composer-thumb ${item.refusal ? 'composer-thumb--error' : ''}`}
                    >
                      <img
                        src={`data:${item.mimeType};base64,${item.data}`}
                        alt={item.name}
                        className="composer-thumb-img"
                      />
                      <button
                        type="button"
                        onClick={() => removeAttachment(item.id)}
                        className="composer-remove"
                        aria-label={t('composer.removeAttachment', { name: item.name })}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {item.refusal && (
                      <p className="composer-tile-error">
                        {refusalText(item.refusal)}
                      </p>
                    )}
                  </div>
                ) : (
                  <FileChip
                    key={item.id}
                    name={item.name}
                    badge={badgeOf(item.name, item.kind)}
                    sub={
                      item.refusal
                        ? refusalText(item.refusal)
                        : `${kindLabel(item.mimeType)} · ${formatBytes(item.size)}`
                    }
                    refused={item.refusal !== null}
                  >
                    <button
                      type="button"
                      onClick={() => removeAttachment(item.id)}
                      className="file-chip-remove"
                      aria-label={t('composer.removeAttachment', { name: item.name })}
                    >
                      <X size={12} />
                    </button>
                  </FileChip>
                ),
              )}
            </div>
          )}
          <div className="composer-row">
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptAttribute(accept)}
              multiple
              className="composer-file-input"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            {/* The wrapper sizes the textarea to its text (Composer.css,
              * .composer-grow): data-value feeds the invisible replica. */}
            <div
              className="composer-grow"
              data-value={value}
              style={
                inputMaxHeight === null
                  ? undefined
                  : ({ '--composer-input-max': `${inputMaxHeight}px` } as React.CSSProperties)
              }
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={value}
                disabled={inputLocked}
                placeholder={hint ?? t('composer.placeholder')}
                onChange={(e) => {
                  setDraft({ value: e.target.value });
                  setCommandIndex(0);
                  setCommandsDismissed(false);
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="focus-outline-none composer-input"
              />
            </div>
          </div>
          <div className="composer-footer">
            <div className="composer-footer-lead">
              {family}
              <IconButton
                variant="ghost"
                size="sm"
                icon={<Paperclip size={16} />}
                label={t('composer.attach')}
                isDisabled={attachmentDisabled}
                tooltip={
                  hintState === 'unavailable'
                    ? t('composer.attachUnavailable')
                    : disabled
                      ? t('composer.attachDisabled')
                      : t('composer.attach')
                }
                clickAction={() => fileInputRef.current?.click()}
              />
              {modes && <ModePicker modes={modes} onSetMode={onSetMode} />}
              {hasConfigOptions && (
                <div className="composer-config-anchor" ref={configAnchorRef}>
                  {configOpen && (
                    <ConfigPanelCard options={configOptions} disabled={disabled} onSetOption={onSetConfigOption} />
                  )}
                  <IconButton
                    variant={configOpen ? 'secondary' : 'ghost'}
                    size="sm"
                    icon={<SlidersHorizontal size={16} />}
                    label={t('composer.settings')}
                    isDisabled={disabled}
                    tooltip={disabled ? t('composer.settingsDisabled') : t('composer.settings')}
                    clickAction={() => setConfigOpen((v) => !v)}
                  />
                </div>
              )}
            </div>
            <div className="composer-footer-trail">
            {queueing && (
              <IconButton
                variant="secondary"
                size="sm"
                icon={<ListPlus size={16} />}
                label={t('composer.queue')}
                tooltip={t('composer.queueHint')}
                isDisabled={action !== 'queue'}
                clickAction={submit}
              />
            )}
            {stopping ? (
              <IconButton
                variant="destructive"
                size="sm"
                icon={<Square size={11} strokeWidth={3} />}
                label={t('composer.stop')}
                clickAction={() => onStop?.()}
              />
            ) : queueing ? null : (
              <IconButton
                variant="primary"
                size="sm"
                icon={<ArrowUp size={16} strokeWidth={2.5} />}
                label={t('composer.send')}
                isDisabled={!canSend}
                clickAction={submit}
              />
            )}
            </div>
          </div>
        </div>
        {attachmentError ? (
          <p className="composer-hint composer-hint--danger">{attachmentError}</p>
        ) : anyRefused ? (
          <p className="composer-hint composer-hint--muted">{t('composer.refusedHint')}</p>
        ) : hintState === 'unavailable' ? (
          <p className="composer-hint composer-hint--muted">{t('composer.attachUnavailable')}</p>
        ) : hintState === 'all' ? (
          <p className="composer-hint composer-hint--muted">{t('composer.hintAll', hintLimits)}</p>
        ) : hintState === 'images' ? (
          <p className="composer-hint composer-hint--muted">{t('composer.hintImagesOnly', hintLimits)}</p>
        ) : hintState === 'files' ? (
          <p className="composer-hint composer-hint--muted">{t('composer.hintFilesOnly', hintLimits)}</p>
        ) : null}
    </ContentColumn>
  );
}
