import { useSyncExternalStore } from 'react';

/**
 * The composer's text field grows with its text, up to a cap. Growth itself
 * is CSS (Composer.css, `.composer-grow`): no measuring, so a height change
 * never forces a layout that could move the stream's scroll position. This
 * file owns the cap.
 *
 * The cap is a share of the VISIBLE viewport height. On iOS the on-screen
 * keyboard covers the page instead of resizing it (`100dvh` keeps its
 * value), so a share of the layout viewport could push the send button
 * behind the keyboard. `visualViewport` reports the part of the page that
 * is on screen.
 */
export const COMPOSER_INPUT_MAX_SHARE = 0.4;

/** The text field's maximum height in px for a visible viewport height. */
export function composerInputMaxHeight(visibleHeight: number): number {
  return Math.floor(visibleHeight * COMPOSER_INPUT_MAX_SHARE);
}

/**
 * The visible viewport height in layout px. `height` shrinks when the
 * keyboard opens (scale 1). It also shrinks under pinch zoom, where `scale`
 * grows by the same factor: the product stays the layout height, so zooming
 * in does not shrink the text field.
 */
export function visibleViewportHeight(viewport: { height: number; scale: number }): number {
  return Math.round(viewport.height * viewport.scale);
}

/**
 * True when a text change should scroll the text field to its bottom: the
 * field has focus and the caret sits at the end of the text. A paste that
 * grows the field past its cap in one step otherwise leaves the field
 * scrolled to the top, with the caret out of view.
 */
export function followsCaretToEnd(field: {
  focused: boolean;
  selectionEnd: number;
  length: number;
}): boolean {
  return field.focused && field.selectionEnd === field.length;
}

function subscribe(onChange: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener('resize', onChange);
  return () => viewport.removeEventListener('resize', onChange);
}

function snapshot(): number | null {
  const viewport = window.visualViewport;
  return viewport ? composerInputMaxHeight(visibleViewportHeight(viewport)) : null;
}

/**
 * The text field's current maximum height in px, or null where the browser
 * has no `visualViewport` (the CSS fallback, a share of `dvh`, applies).
 */
export function useComposerInputMaxHeight(): number | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
