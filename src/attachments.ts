import type { AcpUserContentBlock } from './protocol/types';
import { t } from './i18n';
import { randomUuid } from './uuid';

// The limits and kinds of the attachments design (creche
// docs/design/attachments.md, rust/crates/wire/vectors/scan.json). The door
// checks the same numbers and refuses the whole prompt; Panda checks them
// first, so a file over a limit stays visible in red and is never sent.
export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
export const MAX_NAME_BYTES = 255;
export const ATTACHMENT_URI_SCHEME = 'attachment:';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const PDF_TYPES = ['application/pdf'] as const;
export const TEXT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'text/x-python',
  'text/x-rust',
  'text/x-go',
  'text/x-c',
  'text/x-c++',
  'text/x-java',
  'text/x-typescript',
  'text/x-shellscript',
  'application/json',
  'application/xml',
  'application/yaml',
  'application/toml',
  'application/javascript',
  'application/typescript',
  'application/x-sh',
  'application/sql',
] as const;

/** The kind of a file, as the scanner groups the types. */
export type AttachmentKind = 'image' | 'pdf' | 'text';

/**
 * The type of a file by its extension. Browsers report an empty type for
 * most code files, and a wrong one for some (`.ts` is `video/mp2t`), so a
 * known extension wins over a type outside the allowed lists.
 */
export const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/x-typescript',
  tsx: 'text/x-typescript',
  mts: 'text/x-typescript',
  cts: 'text/x-typescript',
  py: 'text/x-python',
  rs: 'text/x-rust',
  go: 'text/x-go',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  cc: 'text/x-c++',
  cxx: 'text/x-c++',
  hpp: 'text/x-c++',
  hh: 'text/x-c++',
  java: 'text/x-java',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  sql: 'application/sql',
};

/** Which kinds the foreground agent takes: `image` and `embeddedContext`. */
export type AttachmentAccept = { image: boolean; files: boolean };

export type FileAttachment = {
  id: string;
  name: string;
  mimeType: string;
  /** Base64 bytes; empty for a file that can never be sent (unknown kind, over the file limit). */
  data: string;
  size: number;
};

/** Why Panda does not send a file. */
export type AttachmentRefusal = 'notAllowed' | 'fileTooLarge' | 'messageTooLarge' | 'tooMany';

export type ClassifiedAttachment = FileAttachment & {
  kind: AttachmentKind | null;
  refusal: AttachmentRefusal | null;
};

/** The lower-case extension of a file name, or '' when it has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function kindOf(mimeType: string): AttachmentKind | null {
  if ((IMAGE_TYPES as readonly string[]).includes(mimeType)) return 'image';
  if ((PDF_TYPES as readonly string[]).includes(mimeType)) return 'pdf';
  if ((TEXT_TYPES as readonly string[]).includes(mimeType)) return 'text';
  return null;
}

/** The type Panda claims for a file: the browser type when allowed, else the extension's. */
export function resolveMimeType(name: string, browserType: string): string {
  if (kindOf(browserType) !== null) return browserType;
  return EXTENSION_TYPES[extensionOf(name)] ?? browserType;
}

/** True when the agent takes files of this kind. */
export function acceptsKind(kind: AttachmentKind | null, accept: AttachmentAccept): boolean {
  if (kind === null) return false;
  return kind === 'image' ? accept.image : accept.files;
}

/** The `accept` attribute of the file input: every type and extension the agent takes. */
export function acceptAttribute(accept: AttachmentAccept): string {
  const types: string[] = [];
  if (accept.image) types.push(...IMAGE_TYPES);
  if (accept.files) types.push(...PDF_TYPES, ...TEXT_TYPES);
  const extensions = Object.entries(EXTENSION_TYPES)
    .filter(([, type]) => acceptsKind(kindOf(type), accept))
    .map(([extension]) => `.${extension}`);
  return [...types, ...extensions].join(',');
}

// A control character (C0, DEL, C1), NUL included, or a `/`.
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f/]/g;

/**
 * The name of a file in its `attachment:` URI (design section 3): `/`, NUL
 * and control characters become `_`, the name is cut to 255 UTF-8 bytes on
 * a character boundary, and `.` or `..` becomes underscores. Returns '' for
 * an empty name, so the caller can choose a default.
 */
export function cleanAttachmentName(raw: string): string {
  const replaced = raw.replace(UNSAFE_NAME_CHARS, '_');
  const encoder = new TextEncoder();
  let name = '';
  let bytes = 0;
  for (const char of replaced) {
    const size = encoder.encode(char).length;
    if (bytes + size > MAX_NAME_BYTES) break;
    name += char;
    bytes += size;
  }
  if (name === '.' || name === '..') return name.replace(/\./g, '_');
  return name;
}

/**
 * Validation is positional: a file refused for its kind or size stays
 * visible but is never sent, and the files after it are judged without it.
 * The first four sendable files within 10 MiB in all go.
 */
export function classifyAttachments(
  items: FileAttachment[],
  accept: AttachmentAccept,
): ClassifiedAttachment[] {
  let count = 0;
  let total = 0;
  return items.map((item) => {
    const kind = kindOf(item.mimeType);
    const refusal: AttachmentRefusal | null = !acceptsKind(kind, accept)
      ? 'notAllowed'
      : item.size > MAX_FILE_BYTES
        ? 'fileTooLarge'
        : count >= MAX_FILES
          ? 'tooMany'
          : total + item.size > MAX_MESSAGE_BYTES
            ? 'messageTooLarge'
            : null;
    if (refusal === null) {
      count += 1;
      total += item.size;
    }
    return { ...item, kind, refusal };
  });
}

/** The prompt block of one sendable file (design section 3). */
function toPromptBlock(item: ClassifiedAttachment): AcpUserContentBlock {
  const uri = `${ATTACHMENT_URI_SCHEME}${item.name}`;
  if (item.kind === 'image') {
    return { type: 'image', data: item.data, mimeType: item.mimeType, uri };
  }
  return { type: 'resource', resource: { uri, mimeType: item.mimeType, blob: item.data } };
}

/** Canonical prompt ordering: sendable files first, then trimmed text when present. */
export function buildPromptContent(
  attachments: FileAttachment[],
  text: string,
  accept: AttachmentAccept,
): AcpUserContentBlock[] {
  const content: AcpUserContentBlock[] = classifyAttachments(attachments, accept)
    .filter((item) => item.refusal === null)
    .map(toPromptBlock);
  const trimmed = text.trim();
  if (trimmed) content.push({ type: 'text', text: trimmed });
  return content;
}

/** The text of a refusal, for the red chip or tile. */
export function refusalText(refusal: AttachmentRefusal): string {
  switch (refusal) {
    case 'notAllowed':
      return t('attach.notAllowed');
    case 'fileTooLarge':
      return t('attach.fileTooLarge');
    case 'messageTooLarge':
      return t('attach.messageTooLarge');
    case 'tooMany':
      return t('attach.tooMany', { n: MAX_FILES });
  }
}

/** A short size: "512 B", "18 KB", "1.2 MB". */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** The badge of a file chip: its extension in capitals (4 at most), or its kind. */
export function badgeOf(name: string, kind: AttachmentKind | null): string {
  const extension = extensionOf(name);
  if (extension !== '' && extension.length <= 4) return extension.toUpperCase();
  if (kind === 'pdf') return 'PDF';
  if (kind === 'text') return 'TXT';
  return 'FILE';
}

/** The kind label of a file chip: "PDF", "Text", "Code" or "Image". */
export function kindLabel(mimeType: string): string {
  const kind = kindOf(mimeType);
  if (kind === 'image') return t('attach.kindImage');
  if (kind === 'pdf') return 'PDF';
  if (kind === 'text') {
    const plain = mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/csv';
    return plain ? t('attach.kindText') : t('attach.kindCode');
  }
  return t('attach.kindFile');
}

/** The byte size of a base64 payload. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Reads a file without transcoding; the type and base64 bytes go to ACP
 * unchanged. A file of an unknown kind or over the file limit can never be
 * sent, so its bytes are not read.
 */
export async function fileToAttachment(file: File): Promise<FileAttachment> {
  const name = cleanAttachmentName(file.name) || t('attach.pastedName');
  const mimeType = resolveMimeType(name, file.type);
  const sendable = kindOf(mimeType) !== null && file.size <= MAX_FILE_BYTES;
  const data = sendable ? bytesToBase64(new Uint8Array(await file.arrayBuffer())) : '';
  return { id: randomUuid(), name, mimeType, data, size: file.size };
}
