import { useCallback, useMemo, useState } from 'react';
import {
  ScheduledCourse,
  TimetableData,
  coursesToTimetable,
  computeSemesterWeeks,
  computeMaxPeriods,
  DEFAULT_SEMESTER_WEEKS,
  DEFAULT_MAX_PERIODS,
} from '@/types/timetable';
import type { ImportReport, TimetableSnapshot } from './types';

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
export interface TimetableStore {
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
  const [isHydrated, setIsHydrated] = useState(false);

  const replaceCourses = useCallback(
    (next: ScheduledCourse[], name?: string, startDate?: string, report?: ImportReport) => {
      setCourses(next);
      setImportedFileName(name);
      // `startDate !== undefined` lets callers pass an empty string to
      // clear it without ambiguity — mirrors the legacy provider's
      // contract that `import.tsx` already relies on.
      if (startDate !== undefined) setSemesterStartDate(startDate);
      setSemesterWeeks(computeSemesterWeeks(next));
      setMaxPeriods(computeMaxPeriods(next));
      setLastReport(report);
    },
    [],
  );

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

  return {
    snapshot,
    isHydrated,
    setHydrated,
    timetable,
    replaceCourses,
    clearCourses,
    setSemesterStartDate,
    dismissReport,
  };
}