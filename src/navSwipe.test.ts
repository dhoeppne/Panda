import { describe, expect, it } from 'vitest';
import {
  beginsDrawerSwipe,
  DIRECTION_RATIO,
  drawerOffset,
  FLICK_VELOCITY,
  FLICK_WINDOW_MS,
  releaseVelocity,
  settleDrawer,
  SWIPE_SLOP_PX,
  swipeAxis,
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
