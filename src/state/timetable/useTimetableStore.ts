import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScheduledCourse,
  TimetableData,
  coursesToTimetable,
  computeSemesterWeeks,
  computeMaxPeriods,
  sanitizeCourses,
  DEFAULT_SEMESTER_WEEKS,
  DEFAULT_MAX_PERIODS,
} from '@/types/timetable';
import type { ImportReport, TimetableSnapshot } from './types';
import { writeWidgetData, getCurrentWeek, type WidgetCourseData } from '@/lib/widget-data';

/**
 * The reactive store behind the timetable context. Holds the six pieces
 * of state, exposes the business actions, and assembles a stable
 * `TimetableSnapshot` for the persistence hook to write.
 *
 * No storage I/O, no migration, no AppState wiring 鈥?those live in
 * sibling modules. This makes the store trivially testable with a fake
 * `react-test-renderer` harness, and means storage changes never have
 * to touch React state code.
 */
interface TimetableStore {
  /** Snapshot 鈥?recomputed only when one of the six fields changes. */
  snapshot: TimetableSnapshot;
  /** False until hydration finishes; UI gates the first paint on this. */
  isHydrated: boolean;
  setHydrated: (v: boolean) => void;
  /** Derived: courses bucketed by weekday for the renderer. */
  timetable: TimetableData;
  replaceCourses: (
    courses: ScheduledCourse[],
    name?: string,
    semesterStartDate?: string,
    report?: ImportReport,
  ) => void;
  /** Patch one course by id (course-edit modal). The result runs through
   * `sanitizeCourses`, so period clamping / placeholder stripping apply to
   * user edits too; week/maxPeriods derive from the updated list so a
   * moved course updates the grid height automatically. */
  updateCourse: (id: string, patch: Partial<ScheduledCourse>) => void;
  /** Append a new course (add-from-empty-slot). The result runs through
   * `sanitizeCourses` and recomputes the derived bounds like updateCourse. */
  addCourse: (course: Omit<ScheduledCourse, 'id'> & { id?: string }) => void;
  /** Remove the courses with the given ids (delete-modal scope 1+2
   * delete one id; scope 3 deletes every same-name id). Sanitizes and
   * recomputes the derived bounds like updateCourse. */
  deleteCourses: (ids: string[]) => void;
  clearCourses: () => void;
  setSemesterStartDate: (date: string) => void;
  /** 鎵嬪姩閿佸畾鏈鏈熸€诲懆鏁帮紙璁剧疆椤碉級銆?*/
  setSemesterWeeks: (n: number) => void;
  /** 鎵嬪姩閿佸畾涓€澶╂渶澶ц妭鏁帮紙璁剧疆椤碉級銆?*/
  setMaxPeriods: (n: number) => void;
  /** Hydrate 鏃舵妸鎸佷箙鍖栫殑鍛ㄦ暟/鑺傛暟浣滀负閿佸畾鍊兼仮澶嶃€?*/
  restoreManualBounds: (weeks: number, periods: number) => void;
  dismissReport: () => void;
}

export function useTimetableStore(): TimetableStore {
  const [courses, setCourses] = useState<ScheduledCourse[]>([]);
  const [importedFileName, setImportedFileName] = useState<string | undefined>(undefined);
  const [semesterStartDate, setSemesterStartDate] = useState<string | undefined>(undefined);
  // Auto-derived bounds from the course list.
  const [autoWeeks, setAutoWeeks] = useState(DEFAULT_SEMESTER_WEEKS);
  const [autoPeriods, setAutoPeriods] = useState(DEFAULT_MAX_PERIODS);
  // User manual overrides (settings page). When set they win over the
  // auto-derived value so a hand-built timetable isn't clipped to the
  // defaults before any course is added.
  const [weeksOverride, setWeeksOverride] = useState<number | null>(null);
  const [periodOverride, setPeriodOverride] = useState<number | null>(null);
  const semesterWeeks = weeksOverride ?? autoWeeks;
  const maxPeriods = periodOverride ?? autoPeriods;
  const [lastReport, setLastReport] = useState<ImportReport | undefined>(undefined);
  const [isHydrated, setHydrated] = useState(false);

  const replaceCourses = useCallback(
    (next: ScheduledCourse[], name?: string, startDate?: string, report?: ImportReport) => {
      // Sanitize EVERY inflow (imports included, not just hydrate/migrate):
      // drops courses with unresolvable timeSlots, clamps start/end periods
      // to the persisted-model bounds, and strips legacy placeholders. This
      // is the last line of defense before data reaches the renderer.
      const clean = sanitizeCourses(next);
      setCourses(clean);
      setImportedFileName(name);
      // `startDate !== undefined` lets callers pass an empty string to
      // clear it without ambiguity 鈥?mirrors the legacy provider's
      // contract that `import.tsx` already relies on.
      if (startDate !== undefined) setSemesterStartDate(startDate);
      setAutoWeeks(computeSemesterWeeks(clean));
      setAutoPeriods(computeMaxPeriods(clean));
      // 新导入的数据自带周数/节数，回到“跟随课程”。
      setWeeksOverride(null);
      setPeriodOverride(null);
      setLastReport(report);
      
    },
    [],
  );

  const updateCourse = useCallback((id: string, patch: Partial<ScheduledCourse>) => {
    setCourses(current => {
      const next = current.map(c => (c.id === id ? { ...c, ...patch, id: c.id } : c));
      const clean = sanitizeCourses(next);
      setAutoWeeks(computeSemesterWeeks(clean));
      setAutoPeriods(computeMaxPeriods(clean));
      
      return clean;
    });
  }, []);

  const addCourse = useCallback((course: Omit<ScheduledCourse, 'id'> & { id?: string }) => {
    // 稳定唯一 id：时间戳+随机数；编辑/重命名经 updateCourse 保持 id 不变。
    const id = course.id ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setCourses(current => {
      const next = [...current, { ...course, id } as ScheduledCourse];
      const clean = sanitizeCourses(next);
      setAutoWeeks(computeSemesterWeeks(clean));
      setAutoPeriods(computeMaxPeriods(clean));
      
      return clean;
    });
  }, []);

  const deleteCourses = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setCourses(current => {
      const next = current.filter(c => !drop.has(c.id));
      const clean = sanitizeCourses(next);
      setAutoWeeks(computeSemesterWeeks(clean));
      setAutoPeriods(computeMaxPeriods(clean));
      
      return clean;
    });
  }, []);

  const clearCourses = useCallback(() => {
    setCourses([]);
    setImportedFileName(undefined);
    setSemesterStartDate(undefined);
    setAutoWeeks(DEFAULT_SEMESTER_WEEKS);
    setAutoPeriods(DEFAULT_MAX_PERIODS);
    setWeeksOverride(null);
    setPeriodOverride(null);
    setLastReport(undefined);
  }, []);

  const setSemesterWeeks = useCallback((n: number) => {
    const clamped = Math.min(30, Math.max(1, Math.round(n)));
    setWeeksOverride(clamped);
  }, []);

  const setMaxPeriods = useCallback((n: number) => {
    const clamped = Math.min(20, Math.max(1, Math.round(n)));
    setPeriodOverride(clamped);
  }, []);

  const restoreManualBounds = useCallback((weeks: number, periods: number) => {
    setWeeksOverride(Math.max(1, Math.round(weeks)));
    setPeriodOverride(Math.max(1, Math.round(periods)));
  }, []);

  const dismissReport = useCallback(() => setLastReport(undefined), []);

  // Stable identity for unchanged content. The previous monolithic
  // implementation inlined this object inside a `useMemo` over six
  // fields; the effect there was correct but invisible. Lifting it out
  // also gives `useDebouncedPersist` a single source of truth for the
  // "did anything change?" check.
  const snapshot = useMemo<TimetableSnapshot>(
    () => ({
      courses,
      importedFileName,
      semesterStartDate,
      semesterWeeks,
      maxPeriods,
      lastReport,
    }),
    [courses, importedFileName, semesterStartDate, semesterWeeks, maxPeriods, lastReport],
  );

  const timetable = useMemo(() => coursesToTimetable(courses), [courses]);

  // Sync widget data on any timetable change (after hydration). Moved out of
  // the setState updaters: updaters must stay pure (React StrictMode
  // double-invokes them in dev), and this effect is the single source of
  // truth for 璇捐〃鍙樺寲 -> 鍚屾妗岄潰灏忕粍浠?
  useEffect(() => {
    if (!isHydrated) return;
    // Explicit projection: ScheduledCourse carries fields the native widget
    // payload doesn't need (duration/note/colorOverride); map them away so
    // the write path is type-checked instead of `as any`.
    const widgetCourses: WidgetCourseData[] = snapshot.courses.map((c) => ({
      id: c.id,
      name: c.name,
      day: c.day,
      timeSlot: c.timeSlot,
      startPeriod: c.startPeriod,
      endPeriod: c.endPeriod,
      location: c.location,
      teacher: c.teacher,
      weekList: c.weekList,
      isOddEven: c.isOddEven,
    }));
    writeWidgetData(widgetCourses, getCurrentWeek(snapshot.semesterStartDate), snapshot.semesterStartDate);
  }, [isHydrated, snapshot]);

  return {
    snapshot,
    isHydrated,
    setHydrated,
    timetable,
    replaceCourses,
    updateCourse,
    addCourse,
    deleteCourses,
    clearCourses,
    setSemesterStartDate,
    setSemesterWeeks,
    setMaxPeriods,
    restoreManualBounds,
    dismissReport,
  };
}
