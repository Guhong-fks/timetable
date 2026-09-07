import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { ScheduledCourse, TimetableData, coursesToTimetable, createEmptyTimetable, computeSemesterWeeks, computeMaxPeriods, sanitizeCourses, DEFAULT_SEMESTER_WEEKS, DEFAULT_MAX_PERIODS } from '@/types/timetable';
import { getStoredValue, setStoredValue } from '@/lib/storage';

const STORAGE_KEY = 'course-table-app.timetable.v3';
const LEGACY_KEY_V2 = 'course-table-app.timetable.v2';
const LEGACY_KEY_V1 = 'course-table-app.timetable';

interface StoredTimetableData {
  version: 3;
  courses: ScheduledCourse[];
  importedFileName?: string;
  semesterStartDate?: string;
  semesterWeeks: number;
  maxPeriods: number;
}

interface ContextValue {
  courses: ScheduledCourse[];
  timetable: TimetableData;
  isHydrated: boolean;
  importedFileName?: string;
  semesterStartDate?: string;
  semesterWeeks: number;
  maxPeriods: number;
  replaceCourses: (courses: ScheduledCourse[], name?: string, semesterStartDate?: string) => void;
  clearCourses: () => void;
  setSemesterStartDate: (date: string) => void;
}

const TimetableContext = createContext<ContextValue | null>(null);

export function TimetableProvider({ children }: PropsWithChildren) {
  const [courses, setCourses] = useState<ScheduledCourse[]>([]);
  const [importedFileName, setImportedFileName] = useState<string>();
  const [semesterStartDate, setSemesterStartDate] = useState<string>();
  const [semesterWeeks, setSemesterWeeks] = useState(DEFAULT_SEMESTER_WEEKS);
  const [maxPeriods, setMaxPeriods] = useState(DEFAULT_MAX_PERIODS);
  const [isHydrated, setIsHydrated] = useState(false);

  // 防抖写入
  const writeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<{
    courses: ScheduledCourse[];
    importedFileName?: string;
    semesterStartDate?: string;
    semesterWeeks: number;
    maxPeriods: number;
  } | null>(null);
  // Mirror of `isHydrated` so the write scheduler can read the latest value
  // without having to be listed as an effect dependency (which would re-fire
  // the persist effect on every hydration change).
  const isHydratedRef = useRef(false);

  const flushWrite = useCallback(() => {
    if (writeRef.current) {
      clearTimeout(writeRef.current);
      writeRef.current = null;
    }
    if (pendingDataRef.current) {
      const payload = pendingDataRef.current;
      pendingDataRef.current = null;
      void setStoredValue(STORAGE_KEY, JSON.stringify({ version: 3, ...payload }));
    }
  }, []);

  const scheduleWrite = useCallback((data: {
    courses: ScheduledCourse[];
    importedFileName?: string;
    semesterStartDate?: string;
    semesterWeeks: number;
    maxPeriods: number;
  }) => {
    // Skip writes before hydration completes to avoid clobbering persisted data
    // with empty defaults. Hydration sets `isHydrated` after the first read.
    if (!isHydratedRef.current) return;

    // Skip writes that don't actually change the persisted shape.
    const prev = pendingDataRef.current;
    if (
      prev &&
      prev.courses === data.courses &&
      prev.importedFileName === data.importedFileName &&
      prev.semesterStartDate === data.semesterStartDate &&
      prev.semesterWeeks === data.semesterWeeks &&
      prev.maxPeriods === data.maxPeriods
    ) {
      return;
    }

    pendingDataRef.current = data;
    if (writeRef.current) {
      clearTimeout(writeRef.current);
    }
    writeRef.current = setTimeout(flushWrite, 300);
  }, [flushWrite]);

  // Load persisted data on mount
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        // Try v3 first, then migrate from v2 / v1 if present.
        let raw = await getStoredValue(STORAGE_KEY);
        let legacyKeyToClear: string | null = null;
        let data: StoredTimetableData;

        if (!raw) {
          // Try legacy keys in order.
          raw = await getStoredValue(LEGACY_KEY_V2);
          if (raw) legacyKeyToClear = LEGACY_KEY_V2;
          else {
            raw = await getStoredValue(LEGACY_KEY_V1);
            if (raw) legacyKeyToClear = LEGACY_KEY_V1;
          }
        }

        if (raw) {
          try {
            const parsed = JSON.parse(raw) as any;
            // Migrate any pre-v3 payload to v3, stripping removed fields.
            data = {
              version: 3,
              courses: sanitizeCourses(parsed.courses),
              importedFileName: parsed.importedFileName,
              semesterStartDate: parsed.semesterStartDate,
              semesterWeeks: parsed.semesterWeeks ?? DEFAULT_SEMESTER_WEEKS,
              maxPeriods: parsed.maxPeriods ?? DEFAULT_MAX_PERIODS,
            };
            // Persist migrated data and remove the legacy key.
            await setStoredValue(STORAGE_KEY, JSON.stringify(data));
            if (legacyKeyToClear) await setStoredValue(legacyKeyToClear, '');
          } catch (parseError) {
            console.warn('Failed to parse timetable data format; starting with empty timetable.', parseError);
            data = { version: 3, courses: [], importedFileName: undefined, semesterStartDate: undefined, semesterWeeks: DEFAULT_SEMESTER_WEEKS, maxPeriods: DEFAULT_MAX_PERIODS };
          }
        } else {
          data = { version: 3, courses: [], importedFileName: undefined, semesterStartDate: undefined, semesterWeeks: DEFAULT_SEMESTER_WEEKS, maxPeriods: DEFAULT_MAX_PERIODS };
        }

        if (mounted) {
          setCourses(data.courses);
          setImportedFileName(data.importedFileName);
          setSemesterStartDate(data.semesterStartDate);
          setSemesterWeeks(data.semesterWeeks);
          setMaxPeriods(data.maxPeriods);
        }
      } catch (error) {
        console.warn('Failed to restore timetable data; using an empty timetable.', error);
        if (mounted) {
          setCourses([]);
          setImportedFileName(undefined);
          setSemesterStartDate(undefined);
          setSemesterWeeks(DEFAULT_SEMESTER_WEEKS);
          setMaxPeriods(DEFAULT_MAX_PERIODS);
        }
      } finally {
        isHydratedRef.current = true;
        if (mounted) setIsHydrated(true);
      }
    })();

    return () => { mounted = false; };
  }, []);

  // Persist data changes (debounced). Cleanup only cancels the pending timer
  // for this dep-change; it does NOT flush — the dedicated unmount effect
  // below owns that responsibility so the two cleanups can't race.
  useEffect(() => {
    const data = { courses, importedFileName, semesterStartDate, semesterWeeks, maxPeriods };
    scheduleWrite(data);
    return () => {
      if (writeRef.current) {
        clearTimeout(writeRef.current);
        writeRef.current = null;
      }
    };
  }, [courses, importedFileName, semesterStartDate, semesterWeeks, maxPeriods, scheduleWrite]);

  // AppState: flush only on `background` (the persistent-background state on
  // both iOS and Android). `inactive` covers transient interruptions such as
  // iOS Control Center or incoming calls — flushing then would discard a
  // valid debounce window for no reason. Unmount flushes as a last resort so
  // a pending write still lands when the provider is torn down.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        flushWrite();
      }
    });
    return () => {
      subscription.remove();
      // Final flush on unmount — ensure pending data is persisted before the
      // provider disappears (e.g. on hot reload or app shutdown).
      flushWrite();
    };
  }, [flushWrite]);

  const value = useMemo(() => ({
    courses,
    timetable: courses.length ? coursesToTimetable(courses) : createEmptyTimetable(),
    isHydrated,
    importedFileName,
    semesterStartDate,
    semesterWeeks,
    maxPeriods,
    replaceCourses: (next: ScheduledCourse[], name?: string, startDate?: string) => {
      setCourses(next);
      setImportedFileName(name);
      if (startDate !== undefined) setSemesterStartDate(startDate);
      setSemesterWeeks(computeSemesterWeeks(next));
      setMaxPeriods(computeMaxPeriods(next));
    },
    clearCourses: () => {
      setCourses([]);
      setImportedFileName(undefined);
      setSemesterStartDate(undefined);
      setSemesterWeeks(DEFAULT_SEMESTER_WEEKS);
      setMaxPeriods(DEFAULT_MAX_PERIODS);
    },
    setSemesterStartDate: (date: string) => setSemesterStartDate(date),
  }), [courses, importedFileName, semesterStartDate, semesterWeeks, maxPeriods, isHydrated]);

  return <TimetableContext.Provider value={value}>{children}</TimetableContext.Provider>;
}

export function useTimetable(): ContextValue {
  const ctx = useContext(TimetableContext);
  if (!ctx) throw new Error('useTimetable must be used inside TimetableProvider');
  return ctx;
}