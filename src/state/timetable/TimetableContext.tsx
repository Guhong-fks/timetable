import { createContext, PropsWithChildren, useContext, useEffect, useMemo } from 'react';
import { ScheduledCourse, TimetableData } from '@/types/timetable';
import type { ImportReport } from './types';
import { useTimetableStore } from './useTimetableStore';
import { useDebouncedPersist } from './useDebouncedPersist';
import { loadSnapshot } from './storage';

interface ContextValue {
  courses: ScheduledCourse[];
  timetable: TimetableData;
  isHydrated: boolean;
  importedFileName?: string;
  semesterStartDate?: string;
  semesterWeeks: number;
  maxPeriods: number;
  lastReport?: ImportReport;
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

const TimetableContext = createContext<ContextValue | null>(null);

/**
 * Provider. Three responsibilities, each delegated:
 *   1. React state + business actions → `useTimetableStore`
 *   2. Hydration → `loadSnapshot` (called once on mount)
 *   3. Persistence → `useDebouncedPersist`
 *
 * Compared to the previous monolithic implementation, this file is
 * mostly composition. Future storage-format bumps only touch
 * `storage.ts` + `migrate.ts`; future React-state changes only touch
 * `useTimetableStore.ts`.
 */
export function TimetableProvider({ children }: PropsWithChildren) {
  const store = useTimetableStore();

  // Hydrate once on mount. The store setters are stable (wrapped in
  // `useCallback`), so depending on them in this effect would still
  // be mount-only in practice — but ESLint's react-hooks rule wants
  // them listed. We intentionally use an empty dep array AND pass
  // them through the closure; the `mounted` flag protects against
  // the (vanishingly rare) case where the effect's async continuation
  // runs after unmount.
  useEffect(() => {
    let mounted = true;
    void loadSnapshot().then((snapshot) => {
      if (!mounted) return;
      store.replaceCourses(
        snapshot.courses,
        snapshot.importedFileName,
        snapshot.semesterStartDate,
        snapshot.lastReport,
      );
      store.setHydrated(true);
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist (gated by hydration). No-ops before hydration completes.
  useDebouncedPersist(store.snapshot, { enabled: store.isHydrated });

  // Project the flat store fields back into the original ContextValue
  // shape so the three call sites (`index.tsx`, `import.tsx`,
  // `settings.tsx`) need zero changes.
  const value = useMemo<ContextValue>(
    () => ({
      courses: store.snapshot.courses,
      timetable: store.timetable,
      isHydrated: store.isHydrated,
      importedFileName: store.snapshot.importedFileName,
      semesterStartDate: store.snapshot.semesterStartDate,
      semesterWeeks: store.snapshot.semesterWeeks,
      maxPeriods: store.snapshot.maxPeriods,
      lastReport: store.snapshot.lastReport,
      replaceCourses: store.replaceCourses,
      clearCourses: store.clearCourses,
      setSemesterStartDate: store.setSemesterStartDate,
      dismissReport: store.dismissReport,
    }),
    [
      store.snapshot.courses,
      store.snapshot.importedFileName,
      store.snapshot.semesterStartDate,
      store.snapshot.semesterWeeks,
      store.snapshot.maxPeriods,
      store.snapshot.lastReport,
      store.timetable,
      store.isHydrated,
      store.replaceCourses,
      store.clearCourses,
      store.setSemesterStartDate,
      store.dismissReport,
    ],
  );

  return <TimetableContext.Provider value={value}>{children}</TimetableContext.Provider>;
}

export function useTimetable(): ContextValue {
  const ctx = useContext(TimetableContext);
  if (!ctx) throw new Error('useTimetable must be used inside TimetableProvider');
  return ctx;
}