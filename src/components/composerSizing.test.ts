import { describe, expect, it } from 'vitest';
import {
  COMPOSER_INPUT_MAX_SHARE,
  composerInputMaxHeight,
  followsCaretToEnd,
  visibleViewportHeight,
} from './composerSizing';

describe('composerInputMaxHeight (the text field stops growing here)', () => {
  it('is a share of the visible viewport height, in whole px', () => {
    expect(COMPOSER_INPUT_MAX_SHARE).toBe(0.4);
    expect(composerInputMaxHeight(933)).toBe(373);
    expect(composerInputMaxHeight(812)).toBe(324);
  });

  it('shrinks when the on-screen keyboard covers part of the viewport', () => {
    // iPhone Home Screen app: about 470 px stay visible above the keyboard.
    expect(composerInputMaxHeight(470)).toBe(188);
    expect(composerInputMaxHeight(470)).toBeLessThan(composerInputMaxHeight(844));
  });
});

describe('visibleViewportHeight', () => {
  it('is the visual viewport height at scale 1 (keyboard open or closed)', () => {
    expect(visibleViewportHeight({ height: 844, scale: 1 })).toBe(844);
    expect(visibleViewportHeight({ height: 470, scale: 1 })).toBe(470);
  });

  it('ignores pinch zoom: the zoomed height times the scale is the layout height', () => {
    expect(visibleViewportHeight({ height: 422, scale: 2 })).toBe(844);
  });
});

describe('followsCaretToEnd (a paste past the cap keeps the caret in view)', () => {
  it('follows a focused field whose caret is at the end of the text', () => {
    expect(followsCaretToEnd({ focused: true, selectionEnd: 40, length: 40 })).toBe(true);
  });

  it('leaves an edit in the middle of the text to the browser', () => {
    expect(followsCaretToEnd({ focused: true, selectionEnd: 12, length: 40 })).toBe(false);
  });

  it('never scrolls a field without focus (a restored draft opens at its top)', () => {
    expect(followsCaretToEnd({ focused: false, selectionEnd: 40, length: 40 })).toBe(false);
  });
});
