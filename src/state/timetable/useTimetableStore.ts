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
import { writeWidgetData, getCurrentWeek } from '@/lib/widget-data';

/**
 * The reactive store behind the timetable context. Holds the six pieces
 * of state, exposes the business actions, and assembles a stable
 * `TimetableSnapshot` for the persistence hook to write.
 *
 * No storage I/O, no migration, no AppState wiring — those live in
 * sibling modules. This makes the store trivially testable with a fake
 * `react-test-renderer` harness, and means storage changes never have
 * to touch React state code.
 */
interface TimetableStore {
  /** Snapshot — recomputed only when one of the six fields changes. */
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
  dismissReport: () => void;
}

export function useTimetableStore(): TimetableStore {
  const [courses, setCourses] = useState<ScheduledCourse[]>([]);
  const [importedFileName, setImportedFileName] = useState<string | undefined>(undefined);
  const [semesterStartDate, setSemesterStartDate] = useState<string | undefined>(undefined);
  const [semesterWeeks, setSemesterWeeks] = useState(DEFAULT_SEMESTER_WEEKS);
  const [maxPeriods, setMaxPeriods] = useState(DEFAULT_MAX_PERIODS);
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
      // clear it without ambiguity — mirrors the legacy provider's
      // contract that `import.tsx` already relies on.
      if (startDate !== undefined) setSemesterStartDate(startDate);
      setSemesterWeeks(computeSemesterWeeks(clean));
      setMaxPeriods(computeMaxPeriods(clean));
      setLastReport(report);
      
    },
    [],
  );

  const updateCourse = useCallback((id: string, patch: Partial<ScheduledCourse>) => {
    setCourses(current => {
      const next = current.map(c => (c.id === id ? { ...c, ...patch, id: c.id } : c));
      const clean = sanitizeCourses(next);
      setSemesterWeeks(computeSemesterWeeks(clean));
      setMaxPeriods(computeMaxPeriods(clean));
      
      return clean;
    });
  }, []);

  const addCourse = useCallback((course: Omit<ScheduledCourse, 'id'> & { id?: string }) => {
    // Stable unique id: timestamp+random is enough for user-created rows
    // (imports no longer collide since they carry their own ids, and a
    // rename/edit keeps the id via updateCourse).
    const id = course.id ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setCourses(current => {
      const next = [...current, { ...course, id } as ScheduledCourse];
      const clean = sanitizeCourses(next);
      setSemesterWeeks(computeSemesterWeeks(clean));
      setMaxPeriods(computeMaxPeriods(clean));
      
      return clean;
    });
  }, []);

  const deleteCourses = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setCourses(current => {
      const next = current.filter(c => !drop.has(c.id));
      const clean = sanitizeCourses(next);
      setSemesterWeeks(computeSemesterWeeks(clean));
      setMaxPeriods(computeMaxPeriods(clean));
      
      return clean;
    });
  }, []);

  const clearCourses = useCallback(() => {
    setCourses([]);
    setImportedFileName(undefined);
    setSemesterStartDate(undefined);
    setSemesterWeeks(DEFAULT_SEMESTER_WEEKS);
    setMaxPeriods(DEFAULT_MAX_PERIODS);
    setLastReport(undefined);
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
  // truth for 课表变化 -> 同步桌面小组件.
  useEffect(() => {
    if (!isHydrated) return;
    writeWidgetData(snapshot.courses as any, getCurrentWeek(snapshot.semesterStartDate), snapshot.semesterStartDate);
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
    dismissReport,
  };
}
