import { describe, expect, it } from 'vitest';
import {
  beginDrawerDrag,
  beginsDrawerSwipe,
  DIRECTION_RATIO,
  drawerDragOnMove,
  drawerDragOnRelease,
  drawerOffset,
  FLICK_VELOCITY,
  FLICK_WINDOW_MS,
  releaseVelocity,
  settleDrawer,
  SWIPE_SLOP_PX,
  swipeAxis,
  type DrawerDrag,
  type SwipeStart,
} from './navSwipe';

/** A pointerdown on the page, away from the edge, on plain content. */
const pageStart: SwipeStart = {
  surface: 'page',
  fromEdge: false,
  onControl: false,
  inTextEntry: false,
  inHorizontalPan: false,
  open: false,
};

describe('beginsDrawerSwipe', () => {
  it('opens from the page edge while the drawer is closed', () => {
    expect(beginsDrawerSwipe({ ...pageStart, fromEdge: true })).toBe(true);
  });

  it('ignores a drag that starts away from the edge', () => {
    expect(beginsDrawerSwipe(pageStart)).toBe(false);
  });

  it('ignores the edge while the drawer is already open', () => {
    // The scrim covers the page whenever the drawer is open, so a page
    // surface here is stale state, not a gesture to start.
    expect(beginsDrawerSwipe({ ...pageStart, fromEdge: true, open: true })).toBe(false);
  });

  it('never opens out of a control, a text field or a horizontal panner', () => {
    const edge = { ...pageStart, fromEdge: true };
    expect(beginsDrawerSwipe({ ...edge, onControl: true })).toBe(false);
    expect(beginsDrawerSwipe({ ...edge, inTextEntry: true })).toBe(false);
    expect(beginsDrawerSwipe({ ...edge, inHorizontalPan: true })).toBe(false);
  });

  it('closes from the scrim and from the drawer, rows and buttons included', () => {
    const open = { ...pageStart, open: true };
    expect(beginsDrawerSwipe({ ...open, surface: 'scrim' })).toBe(true);
    expect(beginsDrawerSwipe({ ...open, surface: 'drawer' })).toBe(true);
    expect(beginsDrawerSwipe({ ...open, surface: 'drawer', onControl: true })).toBe(true);
  });

  it('leaves a text field inside the drawer its own drag', () => {
    expect(beginsDrawerSwipe({ ...pageStart, open: true, surface: 'drawer', inTextEntry: true })).toBe(false);
  });

  it('refuses a horizontal panner even while the drawer is open', () => {
    expect(beginsDrawerSwipe({ ...pageStart, open: true, surface: 'drawer', inHorizontalPan: true })).toBe(false);
  });
});

describe('swipeAxis', () => {
  it('has no axis under the slop', () => {
    expect(swipeAxis(0, 0)).toBe('undecided');
    expect(swipeAxis(SWIPE_SLOP_PX - 1, -(SWIPE_SLOP_PX - 1))).toBe('undecided');
  });

  it('commits to horizontal on a straight sideways drag, either way', () => {
    expect(swipeAxis(SWIPE_SLOP_PX, 0)).toBe('horizontal');
    expect(swipeAxis(-SWIPE_SLOP_PX, 0)).toBe('horizontal');
    expect(swipeAxis(60, 20)).toBe('horizontal');
  });

  it('commits to vertical on a straight up-and-down drag', () => {
    expect(swipeAxis(0, SWIPE_SLOP_PX)).toBe('vertical');
    expect(swipeAxis(-10, 40)).toBe('vertical');
  });

  it('keeps a diagonal drag on the list, not the drawer', () => {
    // A thumb that moves as much down as sideways is scrolling.
    expect(swipeAxis(10, 10)).toBe('vertical');
    expect(swipeAxis(-10, 9)).toBe('vertical');
    expect(swipeAxis(10 * DIRECTION_RATIO, 10)).toBe('horizontal');
  });
});

describe('drawerOffset', () => {
  const base = { startX: 100, width: 240, open: false };

  it('follows the finger while the drawer opens', () => {
    expect(drawerOffset({ ...base, x: 160, axis: 'horizontal' })).toBe(60);
  });

  it('starts from fully open and follows a leftward drag when closing', () => {
    expect(drawerOffset({ ...base, open: true, x: 40, axis: 'horizontal' })).toBe(180);
  });

  it('clamps at both ends', () => {
    expect(drawerOffset({ ...base, x: 400, axis: 'horizontal' })).toBe(240);
    expect(drawerOffset({ ...base, x: 0, axis: 'horizontal' })).toBe(0);
    expect(drawerOffset({ ...base, open: true, x: 400, axis: 'horizontal' })).toBe(240);
    // 300px of leftward travel from fully open: past closed, so it stops at 0.
    expect(drawerOffset({ ...base, open: true, x: -200, axis: 'horizontal' })).toBe(0);
  });

  it('holds the resting position before the axis commits', () => {
    expect(drawerOffset({ ...base, x: 160, axis: 'undecided' })).toBe(0);
    expect(drawerOffset({ ...base, x: 160, axis: 'vertical' })).toBe(0);
    expect(drawerOffset({ ...base, open: true, x: 40, axis: 'vertical' })).toBe(240);
  });
});

describe('releaseVelocity', () => {
  it('measures the travel inside the flick window', () => {
    // 100px in 50ms = 2 px/ms.
    expect(releaseVelocity([{ x: 0, at: 1000 }, { x: 100, at: 1050 }], 1050)).toBeCloseTo(2);
  });

  it('ignores samples older than the window', () => {
    const samples = [
      { x: 0, at: 1000 },
      { x: 400, at: 1100 },
      { x: 410, at: 1180 },
    ];
    // Only the last two are inside 100ms of 1180: 10px in 80ms.
    expect(releaseVelocity(samples, 1180)).toBeCloseTo(10 / 80);
  });

  it('reads a drag that paused before release as no flick', () => {
    const samples = [
      { x: 0, at: 1000 },
      { x: 200, at: 1100 },
      { x: 205, at: 1195 },
    ];
    expect(releaseVelocity(samples, 1195)).toBeCloseTo(5 / 95);
    expect(Math.abs(releaseVelocity(samples, 1195))).toBeLessThan(FLICK_VELOCITY);
  });

  it('needs two samples in the window', () => {
    expect(releaseVelocity([], 1000)).toBe(0);
    expect(releaseVelocity([{ x: 0, at: 1000 }], 1000)).toBe(0);
    expect(releaseVelocity([{ x: 0, at: 1000 }, { x: 90, at: 1200 }], 1200)).toBe(0);
  });

  it('reports the sign of the travel', () => {
    expect(releaseVelocity([{ x: 100, at: 0 }, { x: 0, at: 50 }], 50)).toBeLessThan(0);
  });

  it('holds the window as a duration, not a sample count', () => {
    const lastAt = 49 * 3;
    const samples = Array.from({ length: 50 }, (_, i) => ({ x: i, at: i * 3 }));
    expect(lastAt).toBeGreaterThan(FLICK_WINDOW_MS);
    // The whole run is inside the window, so the velocity is its average.
    expect(releaseVelocity(samples, lastAt)).toBeCloseTo(49 / 147);
  });
});

describe('settleDrawer', () => {
  it('opens past the halfway point and closes short of it', () => {
    expect(settleDrawer({ offset: 121, velocity: 0, width: 240 })).toBe('open');
    expect(settleDrawer({ offset: 120, velocity: 0, width: 240 })).toBe('open');
    expect(settleDrawer({ offset: 119, velocity: 0, width: 240 })).toBe('closed');
  });

  it('lets a flick decide regardless of position', () => {
    expect(settleDrawer({ offset: 20, velocity: FLICK_VELOCITY, width: 240 })).toBe('open');
    expect(settleDrawer({ offset: 220, velocity: -FLICK_VELOCITY, width: 240 })).toBe('closed');
  });

  it('leaves a slow drag to the halfway rule', () => {
    expect(settleDrawer({ offset: 20, velocity: FLICK_VELOCITY - 0.01, width: 240 })).toBe('closed');
    expect(settleDrawer({ offset: 220, velocity: -(FLICK_VELOCITY - 0.01), width: 240 })).toBe('open');
  });
});

/** A drag that begins at the page's left edge, 300px down. */
const dragFrom = (open: boolean) =>
  beginDrawerDrag({ pointerId: 7, x: 10, y: 300, at: 1000, open, width: 240 });

/** One move that must pan, so the tests can chain drags. */
function pan(drag: DrawerDrag, x: number, y: number, at: number): DrawerDrag {
  const move = drawerDragOnMove(drag, x, y, at);
  if (move.kind !== 'pan') throw new Error(`expected a pan, got ${move.kind}`);
  return move.drag;
}

describe('beginDrawerDrag', () => {
  it('starts a closed drawer at 0 and an open one at its own width', () => {
    expect(dragFrom(false).offset).toBe(0);
    expect(dragFrom(true).offset).toBe(240);
  });

  it('starts undecided, with the first point as its only sample', () => {
    expect(dragFrom(false)).toMatchObject({
      axis: 'undecided',
      open: false,
      width: 240,
      samples: [{ x: 10, at: 1000 }],
    });
  });
});

describe('drawerDragOnMove', () => {
  it('holds still while the travel is under the slop', () => {
    expect(drawerDragOnMove(dragFrom(false), 14, 302, 1010)).toEqual({ kind: 'hold' });
  });

  it('hands a vertical drag to the list underneath', () => {
    expect(drawerDragOnMove(dragFrom(false), 12, 340, 1010)).toEqual({ kind: 'handoff' });
  });

  it('locks the axis on the first horizontal move and pans from the start point', () => {
    const move = drawerDragOnMove(dragFrom(false), 70, 305, 1010);
    expect(move).toMatchObject({ kind: 'pan', axisJustLocked: true });
    if (move.kind !== 'pan') return;
    expect(move.drag).toMatchObject({ axis: 'horizontal', offset: 60 });
  });

  it('keeps panning on later moves without re-locking', () => {
    const moved = pan(dragFrom(false), 70, 305, 1010);
    const move = drawerDragOnMove(moved, 100, 305, 1020);
    expect(move).toMatchObject({ kind: 'pan', axisJustLocked: false });
    if (move.kind !== 'pan') return;
    // The offset follows the finger from the start, not from the last move.
    expect(move.drag.offset).toBe(90);
  });

  it('stays on the horizontal axis after the finger turns vertical', () => {
    const moved = pan(dragFrom(false), 70, 305, 1010);
    const turned = drawerDragOnMove(moved, 80, 400, 1020);
    expect(turned).toMatchObject({ kind: 'pan', axisJustLocked: false });
    if (turned.kind !== 'pan') return;
    expect(turned.drag.axis).toBe('horizontal');
    expect(turned.drag.offset).toBe(70);
  });

  it('samples every panning move, for the release velocity', () => {
    const moved = pan(pan(dragFrom(false), 70, 305, 1010), 100, 305, 1020);
    expect(moved.samples).toEqual([
      { x: 10, at: 1000 },
      { x: 70, at: 1010 },
      { x: 100, at: 1020 },
    ]);
  });

  it('clamps a drag that runs past either end', () => {
    expect(pan(dragFrom(false), 400, 300, 1010).offset).toBe(240);
    expect(pan(dragFrom(true), -400, 300, 1010).offset).toBe(0);
  });
});

describe('drawerDragOnRelease', () => {
  it('holds when the drag never panned', () => {
    expect(drawerDragOnRelease(dragFrom(false), 1010, false)).toEqual({ kind: 'hold' });
    expect(drawerDragOnRelease({ ...dragFrom(false), axis: 'vertical' }, 1010, false)).toEqual({ kind: 'hold' });
  });

  it('settles on the halfway point when the drag was slow', () => {
    // 130px in 400ms is well under the flick velocity, so position decides.
    expect(drawerDragOnRelease(pan(dragFrom(false), 140, 305, 1400), 1400, false)).toEqual({
      kind: 'settle',
      open: true,
    });
    expect(drawerDragOnRelease(pan(dragFrom(false), 100, 305, 1400), 1400, false)).toEqual({
      kind: 'settle',
      open: false,
    });
  });

  it('puts the drawer back when the browser cancels the gesture', () => {
    const closing = pan(dragFrom(true), 100, 305, 1010);
    expect(drawerDragOnRelease(closing, 1010, true)).toEqual({ kind: 'settle', open: true });
    const opening = pan(dragFrom(false), 100, 305, 1010);
    expect(drawerDragOnRelease(opening, 1010, true)).toEqual({ kind: 'settle', open: false });
  });
});
