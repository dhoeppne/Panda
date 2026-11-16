import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_URI_SCHEME,
  EXTENSION_TYPES,
  IMAGE_TYPES,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_NAME_BYTES,
  PDF_TYPES,
  TEXT_TYPES,
  acceptAttribute,
  badgeOf,
  base64Bytes,
  buildPromptContent,
  classifyAttachments,
  cleanAttachmentName,
  fileToAttachment,
  formatBytes,
  kindLabel,
  kindOf,
  resolveMimeType,
  type AttachmentAccept,
  type FileAttachment,
} from './attachments';

const ALL: AttachmentAccept = { image: true, files: true };

const file = (id: string, mimeType = 'image/png', size = 10): FileAttachment => ({
  id,
  name: `${id}.${mimeType === 'image/png' ? 'png' : 'bin'}`,
  mimeType,
  data: id,
  size,
});

// The numbers and lists of creche rust/crates/wire/vectors/scan.json.
describe('limits and kinds of the attachments design', () => {
  it('holds the numbers of scan.json', () => {
    expect(MAX_FILES).toBe(4);
    expect(MAX_FILE_BYTES).toBe(8388608);
    expect(MAX_MESSAGE_BYTES).toBe(10485760);
    expect(MAX_NAME_BYTES).toBe(255);
    expect(ATTACHMENT_URI_SCHEME).toBe('attachment:');
  });

  it('holds the kinds of scan.json', () => {
    expect(IMAGE_TYPES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    expect(PDF_TYPES).toEqual(['application/pdf']);
    expect(TEXT_TYPES).toHaveLength(22);
    expect(TEXT_TYPES).toContain('text/x-typescript');
    expect(TEXT_TYPES).toContain('application/sql');
  });

  it('maps every extension to an allowed type', () => {
    for (const type of Object.values(EXTENSION_TYPES)) expect(kindOf(type)).not.toBeNull();
  });
});

describe('kind and type of a file', () => {
  it('classifies the allowed types', () => {
    expect(kindOf('image/webp')).toBe('image');
    expect(kindOf('application/pdf')).toBe('pdf');
    expect(kindOf('text/x-rust')).toBe('text');
    expect(kindOf('application/zip')).toBeNull();
    expect(kindOf('image/svg+xml')).toBeNull();
  });

  it('keeps an allowed browser type', () => {
    expect(resolveMimeType('notes.txt', 'text/plain')).toBe('text/plain');
    expect(resolveMimeType('a.png', 'image/png')).toBe('image/png');
  });

  it('takes the extension type for an empty, generic or wrong browser type', () => {
    expect(resolveMimeType('README.md', '')).toBe('text/markdown');
    expect(resolveMimeType('main.py', 'text/x-python-script')).toBe('text/x-python');
    expect(resolveMimeType('lib.rs', 'application/octet-stream')).toBe('text/x-rust');
    expect(resolveMimeType('door.ts', 'video/mp2t')).toBe('text/x-typescript');
    expect(resolveMimeType('App.tsx', '')).toBe('text/x-typescript');
    expect(resolveMimeType('Cargo.toml', '')).toBe('application/toml');
    expect(resolveMimeType('ci.YML', '')).toBe('application/yaml');
    expect(resolveMimeType('q.sql', 'application/x-sql')).toBe('application/sql');
    expect(resolveMimeType('x.cpp', '')).toBe('text/x-c++');
    expect(resolveMimeType('x.h', '')).toBe('text/x-c');
  });

  it('keeps an unknown type, which is refused', () => {
    expect(resolveMimeType('backup.zip', 'application/zip')).toBe('application/zip');
    expect(resolveMimeType('Makefile', '')).toBe('');
  });

  it('lists the types and extensions the agent takes for the file input', () => {
    const imagesOnly = acceptAttribute({ image: true, files: false }).split(',');
    expect(imagesOnly).toContain('image/png');
    expect(imagesOnly).toContain('.jpg');
    expect(imagesOnly).not.toContain('application/pdf');
    expect(imagesOnly).not.toContain('.md');
    const all = acceptAttribute(ALL).split(',');
    expect(all).toContain('application/pdf');
    expect(all).toContain('.rs');
  });
});

describe('cleanAttachmentName', () => {
  it('replaces a slash, NUL and control characters', () => {
    expect(cleanAttachmentName('a/b\u0000c\nd\u007fe\u0085f.txt')).toBe('a_b_c_d_e_f.txt');
  });

  it('never gives . or ..', () => {
    expect(cleanAttachmentName('.')).toBe('_');
    expect(cleanAttachmentName('..')).toBe('__');
    expect(cleanAttachmentName('.env')).toBe('.env');
  });

  it('cuts to 255 UTF-8 bytes on a character boundary', () => {
    const ascii = cleanAttachmentName('a'.repeat(300));
    expect(ascii).toBe('a'.repeat(255));
    const wide = cleanAttachmentName('文'.repeat(100)); // 3 bytes each
    expect(new TextEncoder().encode(wide).length).toBe(255);
    const emoji = cleanAttachmentName(`a${'😀'.repeat(70)}`); // 1 + 4n bytes
    expect(new TextEncoder().encode(emoji).length).toBe(253);
  });

  it('gives an empty name back empty, for the caller default', () => {
    expect(cleanAttachmentName('')).toBe('');
  });
});

describe('classifyAttachments (positional)', () => {
  it('refuses a kind the agent does not take, and keeps it visible', () => {
    const items = [file('zip', 'application/zip'), file('pdf', 'application/pdf'), file('img')];
    expect(classifyAttachments(items, ALL).map((item) => item.refusal)).toEqual(['notAllowed', null, null]);
    expect(
      classifyAttachments(items, { image: true, files: false }).map((item) => item.refusal),
    ).toEqual(['notAllowed', 'notAllowed', null]);
    expect(
      classifyAttachments(items, { image: false, files: true }).map((item) => item.refusal),
    ).toEqual(['notAllowed', null, 'notAllowed']);
  });

  it('refuses a file over 8 MiB and a fifth sendable file', () => {
    const items = [
      file('one'),
      file('big', 'image/png', MAX_FILE_BYTES + 1),
      file('two'),
      file('three'),
      file('four'),
      file('five'),
    ];
    expect(classifyAttachments(items, ALL).map((item) => item.refusal)).toEqual([
      null,
      'fileTooLarge',
      null,
      null,
      null,
      'tooMany',
    ]);
  });

  it('refuses the file that takes the message over 10 MiB in all, and lets a smaller one after it go', () => {
    const items = [
      file('a', 'application/pdf', MAX_FILE_BYTES),
      file('b', 'application/pdf', 3 * 1024 * 1024),
      file('c', 'text/plain', 1024 * 1024),
    ];
    expect(classifyAttachments(items, ALL).map((item) => item.refusal)).toEqual([
      null,
      'messageTooLarge',
      null,
    ]);
  });

  it('accepts exactly 10 MiB in all', () => {
    const items = [file('a', 'application/pdf', MAX_FILE_BYTES), file('b', 'text/plain', MAX_MESSAGE_BYTES - MAX_FILE_BYTES)];
    expect(classifyAttachments(items, ALL).map((item) => item.refusal)).toEqual([null, null]);
  });
});

describe('buildPromptContent', () => {
  it('builds files first and trimmed text last, without refused files', () => {
    const items: FileAttachment[] = [
      { id: '1', name: 'shot.png', mimeType: 'image/png', data: 'aW1n', size: 3 },
      { id: '2', name: 'lease.pdf', mimeType: 'application/pdf', data: 'cGRm', size: 3 },
      { id: '3', name: 'backup.zip', mimeType: 'application/zip', data: '', size: 3 },
      { id: '4', name: 'door.ts', mimeType: 'text/x-typescript', data: 'dHM=', size: 2 },
    ];

    expect(buildPromptContent(items, '  compare  ', ALL)).toEqual([
      { type: 'image', data: 'aW1n', mimeType: 'image/png', uri: 'attachment:shot.png' },
      {
        type: 'resource',
        resource: { uri: 'attachment:lease.pdf', mimeType: 'application/pdf', blob: 'cGRm' },
      },
      {
        type: 'resource',
        resource: { uri: 'attachment:door.ts', mimeType: 'text/x-typescript', blob: 'dHM=' },
      },
      { type: 'text', text: 'compare' },
    ]);
  });

  it('builds a prompt of files alone', () => {
    expect(buildPromptContent([file('one')], '   ', ALL)).toEqual([
      { type: 'image', data: 'one', mimeType: 'image/png', uri: 'attachment:one.png' },
    ]);
  });

  it('sends no file the agent does not take', () => {
    const items = [file('pdf', 'application/pdf')];
    expect(buildPromptContent(items, 'hi', { image: true, files: false })).toEqual([{ type: 'text', text: 'hi' }]);
  });
});

describe('fileToAttachment', () => {
  it('preserves the image type and bytes in base64', async () => {
    const image = new File([new Uint8Array([0, 1, 2, 254, 255])], 'raw.webp', { type: 'image/webp' });

    expect(await fileToAttachment(image)).toMatchObject({
      name: 'raw.webp',
      mimeType: 'image/webp',
      size: 5,
      data: 'AAEC/v8=',
    });
  });

  it('types a code file by its extension and cleans its name', async () => {
    const code = new File(['fn main() {}\n'], 'src/main.rs', { type: '' });

    expect(await fileToAttachment(code)).toMatchObject({
      name: 'src_main.rs',
      mimeType: 'text/x-rust',
      data: btoa('fn main() {}\n'),
    });
  });

  it('does not read a file that can never be sent', async () => {
    const zip = new File([new Uint8Array([80, 75])], 'backup.zip', { type: 'application/zip' });

    expect(await fileToAttachment(zip)).toMatchObject({ mimeType: 'application/zip', data: '', size: 2 });
  });

  it('names a pasted file with no name', async () => {
    const pasted = new File([new Uint8Array([1])], '', { type: 'image/png' });

    expect((await fileToAttachment(pasted)).name).toBe('Pasted image');
  });
});

describe('chip text', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(18 * 1024)).toBe('18 KB');
    expect(formatBytes(1.2 * 1024 * 1024)).toBe('1.2 MB');
  });

  it('badges by extension, or by kind', () => {
    expect(badgeOf('lease.pdf', 'pdf')).toBe('PDF');
    expect(badgeOf('door.ts', 'text')).toBe('TS');
    expect(badgeOf('notes', 'text')).toBe('TXT');
    expect(badgeOf('data.parquet', null)).toBe('FILE');
  });

  it('labels the kind', () => {
    expect(kindLabel('application/pdf')).toBe('PDF');
    expect(kindLabel('text/markdown')).toBe('Text');
    expect(kindLabel('text/x-typescript')).toBe('Code');
    expect(kindLabel('application/zip')).toBe('File');
  });

  it('counts the bytes of a base64 payload', () => {
    expect(base64Bytes(btoa('hello'))).toBe(5);
    expect(base64Bytes(btoa('hell'))).toBe(4);
    expect(base64Bytes(btoa('hel'))).toBe(3);
  });
});
