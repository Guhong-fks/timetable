import { startTransition, useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import Animated, { useAnimatedStyle, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import { AppState, Modal, ScrollView, StyleSheet, View, Pressable, TextInput } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useTimetablePan } from '@/hooks/useTimetablePanGesture';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, GridLineAlpha } from '@/constants/theme';
import { useTimetable } from '@/state/timetable';
import { CourseEditModal } from '@/components/CourseEditModal';
import { useTheme } from '@/hooks/use-theme';
import { getStoredValue, setStoredValue } from '@/lib/storage';
import { coursesForWeek, coursesToTimetable, periodsArray, DEFAULT_MAX_PERIODS, getTimeSlotMeta, WEEK_DAYS, WEEK_DAY_LABELS, type ScheduledCourse, type TimetableData, type WeekDay, TimeSlot } from '@/types/timetable';
import type { ReportWarning } from '@/lib/reporting/types';
import type { ImportReport } from '@/state/timetable';

// Compact layout constants for mobile timetable
// Day-column width: wide screens (≥ ~392dp) keep full 52px columns (fits
// 大学英语 on one line); narrow screens compress the columns so the whole
// week — time column + Mon..Sun — always fits the viewport. gridW
// (TIME_COL_WIDTH + dayWidth*7) never exceeds the screen width, so there is
// NO horizontal scroll and the pan gesture is purely for week switching.
const DAY_WIDTH_MAX = 52;
const DAY_WIDTH_MIN = 40;
const TIME_COL_WIDTH = 28;
const SLOT_BASE_HEIGHT = 72;
const GAP = 2;
/** Push-transition duration in ms (grid slides out, next week in). */
const WEEK_TRANSITION_MS = 250;
const PERIOD_TIMES_KEY = 'course-table-app.period-times.v2';
const PERIOD_DURATIONS_KEY = 'course-table-app.period-durations.v1';

// Short day labels: 一、二、三、四、五、六、日
const SHORT_DAY_LABELS: Record<typeof WEEK_DAYS[number], string> = {
  Monday: '一', Tuesday: '二', Wednesday: '三',
  Thursday: '四', Friday: '五', Saturday: '六', Sunday: '日'
};

/** Empty-slot taps are disabled on neighbor (transition) panels. */
const NOOP_EMPTY_SLOT = () => {};
// Pastel hue palette for course cards. Hashed from the course name so each
// course keeps one stable color across renders/restarts, and the same
// course on different days shares its hue. 8 hues keep same-day collisions
// rare and stay readable over both light and dark backgrounds.
const COURSE_PALETTE = [
  '#4A90D9', // blue
  '#5BAE6E', // green
  '#E0913C', // orange
  '#9B6FD4', // purple
  '#D96A9C', // pink
  '#42AFA5', // teal
  '#C9A227', // gold
  '#6C7BD9', // indigo
];

function courseHue(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COURSE_PALETTE[hash % COURSE_PALETTE.length];
}

/** '#RRGGBB' + alpha -> 'rgba(...)' — works on every RN version. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Dark-mode unified card: ONE solid gray-blue surface (#2E3E4E) —
 * same hue family as the dark elevation ladder, a full step above
 * backgroundElement (#1D252E) so cards read as raised layers, dark
 * enough for the light card text to hit 4.5:1+, and uniform: no
 * translucent wash, no per-course tint. The top bar takes a lighter
 * step (#4A5F75) of the same hue for a subtle rim without a second
 * color. All cards share it in dark mode. */
const DARK_CARD_BODY = '#2E3E4E';
const DARK_CARD_RIM = '#4A5F75';

/**
 * Static course-card renderer (module level): usable from both the
 * current and the neighbor panel without prop-drilling closures.
 */
function renderCourseCardStatic(
  course: ScheduledCourse,
  duration: number,
  onCoursePress: (course: ScheduledCourse) => void,
  theme: ReturnType<typeof useTheme>,
) {
  const isDark = theme.background === '#10151B';
  // Dark mode: every card is the same SOLID gray-blue — no alpha wash,
  // no per-course tint (user colorOverride is ignored there; the stored
  // override survives and applies again in light mode).
  const cardHeight = Math.max(duration * SLOT_BASE_HEIGHT - GAP * 2, 58);
  // Light-mode tint: user override wins, else the name-hash hue. (Dark
  // mode ignores this entirely — see the solid constants above.)
  const hue = isDark ? null : (course.colorOverride ?? courseHue(course.name));
  return (
    <Pressable
      onPress={() => onCoursePress(course)}
      // No android_ripple: each ripple keeps the card's press layer alive
      // during pans and forces per-frame style re-evaluation on a big grid
      // (visible stutter). Press feedback comes from the opacity below.
      style={({ pressed }) => [
        styles.card,
        isDark || hue === null
          ? {
              height: cardHeight,
              backgroundColor: DARK_CARD_BODY,
              borderColor: DARK_CARD_RIM,
              borderTopColor: DARK_CARD_RIM,
              opacity: pressed ? 0.88 : 1,
            }
          : {
              height: cardHeight,
              backgroundColor: withAlpha(hue, 0.14),
              borderColor: withAlpha(hue, 0.4),
              borderTopColor: hue,
              opacity: pressed ? 0.82 : 1,
            },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${course.name}，${course.location.address}`}
    >
      {/* Location is the priority field: bottom-anchored, unlimited
          lines, rendered AFTER the name so it paints on top of it when
          they overlap. maxHeight reserves the top two name lines so the
          name never disappears entirely; overflow (pathological 1-period
          cards with a long address) clips cleanly instead of
          ellipsizing. */}
      <ThemedText
        type="smallBold"
        maxFontSizeMultiplier={1}
        style={styles.courseName}
      >
        {course.name}
      </ThemedText>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        maxFontSizeMultiplier={1}
        style={[styles.courseLocation, { maxHeight: cardHeight - 6 - 26 - 5 }]}
      >
        {course.location.address || '未填写'}
      </ThemedText>
    </Pressable>
  );
}

/** Props for the grid body extracted below — pure rendering, no week
 * transition logic; both the current and the neighbor panel render it. */
interface WeekGridBodyProps {
  /** Pre-bucketed, positioned courses for THIS panel's week. */
  positioned: Record<string, { top: number; height: number; course: ScheduledCourse }[]>;
  theme: ReturnType<typeof useTheme>;
  /** Week number for the day-header dates, and whether that week
   * contains today (drives the today highlight inside the panel). */
  week: number;
  weekIsCurrent: boolean;
  /** Today's weekday + M/D label, computed ONCE on the screen (memoized on
   * the calendar day) instead of `new Date()` inside every panel render —
   * inside, it would defeat React.memo and drift between sibling panels
   * mid-render. */
  todayDay: WeekDay;
  todayDateLabel: string;
  monthLabel: string;
  semesterStartDate?: string;
  maxPeriods: number;
  periodTimes: Record<number, string>;
  periodDurations: Record<number, number>;
  /** Compressed day-column width so the whole week fits the viewport. */
  dayWidth: number;
  onCoursePress: (course: ScheduledCourse) => void;
  onPeriodPress: (period: number) => void;
  /** Tap on an empty grid slot: (day, period). Opens the add-course modal
   * on the current panel; the neighbor panel passes a no-op. */
  onEmptySlotPress: (day: WeekDay, period: number) => void;
}

/** Memo boundary: the T3 re-derive frame (neighbor re-mounts + today's
 * highlight recompute) must not re-render UNCHANGED panels. Every prop is
 * referentially stable across such frames: theme = module const,
 * positioned/monthLabel = useMemo, handlers = useCallback/hoisted consts. */
const WeekGridBody = memo(function WeekGridBody({
  positioned,
  theme,
  week,
  weekIsCurrent,
  todayDay,
  todayDateLabel,
  monthLabel,
  semesterStartDate,
  maxPeriods,
  periodTimes,
  periodDurations,
  dayWidth,
  onCoursePress,
  onPeriodPress,
  onEmptySlotPress,
}: WeekGridBodyProps) {
  // Per-scheme hairline alphas (dark mode needs stronger grid lines).
  const alpha = theme.background === '#10151B' ? GridLineAlpha.dark : GridLineAlpha.light;
  // Full week width = time column + 7 compressed day columns (fits viewport).
  const gridW = TIME_COL_WIDTH + dayWidth * 7;
  return (
    <View style={[styles.grid, { width: gridW }]}>
      {/* Time column header with month at top-left */}
      <View style={styles.timeHeader}>
        <View style={[styles.timeHead, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.textSecondary + alpha.border }]}>
          {monthLabel && <ThemedText type="small" style={styles.monthLabel}>{monthLabel}</ThemedText>}
        </View>
        {WEEK_DAYS.map(day => {
          const isToday = day === todayDay && weekIsCurrent;
          const dateText = semesterStartDate ? formatDayDate(semesterStartDate, week, day) : '';
          const showToday = isToday && dateText === todayDateLabel;
          return (
            <View
              key={day}
              style={[
                styles.dayHead,
                { width: dayWidth },
                {
                  backgroundColor: isToday ? theme.backgroundSelected : theme.backgroundElement,
                  borderBottomColor: theme.textSecondary + alpha.border,
                },
              ]}
            >
              <ThemedText type="smallBold" style={styles.dayLabel}>{SHORT_DAY_LABELS[day]}</ThemedText>
              {semesterStartDate && (
                <ThemedText
                  type="small"
                  themeColor={showToday ? undefined : 'textSecondary'}
                  style={[styles.dateLabel, showToday && styles.dateLabelToday]}
                >
                  {showToday ? '今天' : dateText}
                </ThemedText>
              )}
            </View>
          );
        })}
      </View>

      <View style={styles.gridBody}>
        {/* Time slots column - compact period numbers with times */}
        <View style={[styles.timeColumn, { borderRightColor: theme.textSecondary + alpha.border, backgroundColor: theme.backgroundElement }]}>
          {periodsArray(maxPeriods).map(period => (
            <View key={period} style={[styles.periodRow, { height: SLOT_BASE_HEIGHT, borderBottomColor: theme.textSecondary + alpha.line }]}>
              <Pressable style={styles.timeCell} onPress={() => onPeriodPress(period)} accessibilityRole="button" accessibilityLabel={`修改第${period}节上课时间`}>
                <ThemedText type="smallBold" style={styles.periodNumber}>{period}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.periodTime}>{formatPeriodRange(periodTimes[period], periodDurations[period])}</ThemedText>
              </Pressable>
            </View>
          ))}
        </View>

        {/* Day columns with absolutely positioned course cards */}
        {WEEK_DAYS.map(day => (
          <View key={day} style={[styles.dayColumn, { width: dayWidth, borderRightColor: theme.textSecondary + alpha.line }]}>
            {/* Grid lines double as add-course tap targets on EMPTY slots:
                course cards render AFTER this stack with zIndex:5, so a
                covered slot's touch lands on the card, not here. */}
            {periodsArray(maxPeriods).map(period => (
              <Pressable
                key={period}
                onPress={() => onEmptySlotPress(day, period)}
                style={[
                  styles.gridLine,
                  { height: SLOT_BASE_HEIGHT, borderBottomColor: theme.textSecondary + alpha.lineSoft },
                  { backgroundColor: (day === todayDay && weekIsCurrent) ? theme.backgroundSelected + '44' : theme.background },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`在${SHORT_DAY_LABELS[day]}第${period}节添加课程`}
              />
            ))}
            {/* Courses */}
            {positioned[day].map(({ top, height, course }) => (
              <View
                key={course.id}
                style={[
                  styles.positionedCard,
                  { top, height },
                ]}
              >
                {renderCourseCardStatic(course, (course.duration ?? (getTimeSlotMeta(course.timeSlot)?.duration ?? 1)), onCoursePress, theme)}
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
});

export default function TimetableScreen() {
  const theme = useTheme();
  const { courses, isHydrated, semesterStartDate, semesterWeeks, maxPeriods, lastReport, dismissReport, updateCourse, addCourse, deleteCourses } = useTimetable();
    const [selectedWeek, setSelectedWeek] = useState(1);
    const [weekInput, setWeekInput] = useState('1');

  // --- Unified two-axis pan (direct-manipulation scrolling + week pull) ---
  // One pan gesture owns BOTH axes: in-bounds drag scrolls the grid
  // (diagonal input tracks both axes at once — no axis lock after the
  // first threshold), overscroll past the content edges pulls the
  // neighbor week's panel finger-tracked, and release commits on
  // distance or flick velocity. No nested ScrollViews, so nothing
  // competes for the touch — that was the source of the old stiffness.
  // Measured bounds (onLayout): content scroll range + strip travel.
  // surfaceWidthRef = the pan surface's real width; day columns compress so
  // the full week fits it (gridW ≤ surface), so maxX stays 0 (no horizontal
  // scroll) and the pan is purely a week-switch gesture.
  const surfaceWidthRef = useRef(0);
  const gridHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  const [scrollBounds, setScrollBounds] = useState({ maxX: 0, maxY: 0, panelWidth: 1, dayW: DAY_WIDTH_MAX });
  const recomputeBounds = useCallback(() => {
    const W = surfaceWidthRef.current;
    // Compress day columns so the full week (time col + Mon..Sun) fits the
    // viewport: dayW ≤ (W − TIME)/7 ⇒ gridW ≤ W. Wide screens cap at 52px.
    const dayW = W > 0
      ? Math.min(Math.max(Math.floor((W - TIME_COL_WIDTH) / 7), DAY_WIDTH_MIN), DAY_WIDTH_MAX)
      : DAY_WIDTH_MAX;
    const gridW = TIME_COL_WIDTH + dayW * 7;
    const maxX = W > 0 ? Math.max(gridW - W, 0) : 0;
    const maxY = Math.max(gridHeightRef.current - containerHeightRef.current, 0);
    setScrollBounds(prev =>
      prev.maxX === maxX && prev.maxY === maxY && prev.panelWidth === gridW && prev.dayW === dayW
        ? prev
        : { maxX, maxY, panelWidth: Math.max(gridW, 1), dayW },
    );
  }, []);
  const onGridBodyMeasured = useCallback((e: LayoutChangeEvent) => {
    gridHeightRef.current = e.nativeEvent.layout.height;
    recomputeBounds();
  }, [recomputeBounds]);
  const onContainerMeasured = useCallback((e: LayoutChangeEvent) => {
    containerHeightRef.current = e.nativeEvent.layout.height;
    surfaceWidthRef.current = e.nativeEvent.layout.width;
    recomputeBounds();
  }, [recomputeBounds]);

    const [selectedCourse, setSelectedCourse] = useState<ScheduledCourse | null>(null);
    /** Course being edited (edit modal). Opening it closes the detail
     * modal; saving/updating replaces the course via updateCourse. */
    const [editingCourse, setEditingCourse] = useState<ScheduledCourse | null>(null);
    /** Add-from-empty-slot draft: fixed day/span + the week the user is
     * viewing (becomes the default weekList). Non-null renders
     * CourseEditModal in create mode; saving appends via addCourse. */
    const [creatingDraft, setCreatingDraft] = useState<{ day: WeekDay; startPeriod: number; endPeriod: number; week: number } | null>(null);
    const [periodTimes, setPeriodTimes] = useState<Record<number, string>>(() => createDefaultPeriodTimes());
    const [periodDurations, setPeriodDurations] = useState<Record<number, number>>(() => createDefaultPeriodDurations());
    const [periodStorageLoaded, setPeriodStorageLoaded] = useState(false);
    const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
    const [periodTimeInput, setPeriodTimeInput] = useState('');
    const [periodDurationInput, setPeriodDurationInput] = useState('45');
    /** Controls the "解析详情" modal. */
    const [reportDetailOpen, setReportDetailOpen] = useState(false);

  // Auto-jump to current week based on today's date
  const jumpToCurrentWeek = useCallback(() => {
    if (!semesterStartDate) return;
    const start = parseLocalDate(semesterStartDate);
    if (!start) return;
    const today = startOfLocalDay(new Date());
    const elapsedDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
    // Before semester starts -> week 1; after semester ends -> last week
    const currentWeek = Math.min(Math.max(Math.floor(elapsedDays / 7) + 1, 1), semesterWeeks);
    startTransition(() => {
      setSelectedWeek(currentWeek);
      setWeekInput(String(currentWeek));
    });
  }, [semesterStartDate, semesterWeeks]);

  // Jump on mount, when the semester start date changes (including async
  // hydration — the mount-time run sees `undefined` and returns early), and
  // after each import replaces the course list (a fresh import usually
  // resets the term, so re-derive the current week immediately). Deps are
  // the course-array *identity* and the hydration flag: both change exactly
  // on hydrate / import / clear, and never on week navigation or theme
  // switches, so the jump cannot yank the user around while browsing.
  useEffect(() => { jumpToCurrentWeek(); }, [jumpToCurrentWeek, isHydrated, courses]);

  // Jump when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') jumpToCurrentWeek();
    });
    return () => subscription.remove();
  }, [jumpToCurrentWeek]);

  // Load persisted period times and durations
  useEffect(() => {
    void (async () => {
      try {
        const saved = await getStoredValue(PERIOD_TIMES_KEY);
        if (saved) setPeriodTimes({ ...createDefaultPeriodTimes(), ...JSON.parse(saved) });
        const savedDurations = await getStoredValue(PERIOD_DURATIONS_KEY);
        if (savedDurations) setPeriodDurations({ ...createDefaultPeriodDurations(), ...JSON.parse(savedDurations) });
      } catch {
        // Keep calculated defaults on parse failure
      } finally {
        setPeriodStorageLoaded(true);
      }
    })();
  }, []);

  // Persist period times
  useEffect(() => {
    if (periodStorageLoaded) void setStoredValue(PERIOD_TIMES_KEY, JSON.stringify(periodTimes));
  }, [periodTimes, periodStorageLoaded]);

  // Persist period durations
  useEffect(() => {
    if (periodStorageLoaded) void setStoredValue(PERIOD_DURATIONS_KEY, JSON.stringify(periodDurations));
  }, [periodDurations, periodStorageLoaded]);

  const selectedCourses = useMemo(() => coursesForWeek(courses, selectedWeek), [courses, selectedWeek]);
  const timetable = useMemo(() => coursesToTimetable(selectedCourses), [selectedCourses]);

  // Today's weekday: Date.getDay() is 0=Sunday..6=Saturday while WEEK_DAYS
  // is Monday-first. Recomputed every render (cheap); the AppState
  // foreground listener re-renders on resume, so the highlight follows day
  // changes when the app comes back overnight.
  const now = new Date();
  const todayDay = WEEK_DAYS[(now.getDay() + 6) % 7];
  const todayDateLabel = `${now.getMonth() + 1}/${now.getDate()}`;
  // "Today" styling must also require that the selected week actually
  // contains today's date — otherwise the same weekday would stay
  // highlighted in every week the user navigates to.
  const selectedWeekIsCurrent = semesterStartDate
    ? formatDayDate(semesterStartDate, selectedWeek, todayDay) === todayDateLabel
    : false;

  // Memoized handlers: React.memo on WeekGridBody compares props by
  // reference — recreated-per-render closures would defeat it on every
  // screen render.
  const handleCoursePress = useCallback((course: ScheduledCourse) => {
    setSelectedCourse(course);
  }, []);

  const handleEmptySlotPress = useCallback((day: WeekDay, period: number) => {
    setCreatingDraft({ day, startPeriod: period, endPeriod: period, week: selectedWeek });
  }, [selectedWeek]);

  const pendingWeekRef = useRef<number | null>(null);
  // Strip phase machine:
  //   idle          — strip at 0; BOTH neighbor weeks pre-mounted (prev
  //                   on the left, next on the right), so a pull never
  //                   triggers a mid-drag render (the old onPullStart
  //                   mount visibly stuttered).
  //   pending-snap  — the push animation landed at ±panelWidth showing
  //                   the target panel; the week swap committed with ONLY
  //                   the visible side duplicated (snapDir picks which) —
  //                   pixel-identical to what the strip arrived showing.
  //                   The snap back to 0 is deferred to rAF, AFTER this
  //                   render commits — snapping earlier (while React's
  //                   swap was still pending) flashed the OLD week's dates
  //                   for a frame (the "dates jump" bug).
  const [snapPhase, setSnapPhase] = useState<'idle' | 'pending-snap'>('idle');
  /** Commit direction, set at commit time and held through pending-snap:
   * only the panel the strip moved TOWARD is visible at the ±panelWidth
   * rest position, so ONLY that side duplicates the target week; the
   * opposite side freezes at its pre-switch content (React.memo skips it),
   * then re-derives to the standard pre-mount at idle. Halves the neighbor
   * renders per commit. */
  const [snapDir, setSnapDir] = useState<'next' | 'prev' | null>(null);
  // Neighbor slots during pending-snap: visible side = target (must be
  // pixel-identical to the main panel when the strip snaps to 0 — the
  // anti-flash snapshot), frozen side = its pre-switch idle value expressed
  // against the NEW selectedWeek (target∓2; null at the grid boundary).
  // At idle both sides re-derive to the standard pre-mounts.
  const neighborLeft: number | null = snapPhase === 'pending-snap'
    ? (snapDir === 'prev' ? selectedWeek : (selectedWeek - 2 >= 1 ? selectedWeek - 2 : null))
    : (selectedWeek > 1 ? selectedWeek - 1 : null);
  const neighborRight: number | null = snapPhase === 'pending-snap'
    ? (snapDir === 'next' ? selectedWeek : (selectedWeek + 2 <= semesterWeeks ? selectedWeek + 2 : null))
    : (selectedWeek < semesterWeeks ? selectedWeek + 1 : null);
  // Pre-mounted neighbor panels: courses + positioned layout, same shape
  // as the current week's so the panel renderer is shared.
  const leftCourses = useMemo(
    () => (neighborLeft === null ? [] : coursesForWeek(courses, neighborLeft)),
    [courses, neighborLeft],
  );
  const rightCourses = useMemo(
    () => (neighborRight === null ? [] : coursesForWeek(courses, neighborRight)),
    [courses, neighborRight],
  );
  const leftTimetable = useMemo(() => coursesToTimetable(leftCourses), [leftCourses]);
  const rightTimetable = useMemo(() => coursesToTimetable(rightCourses), [rightCourses]);

    // The unified pan: shared values + gesture live inside the hook (hook
  // scope keeps the React-Compiler rules happy; options re-run the hook
  // per render, rebuilding the gesture with fresh thresholds).
  const timetablePan = useTimetablePan({
    maxX: scrollBounds.maxX,
    maxY: scrollBounds.maxY,
    panelWidth: scrollBounds.panelWidth,
    atFirstWeek: selectedWeek === 1,
    atLastWeek: selectedWeek === semesterWeeks,
    onPullStart: () => {},
    onCommit: commitFromPull,
  });
  // Destructure the WORKLET-SAFE pieces. The worklet closures below
  // (animated style + timing callbacks) must capture only shared
  // values — capturing the whole `timetablePan` object would make the
  // worklet serializer try to copy `gesture: PanGesture`, which is
  // not serializable ("Cannot copy value of type `PanGesture`").

  const { translateX: stripX, translateY: stripY } = timetablePan;
  const stripAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: stripX.value },
      { translateY: stripY.value },
    ],
  }));

  /** Header display week: flips at COMMIT TIME (when the visible neighbor —
   * already showing the target week — starts riding the strip), not when
   * the settle animation finishes. selectedWeek keeps flipping in
   * finishTransition (the snapshot-anti-flash sequencing depends on it),
   * but the header must not lag the grid by the full settle duration.
   * State, not a ref: the header re-render IS the point. Declared BEFORE
   * finishTransition/commitWeek, which set it (React hooks rule: a setter
   * must be lexically declared before use). */
  const [pendingDisplayWeek, setPendingDisplayWeek] = useState<number | null>(null);
  const displayWeek = pendingDisplayWeek ?? selectedWeek;
  const displayCourses = useMemo(
    () => coursesForWeek(courses, displayWeek),
    [courses, displayWeek],
  );
  const displayCount = displayCourses.length;

  /** Transition end (JS). Swap sequencing (the "dates jump" fix):
   *  1. Commit the target week SYNCHRONOUSLY with the visible neighbor
   *     DUPLICATED (both panels = target) — pixel-identical to what the
   *     strip arrived showing, so the commit render changes nothing
   *     visually.
   *  2. Defer the strip snap to the NEXT frame (rAF): by then React has
   *     painted the swapped panels, so translate 0 shows the new week —
   *     never the old one. Snapping in the same tick as the swap (shared
   *     values apply on the UI thread instantly, React commits later)
   *     flashed the old week's dates for a frame.
   *  3. One frame after that: back to idle (panels re-derive to the
   *     standard prev/next pre-mounts). */
  const finishTransition = useCallback(() => {
    const target = pendingWeekRef.current;
    if (target === null) return;
    pendingWeekRef.current = null;
    setSelectedWeek(target);
    setWeekInput(String(target));
    setPendingDisplayWeek(null);
    setSnapPhase('pending-snap');
    requestAnimationFrame(() => {
      stripX.value = 0;
      stripY.value = 0;
      requestAnimationFrame(() => {
        setSnapPhase('idle');
        setSnapDir(null);
      });
    });
  }, [stripX, stripY]);

  /** Arrow / input-box week commit: mount the neighbor, push one full
   * panel. Reuses the same swap+snap finish as finger commits. */
  const commitWeek = useCallback((week: number) => {
    const nextWeek = Math.min(Math.max(week, 1), semesterWeeks);
    if (nextWeek === selectedWeek || pendingWeekRef.current !== null) return;
    // Reject while a transition is settling (strip displaced): an in-place
    // swap here would change the main panel while the strip is parked at
    // ±panelWidth.
    if (snapPhase !== 'idle') return;
    if (Math.abs(nextWeek - selectedWeek) > 1) {
      // Multi-week input jump: the slide animates exactly ONE panel width,
      // which would carry the ±1 pre-mounted neighbor (the WRONG week) into
      // view. Swap in place at rest instead — one render, header + main +
      // neighbors all consistent, no snapshot dance needed.
      setSelectedWeek(nextWeek);
      setWeekInput(String(nextWeek));
      return;
    }
    const dirNext = nextWeek > selectedWeek;
    pendingWeekRef.current = nextWeek;
    setPendingDisplayWeek(nextWeek); // header flips now, with the grid
    setSnapDir(dirNext ? 'next' : 'prev');
    requestAnimationFrame(() => {
      stripX.value = withTiming(dirNext ? -scrollBounds.panelWidth : scrollBounds.panelWidth, {
        duration: WEEK_TRANSITION_MS,
        easing: Easing.inOut(Easing.cubic),
      }, (finished) => {
        'worklet';
        if (finished) runOnJS(finishTransition)();
      });
    });
  }, [selectedWeek, semesterWeeks, snapPhase, stripX, scrollBounds.panelWidth, finishTransition]);

  /** Called when the gesture's worklet decides a pull should commit:
   * set the pending target from the LIVE week, then finish the push
   * from where the finger left it. Hoisted function declaration so the
   * hook above can reference it before this line. */
  function commitFromPull(dirNext: boolean) {
    const target = dirNext
      ? Math.min(selectedWeek + 1, semesterWeeks)
      : Math.max(selectedWeek - 1, 1);
    pendingWeekRef.current = target;
    setPendingDisplayWeek(target); // header flips now, with the grid
    setSnapDir(dirNext ? 'next' : 'prev');
    const rest = dirNext ? -scrollBounds.panelWidth : scrollBounds.panelWidth;
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value
    stripX.value = withTiming(rest, {
      duration: WEEK_TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      'worklet';
      if (finished) runOnJS(finishTransition)();
    });
  }

  /** Resolve a delete scope (edit modal → confirm sheet) into concrete
   * store operations.
   *   'this'     — drop the currently-viewed week from the course's
   *                weekList (updateCourse patch). If only that week
   *                remains, fall through to removing the single id.
   *   'weekly'   — delete every same-name course whose day+startPeriod+
   *                endPeriod match this one (the weekly slot).
   *   'semester' — delete every same-name course (whole semester). */
  const resolveDelete = useCallback((course: ScheduledCourse, scope: 'this' | 'weekly' | 'semester') => {
    if (scope === 'this') {
      const remaining = course.weekList.filter(w => w !== selectedWeek);
      if (remaining.length === 0) {
        // Only the viewed week existed — remove the course entirely.
        deleteCourses([course.id]);
      } else {
        updateCourse(course.id, { weekList: remaining, isOddEven: null });
      }
      return;
    }
    const sameName = courses.filter(c => c.name === course.name);
    if (scope === 'weekly') {
      const slotIds = sameName
        .filter(c => c.day === course.day && c.startPeriod === course.startPeriod && c.endPeriod === course.endPeriod)
        .map(c => c.id);
      deleteCourses(slotIds);
      return;
    }
    // 'semester': every same-name course.
    deleteCourses(sameName.map(c => c.id));
  }, [courses, selectedWeek, updateCourse, deleteCourses]);

  /** How many same-name sessions exist — for the confirm copy. */
  const sameNameCount = editingCourse
    ? courses.filter(c => c.name === editingCourse.name).length
    : 1;

  const commitWeekInput = () => {
    const parsedWeek = Number.parseInt(weekInput, 10);
    if (!Number.isNaN(parsedWeek)) commitWeek(parsedWeek);
    else setWeekInput(String(selectedWeek));
  };

  // Memoized: WeekGridBody is a React.memo boundary — a per-render closure
  // would re-render every panel on every screen render.
  const openPeriodEditor = useCallback((period: number) => {
    setSelectedPeriod(period);
    setPeriodTimeInput(periodTimes[period]);
    setPeriodDurationInput(String(periodDurations[period]));
  }, [periodTimes, periodDurations]);

  const savePeriodTime = () => {
    const duration = Number.parseInt(periodDurationInput, 10);
    if (selectedPeriod === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(periodTimeInput) || !Number.isInteger(duration) || duration < 1 || duration > 240) return;
    setPeriodTimes(current => ({ ...current, [selectedPeriod]: periodTimeInput }));
    setPeriodDurations(current => ({ ...current, [selectedPeriod]: duration }));
    setSelectedPeriod(null);
  };

  // Build positioned courses per day for absolute layout (pure helper so
  // both the current and neighbor panels share it).
  const buildPositioned = useCallback((dayMap: TimetableData) => {
    const result: Record<string, { top: number; height: number; course: ScheduledCourse }[]> = {};
    WEEK_DAYS.forEach(day => {
      const dayCourses = dayMap[day];
      const positioned = dayCourses
              .map(course => {
                const meta = getTimeSlotMeta(course.timeSlot);
                if (!meta) return null;
                // Use the authoritative startPeriod / duration written by
                // the importer so non-standard spans (e.g. `5-7节`) render at
                // the right row and don't overlap adjacent courses.
                const startPeriod = course.startPeriod ?? meta.start;
                const duration = course.duration ?? meta.duration;
                const top = (startPeriod - 1) * SLOT_BASE_HEIGHT + GAP;
                const height = duration * SLOT_BASE_HEIGHT - GAP * 2;
                return { top, height: Math.max(height, 56), course };
              })
              .filter((v): v is { top: number; height: number; course: ScheduledCourse } => v !== null);
      result[day] = positioned;
    });
    return result;
  }, []);
  const positionedCourses = useMemo(() => buildPositioned(timetable), [buildPositioned, timetable]);
  const leftPositioned = useMemo(() => buildPositioned(leftTimetable), [buildPositioned, leftTimetable]);
  const rightPositioned = useMemo(() => buildPositioned(rightTimetable), [buildPositioned, rightTimetable]);

  if (!isHydrated) return <ThemedView style={styles.center}><ThemedText>正在读取课表...</ThemedText></ThemedView>;

  // Calculate month for top-left display
  const monthStr = semesterStartDate ? formatMonth(semesterStartDate, selectedWeek) : '';
  // Full week width from the measured day-column width (fits the viewport).
  const gridW = TIME_COL_WIDTH + scrollBounds.dayW * 7;

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safe} edges={['right', 'left', 'bottom']}>
        {/* Compact header: week info + week selector */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <ThemedText themeColor="textSecondary" style={styles.summaryText}>
              {courses.length ? `${displayCount} 门课程 · 第 ${displayWeek} 周` : '还没有导入课程'}
            </ThemedText>
          </View>
          <View style={styles.weekControls}>
            <TextInput
              value={weekInput}
              onChangeText={value => setWeekInput(value.replace(/[^0-9]/g, ''))}
              onBlur={commitWeekInput}
              onSubmitEditing={commitWeekInput}
              keyboardType="number-pad"
              maxLength={2}
              style={[styles.weekInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.backgroundElement }]}
              accessibilityLabel="当前周次"
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.weekTotal}>/ {semesterWeeks}</ThemedText>
          </View>
        </View>

        {!courses.length ? (
          <ThemedView type="backgroundElement" style={styles.empty}>
                      <ThemedText type="subtitle">从真实课表开始</ThemedText>
                      <ThemedText themeColor="textSecondary">打开“导入课表”，选择 .docx 文件。</ThemedText>
                    </ThemedView>
        ) : (
          <GestureDetector gesture={timetablePan.gesture}>
            {/* Clip + measure container: the pan surface. overflow
                hidden keeps the neighbor panel invisible until it is
                pulled into view; onLayout feeds the pan's bounds. */}
            <View style={styles.panSurface} onLayout={onContainerMeasured}>
            <Animated.View style={[styles.weekStrip, { width: gridW }, stripAnimatedStyle]}>
              <View style={[styles.panelSlot, { width: gridW }]}>
              <View onLayout={onGridBodyMeasured} style={[styles.grid, { width: gridW }]}>
                <WeekGridBody
                  positioned={positionedCourses}
                  theme={theme}
                  week={selectedWeek}
                  weekIsCurrent={selectedWeekIsCurrent}
                  todayDay={todayDay}
                  todayDateLabel={todayDateLabel}
                  monthLabel={monthStr}
                  semesterStartDate={semesterStartDate}
                  maxPeriods={maxPeriods}
                  periodTimes={periodTimes}
                  periodDurations={periodDurations}
                  dayWidth={scrollBounds.dayW}
                  onCoursePress={handleCoursePress}
                  onPeriodPress={openPeriodEditor}
                  onEmptySlotPress={handleEmptySlotPress}
                />
                {neighborRight !== null && (
                  <View
                    style={[styles.grid, styles.neighborPanel, { width: gridW, left: scrollBounds.panelWidth }]}
                    pointerEvents="none"
                    // Rasterize: neighbors are static during a drag; the
                    // hardware-texture layer keeps the per-frame strip
                    // transform from re-walking their view trees.
                    renderToHardwareTextureAndroid
                    shouldRasterizeIOS
                  >
                    <WeekGridBody
                      positioned={rightPositioned}
                      theme={theme}
                      week={neighborRight}
                      weekIsCurrent={false}
                      todayDay={todayDay}
                      todayDateLabel={todayDateLabel}
                      monthLabel={!semesterStartDate ? '' : formatMonth(semesterStartDate, neighborRight)}
                      semesterStartDate={semesterStartDate}
                      maxPeriods={maxPeriods}
                      periodTimes={periodTimes}
                      periodDurations={periodDurations}
                      dayWidth={scrollBounds.dayW}
                      onCoursePress={handleCoursePress}
                      onPeriodPress={openPeriodEditor}
                      onEmptySlotPress={NOOP_EMPTY_SLOT}
                    />
                  </View>
                )}
                {neighborLeft !== null && (
                  <View
                    style={[styles.grid, styles.neighborPanel, { width: gridW, right: scrollBounds.panelWidth }]}
                    pointerEvents="none"
                    renderToHardwareTextureAndroid
                    shouldRasterizeIOS
                  >
                    <WeekGridBody
                      positioned={leftPositioned}
                      theme={theme}
                      week={neighborLeft}
                      weekIsCurrent={false}
                      todayDay={todayDay}
                      todayDateLabel={todayDateLabel}
                      monthLabel={!semesterStartDate ? '' : formatMonth(semesterStartDate, neighborLeft)}
                      semesterStartDate={semesterStartDate}
                      maxPeriods={maxPeriods}
                      periodTimes={periodTimes}
                      periodDurations={periodDurations}
                      dayWidth={scrollBounds.dayW}
                      onCoursePress={handleCoursePress}
                      onPeriodPress={openPeriodEditor}
                      onEmptySlotPress={NOOP_EMPTY_SLOT}
                    />
                  </View>
                )}
              </View>
              </View>
            </Animated.View>
            </View>
          </GestureDetector>
        )}
                {lastReport && lastReport.warnings.length > 0 && (
                          <ReportBanner
                            report={lastReport}
                            onPress={() => setReportDetailOpen(true)}
                            onDismiss={dismissReport}
                          />
                        )}

                      </SafeAreaView>

                      {selectedCourse && (
                        <CourseDetailModal course={selectedCourse} periodTimes={periodTimes} periodDurations={periodDurations} onClose={() => setSelectedCourse(null)} onEdit={() => { setEditingCourse(selectedCourse); setSelectedCourse(null); }} />
                      )}
                      {editingCourse && (
                        <CourseEditModal
                          course={editingCourse}
                          semesterWeeks={semesterWeeks}
                          sameNameCount={sameNameCount}
                          onUpdate={(patch) => {
                            updateCourse(editingCourse.id, patch);
                            setEditingCourse(null);
                          }}
                          onDelete={(scope) => {
                            resolveDelete(editingCourse, scope);
                            setEditingCourse(null);
                          }}
                          onClose={() => setEditingCourse(null)}
                        />
                      )}
                      {creatingDraft && (
                        <CourseEditModal
                          mode="create"
                          course={{
                            id: '',
                            name: '',
                            day: creatingDraft.day,
                            timeSlot: TimeSlot.ONE_TWO, // recomputed from periods on save
                            startPeriod: creatingDraft.startPeriod,
                            endPeriod: creatingDraft.endPeriod,
                            location: { address: '' },
                            teacher: { name: '' },
                            weekList: [creatingDraft.week],
                            duration: creatingDraft.endPeriod - creatingDraft.startPeriod + 1,
                          }}
                          semesterWeeks={semesterWeeks}
                          onCreate={(course) => {
                            addCourse({ ...course, weekList: course.weekList.length ? course.weekList : [creatingDraft.week] });
                            setCreatingDraft(null);
                          }}
                          onClose={() => setCreatingDraft(null)}
                        />
                      )}
                      {reportDetailOpen && lastReport && (
                        <ReportDetailModal
                          report={lastReport}
                          onClose={() => setReportDetailOpen(false)}
                        />
                      )}
                      {selectedPeriod !== null && (
                        <PeriodTimeModal
                          period={selectedPeriod}
                          value={periodTimeInput}
                          duration={periodDurationInput}
                          onChange={setPeriodTimeInput}
                          onDurationChange={setPeriodDurationInput}
                          onSave={savePeriodTime}
                          onClose={() => setSelectedPeriod(null)}
                        />
                      )}
    </ThemedView>
      );
    }

    // =============================================================================
    // Parse-report UI: a compact banner pinned to the bottom of the timetable
    // plus a full-detail modal. Visible only while `lastReport` has warnings.
    // =============================================================================

    const REPORT_CATEGORY_LABELS: Record<ReportWarning['category'], string> = {
      header: '表头',
      period: '节次',
      cell: '单元格',
      week: '周次',
      teacher: '教师',
      address: '地址',
      system: '系统',
    };

    const REPORT_SEVERITY_COLORS: Record<ReportWarning['severity'], string> = {
      info: '#5B9BD5',
      warning: '#D6913A',
      error: '#C0392B',
    };

    function ReportBanner({ report, onPress, onDismiss }: {
      report: ImportReport;
      onPress: () => void;
      onDismiss: () => void;
    }) {
      const count = report.warnings.length;
      const hasErrors = report.warnings.some((w) => w.severity === 'error');
      const accent = hasErrors ? REPORT_SEVERITY_COLORS.error : REPORT_SEVERITY_COLORS.warning;
      return (
        <View style={[reportBannerStyles.wrap, { borderColor: accent }]}>
          <Pressable onPress={onPress} style={reportBannerStyles.body} accessibilityRole="button" accessibilityLabel="查看解析详情">
            <ThemedText style={[reportBannerStyles.icon, { color: accent }]}>⚠</ThemedText>
            <ThemedText style={reportBannerStyles.text} numberOfLines={2}>
              解析存在 {count} 条警告，点击查看详情
            </ThemedText>
          </Pressable>
          <Pressable onPress={onDismiss} style={reportBannerStyles.dismissBtn} accessibilityRole="button" accessibilityLabel="关闭警告横幅">
            <ThemedText style={reportBannerStyles.dismiss}>×</ThemedText>
          </Pressable>
        </View>
      );
    }

    const reportBannerStyles = StyleSheet.create({
      wrap: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: Spacing.two,
        marginBottom: Spacing.one,
        paddingVertical: Spacing.one,
        paddingHorizontal: Spacing.two,
        borderWidth: 1,
        borderRadius: Spacing.one,
        backgroundColor: 'rgba(214,145,58,0.08)',
      },
      body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
      icon: { fontSize: 18, marginRight: Spacing.one },
      text: { flex: 1, fontSize: 13 },
      dismissBtn: { paddingHorizontal: Spacing.one },
      dismiss: { fontSize: 18, fontWeight: '700', color: '#888' },
    });

    function ReportDetailModal({ report, onClose }: { report: ImportReport; onClose: () => void }) {
      const theme = useTheme();
      // Group warnings by category for readability.
      const grouped = new Map<ReportWarning['category'], ReportWarning[]>();
      for (const w of report.warnings) {
        const arr = grouped.get(w.category) ?? [];
        arr.push(w);
        grouped.set(w.category, arr);
      }
      return (
        <Modal visible={true} onRequestClose={onClose} animationType="slide" transparent={true}>
          <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement, maxHeight: '85%' }]}>
              <View style={styles.modalHeader}>
                <ThemedText type="title" style={styles.modalTitle}>解析详情</ThemedText>
                <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="关闭">
                  <ThemedText type="smallBold" themeColor="textSecondary">×</ThemedText>
                </Pressable>
              </View>
              <ScrollView style={reportDetailStyles.body}>
                <ThemedText themeColor="textSecondary" style={reportDetailStyles.summary}>
                  共 {report.warnings.length} 条警告{report.suggestions.length ? `，${report.suggestions.length} 条建议` : ''}
                </ThemedText>
                {[...grouped.entries()].map(([category, items]) => (
                  <View key={category} style={reportDetailStyles.section}>
                    <ThemedText type="subtitle" style={reportDetailStyles.sectionTitle}>
                      {REPORT_CATEGORY_LABELS[category]}（{items.length}）
                    </ThemedText>
                    {items.map((w, idx) => (
                      <View key={`${category}-${idx}`} style={reportDetailStyles.item}>
                        <View style={[reportDetailStyles.dot, { backgroundColor: REPORT_SEVERITY_COLORS[w.severity] }]} />
                        <View style={reportDetailStyles.itemBody}>
                          <ThemedText style={reportDetailStyles.itemMessage}>{w.message}</ThemedText>
                          {w.rawText ? (
                            <ThemedText themeColor="textSecondary" style={reportDetailStyles.itemRaw} numberOfLines={2}>
                              {w.rawText}
                            </ThemedText>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
                {report.suggestions.length > 0 && (
                  <View style={reportDetailStyles.section}>
                    <ThemedText type="subtitle" style={reportDetailStyles.sectionTitle}>建议</ThemedText>
                    {report.suggestions.map((s, idx) => (
                      <ThemedText key={`s-${idx}`} style={reportDetailStyles.suggestion}>· {s}</ThemedText>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      );
    }

    const reportDetailStyles = StyleSheet.create({
      body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
      summary: { fontSize: 13, marginVertical: Spacing.two },
      section: { marginBottom: Spacing.three },
      sectionTitle: { marginBottom: Spacing.one },
      item: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
      dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
      itemBody: { flex: 1 },
      itemMessage: { fontSize: 14 },
      itemRaw: { fontSize: 12, marginTop: 2 },
      suggestion: { fontSize: 13, marginBottom: 4 },
    });

    function CourseDetailModal({ course, periodTimes, periodDurations, onClose, onEdit }: { course: ScheduledCourse; periodTimes: Record<number, string>; periodDurations: Record<number, number>; onClose: () => void; onEdit: () => void }) {
  const theme = useTheme();
  const meta = getTimeSlotMeta(course.timeSlot);
  if (!meta) return null;
  // Prefer the authoritative start/end written by the importer so the modal
  // shows the real period range (e.g. `5-7节`), not the coarse slot meta.
  const startPeriod = course.startPeriod ?? meta.start;
  const endPeriod = course.endPeriod ?? meta.end;
  return (
    <Modal visible={true} onRequestClose={onClose} animationType="fade" transparent={true}>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.modalHeader}>
            <ThemedText type="title" style={styles.modalTitle}>{course.name}</ThemedText>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="关闭">
              <ThemedText type="smallBold" themeColor="textSecondary">×</ThemedText>
            </Pressable>
          </View>
          <View style={styles.modalBody}>
                      <DetailRow label="上课时间" value={`${WEEK_DAY_LABELS[course.day]} ${formatPeriodTimeRange(startPeriod, endPeriod, periodTimes, periodDurations)}`} />
                      <DetailRow label="上课地点" value={course.location.address || '未填写'} />
                                            <DetailRow label="教师" value={`${course.teacher.name || '未填写'}${course.teacher.title ? ` · ${course.teacher.title}` : ''}`} />
                      <DetailRow label="周次" value={formatWeekDisplay(course.weekList, course.isOddEven)} />
                      {/* User note: hidden entirely when empty (per spec). */}
                      {course.note ? <DetailRow label="备注" value={course.note} /> : null}
                    </View>
          <Pressable onPress={onEdit} style={[styles.modalActionButton, styles.editButton, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="button" accessibilityLabel="编辑课程信息">
            <ThemedText type="smallBold">编辑</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function PeriodTimeModal({ period, value, duration, onChange, onDurationChange, onSave, onClose }: { period: number; value: string; duration: string; onChange: (value: string) => void; onDurationChange: (value: string) => void; onSave: () => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Modal visible={true} onRequestClose={onClose} animationType="fade" transparent={true}>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={styles.periodModalTitle}>第{period}节上课时间</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">请输入 24 小时制时间，例如 08:00。</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.periodFieldLabel}>开始时间</ThemedText>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="08:00"
            placeholderTextColor={theme.textSecondary}
            keyboardType="numbers-and-punctuation"
            style={[styles.periodInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
            accessibilityLabel={`第${period}节上课时间`}
            autoFocus
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.periodFieldLabel}>课程时长（分钟）</ThemedText>
          <TextInput
            value={duration}
            onChangeText={onDurationChange}
            placeholder="45"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            style={[styles.periodInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
            accessibilityLabel={`第${period}节课程时长`}
          />
          <View style={styles.periodModalActions}>
            <Pressable onPress={onClose} style={styles.modalActionButton}><ThemedText themeColor="textSecondary">取消</ThemedText></Pressable>
            <Pressable onPress={onSave} style={[styles.modalActionButton, { backgroundColor: theme.backgroundSelected }]}><ThemedText style={{ color: theme.text }}>保存</ThemedText></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createDefaultPeriodTimes(maxPeriods: number = DEFAULT_MAX_PERIODS): Record<number, string> {
  return periodsArray(maxPeriods).reduce<Record<number, string>>((times, period) => {
    const totalMinutes = 8 * 60 + (period - 1) * (45 + 5);
    times[period] = formatMinutes(totalMinutes);
    return times;
  }, {});
}

function createDefaultPeriodDurations(maxPeriods: number = DEFAULT_MAX_PERIODS): Record<number, number> {
  return periodsArray(maxPeriods).reduce<Record<number, number>>((durations, period) => {
    durations[period] = 45;
    return durations;
  }, {});
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatPeriodRange(startTime: string | undefined, duration: number): string {
  // Defensive: periodTimes is keyed 1..DEFAULT_MAX_PERIODS. A course with a
  // larger endPeriod (should be clamped upstream) must not crash the grid.
  if (!startTime) return '';
  const [hours, minutes] = startTime.split(':').map(Number);
  const endTime = formatMinutes(hours * 60 + minutes + duration);
  return `${startTime}\n${endTime}`;
}

function formatPeriodTimeRange(start: number, end: number, periodTimes: Record<number, string>, periodDurations: Record<number, number>): string {
  const startTime = periodTimes[start];
  const lessonCount = end - start + 1;
  const duration = Array.from({ length: lessonCount }, (_, index) => periodDurations[start + index] ?? 45).reduce((total, minutes) => total + minutes, 0) + (lessonCount - 1) * 5;
  return `(第${start}-${end}节 ${formatPeriodRange(startTime, duration)})`;
}

/**
 * Render a course's week info for the detail modal. Replaces the old
 * "周次模式" full/specific toggle — the v4 shape carries the concrete
 * weekList plus an optional odd/even marker, so we can show:
 *   - "全周" when the list covers [1..N] contiguously with N≥18
 *   - "单周 [1, 3, 5, ...]" / "双周 [2, 4, ...]" when marker present
 *   - "指定周: 1-8, 10-16" (range form) when no marker and not full
 */
function formatWeekDisplay(
  weekList: number[],
  isOddEven: 'odd' | 'even' | null | undefined,
): string {
  if (!weekList || weekList.length === 0) return '未指定';

  // "Full" heuristic: contiguous from 1 and length ≥ DEFAULT_SEMESTER_WEEKS.
  const isFullSemester =
    weekList[0] === 1 &&
    weekList.every((w, i) => i === 0 || w === weekList[i - 1] + 1) &&
    weekList.length >= 18;

  if (isFullSemester) return '全周';
  if (isOddEven === 'odd') return `单周 ${weekList.join(', ')}`;
  if (isOddEven === 'even') return `双周 ${weekList.join(', ')}`;

  // Compress runs to range form for readability: 1,2,3,5,7,8 → "1-3, 5, 7-8".
  const parts: string[] = [];
  let i = 0;
  while (i < weekList.length) {
    const start = weekList[i];
    let end = start;
    let j = i + 1;
    while (j < weekList.length && weekList[j] === end + 1) {
      end = weekList[j];
      j++;
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    i = j;
  }
  return `指定周: ${parts.join(', ')}`;
}

function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) || date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3]) ? null : startOfLocalDay(date);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayDate(startDate: string, week: number, day: typeof WEEK_DAYS[number]): string {
  const start = parseLocalDate(startDate);
  if (!start) return '';
  const dayIndex = WEEK_DAYS.indexOf(day);
  const date = new Date(start);
  date.setDate(start.getDate() + (week - 1) * 7 + dayIndex);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatMonth(startDate: string, week: number): string {
  const start = parseLocalDate(startDate);
  if (!start) return '';
  const date = new Date(start);
  date.setDate(start.getDate() + (week - 1) * 7);
  return `${date.getMonth() + 1}月`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>{label}</ThemedText>
      <ThemedText type="small" style={styles.detailValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safe: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center', paddingHorizontal: 0, paddingBottom: 4, paddingTop: 0 },

  // Compact header: week info + week selector
  header: {
    paddingVertical: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
  },
  headerLeft: { flex: 1 },
  summaryText: { fontSize: 12, lineHeight: 16, opacity: 0.85 },

  weekControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  weekInput: {
    width: 28, height: 22,
    borderWidth: 1,
    borderRadius: 4,
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontSize: 11,
    lineHeight: 18,
    includeFontPadding: false,
  },
  weekTotal: { fontSize: 10, marginLeft: 0 },

  empty: { padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
  panSurface: { flex: 1, overflow: 'hidden' as const },
  weekStrip: { position: 'relative' as const, alignItems: 'flex-start' as const },
  panelSlot: {},
  neighborPanel: { position: 'absolute' as const, top: 0 },

  // Grid layout
  grid: {
    position: 'relative',
  },
  timeHeader: { flexDirection: 'row', zIndex: 10 },
  gridBody: { flexDirection: 'row' },

  // Time column header (top-left corner with month)
  timeHead: {
    width: TIME_COL_WIDTH,
    height: 48,
    borderBottomWidth: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthLabel: { fontSize: 10, fontWeight: '600', opacity: 0.7 },

  // Day headers - compact
  dayHead: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    paddingHorizontal: 1,
  },
  dayLabel: { fontSize: 13, fontWeight: '700' },
  dateLabel: { fontSize: 9, marginTop: 0, opacity: 0.7 },
  dateLabelToday: { fontWeight: '600', opacity: 1 },

  // Time column - compact
  timeColumn: {
    width: TIME_COL_WIDTH,
    borderRightWidth: 0.5,
  },
  periodRow: { borderBottomWidth: 0.5 },
  timeCell: {
    width: TIME_COL_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 1,
    paddingVertical: 3,
  },
  periodNumber: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  periodTime: { fontSize: 8, textAlign: 'center', lineHeight: 11, marginTop: 0 },

  // Day columns
  dayColumn: {
    position: 'relative',
    borderRightWidth: 0.5,
  },
  gridLine: { borderBottomWidth: 0.5 },
  positionedCard: {
    position: 'absolute',
    left: GAP,
    right: GAP,
    zIndex: 5,
  },

  // Course cards - taller, more readable
    card: {
      borderRadius: 5,
      // Horizontal padding 3 (not 5): text width = dayWidth − 2×GAP − 2×border
      // − 2×padding = dayWidth − 12. At the 40..52px column range that keeps
      // ≥3 CJK chars per line on every common screen (needs dayWidth ≥ 42 at
      // 10pt; 大学英语's 4 chars fit exactly at the 52px cap). Paired with
      // maxFontSizeMultiplier={1} on the card texts so system font scaling
      // can't re-wrap them.
      padding: 3,
      paddingTop: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 2,
      borderWidth: 1,
      borderTopWidth: 2.5,
      width: '100%',
      height: '100%',
      overflow: 'visible',
    },
    courseName: { fontSize: 10, lineHeight: 13, fontWeight: '700', flexShrink: 1 },
    courseLocation: {
      fontSize: 9,
      lineHeight: 12,
      flexShrink: 1,
      // Bottom-anchored: grow upward over the name, unlimited lines.
      // left/right match the card's horizontal padding so the overlay
      // aligns with the name text.
      position: 'absolute',
      left: 3,
      right: 3,
      bottom: 5,
    },
    fileName: { marginTop: Spacing.one, textAlign: 'center', fontSize: 10 },

  // Modals
  modalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
    zIndex: 100,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: Spacing.four,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.three },
  periodModalTitle: { fontSize: 18, marginBottom: Spacing.two },
  periodFieldLabel: { marginTop: Spacing.three },
  periodInput: { height: 42, borderWidth: 1, borderRadius: 6, paddingHorizontal: Spacing.two, marginTop: Spacing.three, fontSize: 16 },
  periodModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.four },
  modalActionButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 6 },
  modalTitle: { fontSize: 18, maxWidth: '80%' },
  closeBtn: { padding: 4 },
  modalBody: { gap: Spacing.two },
  detailRow: { flexDirection: 'row', gap: Spacing.two },
  editButton: { alignSelf: 'flex-end', marginTop: Spacing.three, paddingHorizontal: Spacing.four },
  detailLabel: { minWidth: 64, flexShrink: 0 },
  detailValue: { flex: 1, flexWrap: 'wrap' },
});