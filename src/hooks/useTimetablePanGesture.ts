import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-worklets';
import { useSharedValue, withTiming, withDecay, Easing, type SharedValue } from 'react-native-reanimated';

/**
 * Unified two-axis pan gesture for the timetable panel (custom hook so the
 * shared values live inside hook scope — keeps the React-Compiler lint
 * rules happy and the captures fresh).
 *
 * ONE pan drives BOTH axes (direct-manipulation scrolling, calendar feel):
 *
 *   - `translateX`/`translateY` track the finger live; in-bounds drag
 *     scrolls the grid, and diagonal input keeps tracking both axes (no
 *     axis lock after the first threshold) — the actual silkiness.
 *   - Horizontal overscroll past the content edges becomes a week PULL:
 *     the neighbor week's panel rides along; on release it commits when
 *     pull distance or flick velocity clears the thresholds, otherwise
 *     everything springs back (rubber-band on locked edges while dragging).
 *   - Taps survive: below ACTIVATE the pan never activates, so Pressables
 *     keep the touch.
 *
 * Options are captured per render: every option change re-renders the
 * screen, which re-runs this hook and rebuilds the gesture with fresh
 * values (thresholds never go stale). Writes from the screen (settle,
 * programmatic push) go through `settleTo` / the returned shared values.
 */
// Tap-vs-drag: below this displacement (px) the gesture never activates.
const ACTIVATE = 12;
// Overscroll gate: the finger must travel this far BEYOND the content
// boundary before the week pull engages (the neighbor mounts). This is
// what separates "drag back from the right edge to browse" (in-bounds,
// no pull) from "deliberately pull the next/prev week in": a small
// rightward drag at the right edge just scrolls the columns back.
const PULL_GATE = 30;
// Week pull commit: pull past this fraction of the panel travel, or a
// flick above VELOCITY px/s in the pulled direction at release.
const COMMIT_FRACTION = 0.3;
const VELOCITY = 550;
// Rubber-band resistance while over-pulling a LOCKED edge (week 1 / last):
// each finger px moves the strip by this factor.
const RESIST = 0.35;
// Spring-back duration for non-commit releases.
const SETTLE_MS = 200;

interface TimetablePanOptions {
  /** Content scroll bounds (≥ 0): content size − viewport. */
  maxX: number;
  maxY: number;
  /** Strip travel per week push = viewport width (from onLayout). */
  panelWidth: number;
  /** True when the current week is week 1 (no prev panel exists). */
  atFirstWeek: boolean;
  /** True when the current week is the last week (no next panel exists). */
  atLastWeek: boolean;
  /** Mount the neighbor panel for a pull in the given direction. */
  onPullStart: (dirNext: boolean) => void;
  /** Commit the pulled week (true = next). The screen animates the settle. */
  onCommit: (dirNext: boolean) => void;
}

interface TimetablePan {
  /** The gesture — feed to <GestureDetector gesture={...}>. */
  gesture: PanGesture;
  /** Animated offsets; map into the strip's transform style. */
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  /** Animate the strip to a rest/push offset (JS-thread helper). */
  settleTo: (x: number, y: number, durationMs?: number) => void;
}

export function useTimetablePan({
  maxX,
  maxY,
  panelWidth,
  atFirstWeek,
  atLastWeek,
  onPullStart,
  onCommit,
}: TimetablePanOptions): TimetablePan {
  // Live offsets: negative = scrolled right/down. Rest range is
  // [−max..0]; beyond that is week-pull (x only).
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Per-gesture state (shared values — worklets read them live).
  const origin = useSharedValue<{ x: number; y: number } | null>(null);
  const active = useSharedValue(false);
  const axis = useSharedValue<'none' | 'x' | 'y'>('none');
  const neighbor = useSharedValue(0); // -1 prev, 0 none, 1 next
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);

  const settleTo = (x: number, y: number, durationMs = 220) => {
    translateX.value = withTiming(x, { duration: durationMs, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(y, { duration: durationMs, easing: Easing.out(Easing.cubic) });
  };

  const gesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event, stateManager) => {
      'worklet';
      if (event.allTouches.length !== 1) {
        origin.value = null;
        stateManager.fail();
        return;
      }
      const touch = event.allTouches[0];
      origin.value = touch ? { x: touch.absoluteX, y: touch.absoluteY } : null;
      active.value = false;
      axis.value = 'none';
      neighbor.value = 0;
      baseX.value = translateX.value;
      baseY.value = translateY.value;
      stateManager.begin();
    })
    .onTouchesMove((event, stateManager) => {
      'worklet';
      if (event.allTouches.length !== 1) return;
      const touch = event.allTouches[0];
      const start = origin.value;
      if (!touch || !start) return;
      const dx = touch.absoluteX - start.x;
      const dy = touch.absoluteY - start.y;

      if (!active.value) {
        // First axis to clear the threshold wins; after activation BOTH
        // axes track (direct manipulation — the actual silkiness).
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (ax < ACTIVATE && ay < ACTIVATE) return;
        active.value = true;
        axis.value = ax >= ay ? 'x' : 'y';
        stateManager.activate();
        return;
      }

      if (axis.value === 'x') {
        // Direct manipulation: the content follows the finger. Rest range
        // is [-maxX..0] (0 = left edge), so a right finger move increases
        // translateX toward/past 0 (prev-week pull); a left move decreases
        // it (column scroll, then next-week pull).
        const raw = baseX.value + dx;
        // Week pull: only when the finger has traveled PULL_GATE beyond
        // the content boundary (raw > PULL_GATE at the left end, raw <
        // -maxX - PULL_GATE at the right end). Below the gate: plain
        // in-bounds behavior (rubber-band at locked edges), so browsing
        // back from an edge never grabs the neighbor panel.
        if (raw > PULL_GATE && !atFirstWeek) {
          if (neighbor.value !== -1) {
            neighbor.value = -1;
            runOnJS(onPullStart)(false);
          }
          translateX.value = raw;
          return;
        }
        if (raw < -maxX - PULL_GATE && !atLastWeek) {
          if (neighbor.value !== 1) {
            neighbor.value = 1;
            runOnJS(onPullStart)(true);
          }
          translateX.value = raw;
          return;
        }
        // In-bounds / under-gate content scroll; rubber-band at edges.
        const clamped = Math.min(Math.max(raw, -maxX), 0);
        translateX.value = raw !== clamped ? clamped + (raw - clamped) * RESIST : raw;
        return;
      }

      // Vertical: same follow-the-finger sign as X (rest range [-maxY..0]).
      const rawY = baseY.value + dy;
      translateY.value = Math.min(Math.max(rawY, -maxY), 0);
    })
    .onEnd((event) => {
      'worklet';
      if (!active.value) return;
      active.value = false;
      const vx = event.velocityX;

      if (axis.value === 'x') {
        // "Pulled" = the strip sits beyond its bounds with a mounted
        // neighbor (past PULL_GATE). Rubber-band drags that stayed under
        // the gate skip commit evaluation entirely.
        const pulled = translateX.value > 0 || translateX.value < -maxX;
        if (pulled && neighbor.value !== 0) {
          const dirNext = neighbor.value === 1;
          // Drag distance measured BEYOND the content bounds.
          const dragged = dirNext
            ? Math.abs(translateX.value + maxX)
            : Math.abs(translateX.value);
          const far = dragged > panelWidth * COMMIT_FRACTION;
          const flick = dirNext ? vx < -VELOCITY : vx > VELOCITY;
          if (far || flick) {
            runOnJS(onCommit)(dirNext);
            return; // the screen animates the settle + swap
          }
        }
        // Free browsing: an in-bounds release STOPS where the finger left
        // it (no snapping) — the user decides what part of the week to
        // look at, including parking mid-grid on a day column. Snapping
        // to an edge on every release fought that: a left-swipe from the
        // right edge (viewing Sunday) bounced back to Sunday instead of
        // staying where the user dragged to, so the middle of the week
        // could only be viewed while holding the finger down.
        // Only out-of-bounds positions (aborted week pull) spring back to
        // the nearest content edge — the pull boundary they came from.
        // Also resets the neighbor flag; the panels stay mounted (idle
        // pre-mount), only this gesture's state clears.
        neighbor.value = 0;
        const inBounds = translateX.value <= 0 && translateX.value >= -maxX;
        const restX = inBounds ? translateX.value : Math.min(Math.max(translateX.value, -maxX), 0);
        translateX.value = withTiming(restX, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) });
        translateY.value = withTiming(translateY.value, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) });
        return;
      }

      // Vertical release: momentum glide with the finger's velocity,
      // clamped to the content bounds (deceleration like a native
      // ScrollView; no dead stop at the current position).
      translateX.value = withTiming(translateX.value, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) });
      translateY.value = withDecay({ velocity: event.velocityY, clamp: [-maxY, 0], deceleration: 0.997 });
    });

  return { gesture, translateX, translateY, settleTo };
}
