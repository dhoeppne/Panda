/**
 * Edge-swipe navigation gesture (the mobile drawer, <768px).
 *
 * The drawer is CSS: Sidebar.css holds the fixed aside, its off-screen
 * `translateX(-100%)` and the `sidebar--open` class. This module is the
 * GESTURE — pure, so the rules that make a swipe feel native can be tested
 * without a browser: which pointerdown may start a pan, when a drag has
 * committed to the horizontal axis, where the drawer sits mid-drag, and
 * where it settles on release.
 *
 * The wiring in App.tsx owns the events and writes the geometry to CSS
 * custom properties on the shell. That split is deliberate: a drag must
 * never re-render the app, because the message stream is virtualized and a
 * state update per pointermove would fight Virtuoso.
 *
 * Two surfaces pan. Closed: the page's left edge only, and never out of a
 * control's or a text field's own gesture. Open: the scrim and the drawer,
 * so a leftward drag anywhere on the open navigation closes it. The
 * hamburger button stays the accessible path to the drawer — the gesture is
 * an addition, never the only way in.
 */

/**
 * The edge zone, measured from the viewport's left edge. Deliberately wider
 * than a hairline: the outermost few pixels belong to the operating system —
 * Android's back gesture and iOS Safari's back swipe run below the page and
 * no web API opts out of them. Starting the pan just inside that region is
 * what makes the gesture reliable, and it still reads as "from the edge".
 */
export const EDGE_ZONE_PX = 24;

/** Below this travel on both axes the drag has no axis yet. */
export const SWIPE_SLOP_PX = 8;

/**
 * How far the horizontal axis must beat the vertical one before the drag
 * commits. A vertically scrolling list is the common case: a diagonal thumb
 * must scroll it, never drag the drawer.
 */
export const DIRECTION_RATIO = 1.5;

/** px/ms above which the release is a flick, and the flick decides. */
export const FLICK_VELOCITY = 0.5;

/** Only pointer samples this recent feed the release velocity, so a drag
 * that paused before letting go does not read as a flick. */
export const FLICK_WINDOW_MS = 100;

/**
 * Elements that pan horizontally themselves: a leftward drag on one of them
 * is that element's scroll, never a drawer swipe. The stream's code blocks,
 * diff tables, markdown tables and raw JSON dumps are the cases that matter.
 * Each is its own scroll container, which is also why each keeps
 * `touch-action: auto` against the shell's `pan-y` — the browser intersects
 * touch-action only up to the nearest scrolling element (App.css).
 */
export const HORIZONTAL_PAN_SELECTOR = 'pre, table, .diff-scroll, .tool-input-pre, .disclosure-body--raw';

/** Text fields and editable regions keep their own drag: caret and selection. */
export const TEXT_ENTRY_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/** Where the pointerdown landed. */
export type SwipeSurface =
  /** Page content, behind a closed drawer. */
  | 'page'
  /** The dimmed overlay that covers the page while the drawer is open. */
  | 'scrim'
  /** The drawer itself. */
  | 'drawer';

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical';

/** The structural facts of a pointerdown, as the component reads them. */
export type SwipeStart = {
  surface: SwipeSurface;
  /** clientX within EDGE_ZONE_PX of the viewport's left edge. */
  fromEdge: boolean;
  /** The target sits inside INTERACTIVE_CONTROL_SELECTOR (scrollPolicy.ts). */
  onControl: boolean;
  /** The target sits inside TEXT_ENTRY_SELECTOR. */
  inTextEntry: boolean;
  /** The target sits inside HORIZONTAL_PAN_SELECTOR. */
  inHorizontalPan: boolean;
  /** The drawer is open at pointerdown. */
  open: boolean;
};

/** May this pointerdown start a drawer pan? */
export function beginsDrawerSwipe(start: SwipeStart): boolean {
  if (start.inHorizontalPan) return false;
  if (start.open) {
    // Closing: the scrim and the drawer pan, their rows and buttons
    // included — a tap is not a drag, so the slop and the axis lock leave
    // clicks intact.
    return start.surface !== 'page' && !start.inTextEntry;
  }
  // Opening: the page's left edge, and never out of a control's gesture.
  return start.surface === 'page' && start.fromEdge && !start.onControl && !start.inTextEntry;
}

/** The drag's axis, committed once either axis passes SWIPE_SLOP_PX. */
export function swipeAxis(dx: number, dy: number): SwipeAxis {
  if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return 'undecided';
  return Math.abs(dx) >= Math.abs(dy) * DIRECTION_RATIO ? 'horizontal' : 'vertical';
}

/**
 * Where the drawer sits mid-drag: 0 = closed, `width` = fully open. A drag
 * that has not committed to the horizontal axis leaves it where it started,
 * so a vertical scroll never nudges the drawer.
 */
export function drawerOffset(input: {
  startX: number;
  x: number;
  width: number;
  open: boolean;
  axis: SwipeAxis;
}): number {
  const base = input.open ? input.width : 0;
  if (input.axis !== 'horizontal') return base;
  const moved = base + (input.x - input.startX);
  return Math.min(input.width, Math.max(0, moved));
}

/** One pointer sample of an in-flight drag. */
export type DragSample = { x: number; at: number };

/**
 * The release velocity in px/ms, from the samples inside FLICK_WINDOW_MS
 * before `now`. Two samples or fewer in the window is no flick.
 */
export function releaseVelocity(samples: readonly DragSample[], now: number): number {
  const recent = samples.filter((sample) => now - sample.at <= FLICK_WINDOW_MS);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined) return 0;
  const span = last.at - first.at;
  return span > 0 ? (last.x - first.x) / span : 0;
}

/**
 * Where the drawer settles when the pointer lifts. A flick wins over
 * position — a short fast flick opens the drawer, and a fast leftward flick
 * closes one that is nearly open. Otherwise the halfway point decides.
 */
export function settleDrawer(input: { offset: number; velocity: number; width: number }): 'open' | 'closed' {
  if (input.velocity >= FLICK_VELOCITY) return 'open';
  if (input.velocity <= -FLICK_VELOCITY) return 'closed';
  return input.offset >= input.width / 2 ? 'open' : 'closed';
}
