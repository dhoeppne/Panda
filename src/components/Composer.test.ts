import { describe, expect, it } from 'vitest';
import { attachHintState, isImeComposition, queuedPreview, submitAction } from './Composer';

describe('isImeComposition (bug hunt #2: IME Enter must not submit)', () => {
  it('flags the live composition marker', () => {
    expect(isImeComposition({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it('flags the legacy keyCode 229 marker (engines that never set isComposing)', () => {
    expect(isImeComposition({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeComposition({ keyCode: 229 })).toBe(true);
  });

  it('passes through ordinary keys, including plain Enter', () => {
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeComposition({})).toBe(false);
  });
});

describe('attachHintState (#214: no agent, no capability claims)', () => {
  it('renders no hint while no agent is connected or connecting', () => {
    expect(attachHintState(undefined)).toBeNull();
  });

  it('names a negotiated agent that takes no files', () => {
    expect(attachHintState({ image: false, files: false })).toBe('unavailable');
  });

  it('names the kinds a negotiated agent takes', () => {
    expect(attachHintState({ image: true, files: true })).toBe('all');
    expect(attachHintState({ image: true, files: false })).toBe('images');
    expect(attachHintState({ image: false, files: true })).toBe('files');
  });
});

describe('submitAction (queue messages mid-turn)', () => {
  it('sends when the composer is open', () => {
    expect(submitAction({ hasContent: true, disabled: false, canQueue: false })).toBe('send');
  });

  it('queues while a turn runs or awaits approval', () => {
    expect(submitAction({ hasContent: true, disabled: true, canQueue: true })).toBe('queue');
  });

  it('does nothing with no content, or when the composer is closed for another reason', () => {
    expect(submitAction({ hasContent: false, disabled: false, canQueue: false })).toBe('none');
    expect(submitAction({ hasContent: false, disabled: true, canQueue: true })).toBe('none');
    expect(submitAction({ hasContent: true, disabled: true, canQueue: false })).toBe('none');
  });
});

describe('queuedPreview', () => {
  const images = (count: number) => `${count} file(s)`;

  it('flattens text blocks into one line', () => {
    expect(
      queuedPreview({ id: 'q', content: [{ type: 'text', text: 'first\n\nsecond  line' }] }, images),
    ).toBe('first second line');
  });

  it('adds a file count (images included), alone or after the text', () => {
    const image = { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' };
    const pdf = {
      type: 'resource' as const,
      resource: { uri: 'attachment:a.pdf', mimeType: 'application/pdf', blob: 'AAAA' },
    };
    expect(queuedPreview({ id: 'q', content: [image, image] }, images)).toBe('2 file(s)');
    expect(queuedPreview({ id: 'q', content: [image, pdf, { type: 'text', text: 'look' }] }, images)).toBe(
      'look · 2 file(s)',
    );
  });
});
