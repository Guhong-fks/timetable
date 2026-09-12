/**
 * Period-schedule defaults and date/formatting helpers for the timetable UI.
 *
 * Extracted from index.tsx (formerly 1457-line screen) so the pure functions
 * are testable in isolation and the schedule screen only renders. The default
 * period rule here (08:00 + (N-1)*50, 45 min each) is the SAME rule used by
 * src/lib/notifications.ts and the native widget.
 */
import { DEFAULT_MAX_PERIODS, periodsArray, WEEK_DAYS } from '@/types/timetable';

/** Default start time of the Nth period, in minutes from 00:00. */
function defaultPeriodStartMinutes(period: number): number {
  return 8 * 60 + (period - 1) * (45 + 5);
}

export function createDefaultPeriodTimes(maxPeriods: number = DEFAULT_MAX_PERIODS): Record<number, string> {
  return periodsArray(maxPeriods).reduce<Record<number, string>>((times, period) => {
    times[period] = formatMinutes(defaultPeriodStartMinutes(period));
    return times;
  }, {});
}

export function createDefaultPeriodDurations(maxPeriods: number = DEFAULT_MAX_PERIODS): Record<number, number> {
  return periodsArray(maxPeriods).reduce<Record<number, number>>((durations, period) => {
    durations[period] = 45;
    return durations;
  }, {});
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatPeriodRange(startTime: string | undefined, duration: number): string {
  // Defensive: periodTimes is keyed 1..DEFAULT_MAX_PERIODS. A course with a
  // larger endPeriod (should be clamped upstream) must not crash the grid.
  if (!startTime) return '';
  const [hours, minutes] = startTime.split(':').map(Number);
  const endTime = formatMinutes(hours * 60 + minutes + duration);
  return `${startTime}\n${endTime}`;
}

export function formatPeriodTimeRange(start: number, end: number, periodTimes: Record<number, string>, periodDurations: Record<number, number>): string {
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
export function formatWeekDisplay(
  weekList: number[],
  isOddEven: 'odd' | 'even' | null | undefined,
): string {
  if (!weekList || weekList.length === 0) return '未指定';

  // "Full" heuristic: contiguous from 1 and length ≥ 18.
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

export function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) || date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3]) ? null : startOfLocalDay(date);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatDayDate(startDate: string, week: number, day: typeof WEEK_DAYS[number]): string {
  const start = parseLocalDate(startDate);
  if (!start) return '';
  const dayIndex = WEEK_DAYS.indexOf(day);
  const date = new Date(start);
  date.setDate(start.getDate() + (week - 1) * 7 + dayIndex);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatMonth(startDate: string, week: number): string {
  const start = parseLocalDate(startDate);
  if (!start) return '';
  const date = new Date(start);
  date.setDate(start.getDate() + (week - 1) * 7);
  return `${date.getMonth() + 1}月`;
}
