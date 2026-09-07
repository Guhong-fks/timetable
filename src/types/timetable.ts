export enum WeekDay { MONDAY='Monday', TUESDAY='Tuesday', WEDNESDAY='Wednesday', THURSDAY='Thursday', FRIDAY='Friday', SATURDAY='Saturday', SUNDAY='Sunday' }
export enum TimeSlot { ONE_TWO='1-2', THREE_FOUR='3-4', FIVE_SIX='5-6', SEVEN_EIGHT='7-8', EIGHT='8', NINE='9', TEN='10', ELEVEN='11', TWELVE='12', THIRTEEN='13' }

// Backward-compat alias for data persisted before 11/12/13 were split.
// Old '11-13' entries are read-only and coerced to ELEVEN on hydrate.
export const LEGACY_TIME_SLOT_KEYS = ['11-13'] as const;
export type LegacyTimeSlotKey = typeof LEGACY_TIME_SLOT_KEYS[number];
export const LEGACY_TIME_SLOT_META: Record<LegacyTimeSlotKey, {label: string; start: number; end: number; duration: number}> = {
  '11-13': {label: '11-13 节', start: 11, end: 13, duration: 3},
};

export const TIME_SLOT_ORDER: TimeSlot[] = [
  TimeSlot.ONE_TWO,
  TimeSlot.THREE_FOUR,
  TimeSlot.FIVE_SIX,
  TimeSlot.SEVEN_EIGHT,
  TimeSlot.EIGHT,
  TimeSlot.NINE,
  TimeSlot.TEN,
  TimeSlot.ELEVEN,
  TimeSlot.TWELVE,
  TimeSlot.THIRTEEN,
];

export const TIME_SLOT_META: Record<TimeSlot, {label: string; start: number; end: number; duration: number}> = {
  '1-2': {label: '1-2 节', start: 1, end: 2, duration: 2},
  '3-4': {label: '3-4 节', start: 3, end: 4, duration: 2},
  '5-6': {label: '5-6 节', start: 5, end: 6, duration: 2},
  '7-8': {label: '7-8 节', start: 7, end: 8, duration: 2},
  '8': {label: '8 节', start: 8, end: 8, duration: 1},
  '9': {label: '9 节', start: 9, end: 9, duration: 1},
  '10': {label: '10 节', start: 10, end: 10, duration: 1},
  '11': {label: '11 节', start: 11, end: 11, duration: 1},
  '12': {label: '12 节', start: 12, end: 12, duration: 1},
  '13': {label: '13 节', start: 13, end: 13, duration: 1},
};

export const CLASS_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export const WEEK_DAYS = [WeekDay.MONDAY, WeekDay.TUESDAY, WeekDay.WEDNESDAY, WeekDay.THURSDAY, WeekDay.FRIDAY, WeekDay.SATURDAY, WeekDay.SUNDAY];
export const DEFAULT_SEMESTER_WEEKS = 18;
export const DEFAULT_MAX_PERIODS = 13;
export const WEEK_DAY_LABELS: Record<WeekDay, string> = { Monday: '周一', Tuesday: '周二', Wednesday: '周三', Thursday: '周四', Friday: '周五', Saturday: '周六', Sunday: '周日' };

/** Strip fields removed in v3 (`code`, `classes`) and coerce legacy
 * `location: { campus, building, room }` to `{ address }`. Drop courses
 * whose timeSlot can no longer be resolved. Recompute `startPeriod` /
 * `endPeriod` so renderer positioning is consistent even when the persisted
 * `duration` no longer matches the slot meta (e.g. imported `5-7节`
 * persisted as `FIVE_SIX` with duration=3). v4 migration: collapse the old
 * `(weekPattern, specificWeeks)` pair into the new `(weekList, isOddEven)`
 * pair so data persisted before this change still loads. Returns a fresh
 * ScheduledCourse array. */
export function sanitizeCourses(raw: unknown): ScheduledCourse[] {
  if (!Array.isArray(raw)) return [];
  const out: ScheduledCourse[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Partial<ScheduledCourse> & {
      code?: unknown;
      classes?: unknown;
      startPeriod?: unknown;
      endPeriod?: unknown;
      // Legacy (pre-v4) week shape. Persisted JSON may still carry these.
      weekPattern?: unknown;
      specificWeeks?: unknown;
      location?: { address?: string; campus?: string; building?: string; room?: string };
    };
    const meta = getTimeSlotMeta(c.timeSlot as string);
    if (!meta) continue;

    // Build the address: prefer new `address`, otherwise join legacy fields
    // filtering out the placeholder string '未填写'.
    let address: string;
    if (typeof c.location?.address === 'string' && c.location.address.length) {
      address = c.location.address;
    } else {
      const parts = [c.location?.campus, c.location?.building, c.location?.room]
        .filter(v => typeof v === 'string' && v.length && v !== '未填写');
      address = parts.join(' ').trim();
    }

    // Resolve authoritative start/end: prefer explicit fields when present,
    // otherwise derive from `duration` + meta, otherwise fall back to meta.
    const metaStart = meta.start;
    const metaEnd = meta.end;
    const storedDuration = typeof c.duration === 'number' && c.duration >= 1 && c.duration <= 20 ? c.duration : undefined;
    const storedStart = typeof c.startPeriod === 'number' && c.startPeriod >= 1 && c.startPeriod <= 13 ? c.startPeriod : undefined;
    const storedEnd = typeof c.endPeriod === 'number' && c.endPeriod >= 1 && c.endPeriod <= 13 ? c.endPeriod : undefined;
    const startPeriod = storedStart ?? metaStart;
    const endPeriod = storedEnd
    ?? (storedDuration ? Math.min(startPeriod + storedDuration - 1, 13) : metaEnd);
    const duration = endPeriod - startPeriod + 1;

    // v4 week-shape migration. New JSON has `weekList` (+ optional
    // `isOddEven`); legacy JSON has `(weekPattern, specificWeeks?)`.
    let weekList: number[];
    let isOddEven: 'odd' | 'even' | null | undefined;
    if (Array.isArray(c.weekList)) {
      weekList = (c.weekList as unknown[]).filter(
        (n): n is number => typeof n === 'number' && n >= 1 && n <= 25,
      );
      isOddEven =
        c.isOddEven === 'odd' || c.isOddEven === 'even' || c.isOddEven === null
          ? c.isOddEven
          : undefined;
    } else if (c.weekPattern === 'full') {
      // Legacy full-semester: we don't know how long the semester was.
      // Use DEFAULT_SEMESTER_WEEKS so renderer weeks ≥ this still show.
      weekList = [];
      for (let w = 1; w <= DEFAULT_SEMESTER_WEEKS; w++) weekList.push(w);
      isOddEven = null;
    } else if (Array.isArray(c.specificWeeks)) {
      weekList = (c.specificWeeks as unknown[]).filter(
        (n): n is number => typeof n === 'number' && n >= 1 && n <= 25,
      );
      isOddEven = null;
    } else {
      weekList = [];
      isOddEven = undefined;
    }

    // Strip legacy placeholder values that pre-date #3 cleanup. Old payloads
    // (v3 storage) may carry '未填写' for teacher.name and an empty /
    // placeholder address; rewrite them to '' so the UI applies its own
    // fallback at render time.
    const cleanTeacher = (() => {
      const name = (c.teacher as { name?: unknown })?.name;
      if (typeof name !== 'string') return { name: '' };
      return name === '未填写' ? { name: '' } : { name };
    })();
    const cleanAddress = address === '未填写' ? '' : address;

    out.push({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      day: c.day as ScheduledCourse['day'],
      timeSlot: c.timeSlot as ScheduledCourse['timeSlot'],
      startPeriod,
      endPeriod,
      duration,
      location: { address: cleanAddress },
      teacher: cleanTeacher,
      weekList,
      isOddEven,
    });
  }
  return out;
}

/** Look up meta for a time slot key, falling back to legacy aliases.
 * Returns null if the key is unknown. */
export function getTimeSlotMeta(slot: string): {label: string; start: number; end: number; duration: number} | null {
  if (slot in TIME_SLOT_META) return TIME_SLOT_META[slot as TimeSlot];
  if (slot in LEGACY_TIME_SLOT_META) return LEGACY_TIME_SLOT_META[slot as LegacyTimeSlotKey];
  return null;
}

/** Compute semester weeks from imported courses (max week number, fallback to default) */
export function computeSemesterWeeks(courses: ScheduledCourse[]): number {
  let max = DEFAULT_SEMESTER_WEEKS;
  for (const course of courses) {
    for (const w of course.weekList ?? []) {
      if (w > max) max = w;
    }
  }
  return max;
}

/** Compute max periods per day from imported courses (max end period) */
export function computeMaxPeriods(courses: ScheduledCourse[]): number {
  let max = DEFAULT_MAX_PERIODS;
  for (const course of courses) {
    // Prefer the authoritative endPeriod written by the importer; fall back
    // to meta so legacy data still produces the right grid height.
    if (typeof course.endPeriod === 'number' && course.endPeriod > max) {
      max = course.endPeriod;
      continue;
    }
    const meta = getTimeSlotMeta(course.timeSlot);
    if (!meta) continue;
    if (meta.end > max) max = meta.end;
  }
  return max;
}

/** Generate array of period numbers [1, 2, ..., maxPeriods] */
export function periodsArray(maxPeriods: number): number[] {
  return Array.from({ length: maxPeriods }, (_, i) => i + 1);
}

export interface ScheduledCourse {
  id: string;
  name: string;
  day: WeekDay;
  timeSlot: TimeSlot;
  /** Authoritative first period (1-based). Used by the renderer for top
   * offset so it stays correct even when `timeSlot` is a coarse enum. */
  startPeriod: number;
  /** Authoritative last period (inclusive). Used for grid max-periods and
   * modal time display so non-standard spans (e.g. `5-7节`) report the real
   * end, not the slot meta end. */
  endPeriod: number;
  location: { address: string };
  teacher: { name: string; title?: string };
  /**
   * Concrete, sorted, deduped 1-based week numbers the course runs in.
   * Persisted as-is — no string-union discriminator needed; the renderer
   * can derive "full" / "specific" / "odd" / "even" labels from this list
   * plus `isOddEven`.
   */
  weekList: number[];
  /**
   * Marker from the source text:
   *   'odd'   — explicit "单周" (intersected with `weekList`)
   *   'even'  — explicit "双周" (intersected with `weekList`)
   *   null    — explicit range / list / or both markers (conflict ⇒ full)
   * `undefined` only when the source had no usable week info; in that
   * case `weekList` is empty and the importer's normaliser has already
   * dropped the course via a `cell` warning.
   */
  isOddEven?: 'odd' | 'even' | null;
  /** `endPeriod - startPeriod + 1`. Kept as a convenience field for the
   * renderer; always equals `endPeriod - startPeriod + 1`. */
  duration: number;
}
export type TimetableData = { [day in WeekDay]: ScheduledCourse[] };
export function createEmptyTimetable(): TimetableData {
  return WEEK_DAYS.reduce((result, day) => { result[day] = []; return result; }, {} as TimetableData);
}
export function coursesToTimetable(courses: ScheduledCourse[]): TimetableData {
  const result = createEmptyTimetable();
  courses.forEach(course => result[course.day].push(course));
  return result;
}
export function coursesForWeek(courses: ScheduledCourse[], week: number): ScheduledCourse[] {
  return courses.filter(course => course.weekList?.includes(week));
}