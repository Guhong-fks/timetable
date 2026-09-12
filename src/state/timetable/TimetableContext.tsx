import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ScheduledCourse, TimetableData } from '@/types/timetable';
import type { ImportReport } from './types';
import { useTimetableStore } from './useTimetableStore';
import { useDebouncedPersist } from './useDebouncedPersist';
import { loadSnapshot } from './storage';
import {
  initializeNotifications,
  scheduleAllNotifications,
  cancelCourseNotifications,
  rescheduleCourseNotifications,
  coursesScheduleEqual,
  loadPeriodSchedule,
  requestNotificationPermissions,
  beginScheduleEpoch,
  isCurrentScheduleEpoch,
} from '@/lib/notifications';

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
  updateCourse: (id: string, patch: Partial<ScheduledCourse>) => void;
  addCourse: (course: Omit<ScheduledCourse, 'id'> & { id?: string }) => void;
  deleteCourses: (ids: string[]) => void;
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
  const [notificationsInitialized, setNotificationsInitialized] = useState(false);

  // Initialize notifications once on mount
  useEffect(() => {
    void (async () => {
      await initializeNotifications();
      setNotificationsInitialized(true);
    })();
  }, []);

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

  // Schedule notifications when courses change (after hydration). Runs on an
  // idle callback (InteractionManager is deprecated in RN 0.86) so the
  // hundreds of serialized native calls don't compete with the first-paint
  // frame. Incremental: the previous snapshot is diffed against the new one —
  // removed courses get their notifications cancelled by id, added/changed
  // courses get rescheduled by id. Only the first schedule (or a semester
  // start date change) falls back to the full cancel-all + re-schedule.
  // Each batch claims an epoch; a newer batch (settings page manual resync)
  // invalidates an older in-flight one so two batches can never interleave.
  const prevCoursesRef = useRef<ScheduledCourse[] | null>(null);

  useEffect(() => {
    if (!store.isHydrated || !notificationsInitialized) return;

    const task = requestIdleCallback(() => {
      void (async () => {
        const epoch = beginScheduleEpoch();
        const prefs = await loadPeriodSchedule();
        if (!isCurrentScheduleEpoch(epoch)) return;
        if (!prefs.enabled || !store.snapshot.semesterStartDate) {
          prevCoursesRef.current = store.snapshot.courses;
          return;
        }

        // 权限只在整个批次开头查一次（不再每课×每周重复查询）。
        const granted = await requestNotificationPermissions();
        if (!isCurrentScheduleEpoch(epoch)) return;
        if (!granted) {
          prevCoursesRef.current = store.snapshot.courses;
          return;
        }

        const courses = store.snapshot.courses;
        const semesterStartDate = store.snapshot.semesterStartDate;
        const prev = prevCoursesRef.current;

        if (prev === null || prev.length === 0 && courses.length > 0) {
          // 首次调度（或从空到有）：全量。
          await scheduleAllNotifications(courses, semesterStartDate, prefs.periodTimes, prefs.periodDurations, prefs.leadMinutes);
        } else {
          // 增量 diff：删除 → 定向取消；新增/变更 → 定向重排。
          const removed = prev.filter((p) => !courses.some((c) => c.id === p.id));
          const upserted = courses.filter((c) => {
            const p = prev.find((x) => x.id === c.id);
            return !p || !coursesScheduleEqual(p, c);
          });
          for (const course of removed) {
            if (!isCurrentScheduleEpoch(epoch)) return;
            await cancelCourseNotifications(course);
          }
          for (const course of upserted) {
            if (!isCurrentScheduleEpoch(epoch)) return;
            await rescheduleCourseNotifications(course, semesterStartDate, prefs.periodTimes, prefs.periodDurations, prefs.leadMinutes);
          }
        }

        if (!isCurrentScheduleEpoch(epoch)) return;
        prevCoursesRef.current = courses;
      })();
    });

    return () => cancelIdleCallback(task);
  }, [store.isHydrated, notificationsInitialized, store.snapshot.courses, store.snapshot.semesterStartDate]);

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
      updateCourse: store.updateCourse,
      addCourse: store.addCourse,
      deleteCourses: store.deleteCourses,
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
      store.updateCourse,
      store.addCourse,
      store.deleteCourses,
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