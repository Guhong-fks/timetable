import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { ScheduledCourse, TimetableData, coursesToTimetable, createEmptyTimetable, computeSemesterWeeks, computeMaxPeriods, DEFAULT_SEMESTER_WEEKS, DEFAULT_MAX_PERIODS } from '@/types/timetable';
import { getStoredValue, setStoredValue } from '@/lib/storage';

const STORAGE_KEY = 'course-table-app.timetable.v2';

interface StoredTimetableData {
  version: number;
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

  // Load persisted data on mount
  useEffect(() => {
    void (async () => {
      try {
        const raw = await getStoredValue(STORAGE_KEY);
        let data: StoredTimetableData;

        if (raw) {
          // Try to parse as JSON with version check
          try {
            const parsed = JSON.parse(raw) as any;
            // If version is missing or outdated (before v2), migrate to v2
            if (parsed.version !== 2) {
              console.log('Migrating timetable data from v1 to v2...');
              // Migrate v1 data (which doesn't have version, semesterWeeks, maxPeriods)
              data = {
                version: 2,
                courses: parsed.courses ?? [],
                importedFileName: parsed.importedFileName,
                semesterStartDate: parsed.semesterStartDate,
                semesterWeeks: parsed.semesterWeeks ?? DEFAULT_SEMESTER_WEEKS,
                maxPeriods: parsed.maxPeriods ?? DEFAULT_MAX_PERIODS
              };
              // Persist migrated data
              await setStoredValue(STORAGE_KEY, JSON.stringify(data));
            } else {
              data = parsed;
            }
          } catch (parseError) {
            // Invalid JSON format; start fresh
            console.warn('Failed to parse timetable data format; starting with empty timetable.', parseError);
            data = { version: 2, courses: [], importedFileName: undefined, semesterStartDate: undefined, semesterWeeks: DEFAULT_SEMESTER_WEEKS, maxPeriods: DEFAULT_MAX_PERIODS };
          }
        } else {
          // No stored data; start with defaults
          data = { version: 2, courses: [], importedFileName: undefined, semesterStartDate: undefined, semesterWeeks: DEFAULT_SEMESTER_WEEKS, maxPeriods: DEFAULT_MAX_PERIODS };
        }

        setCourses(data.courses);
        setImportedFileName(data.importedFileName);
        setSemesterStartDate(data.semesterStartDate);
        setSemesterWeeks(data.semesterWeeks);
        setMaxPeriods(data.maxPeriods);
      } catch (error) {
        console.warn('Failed to restore timetable data; using an empty timetable.', error);
        // Start fresh on error
        setCourses([]);
        setImportedFileName(undefined);
        setSemesterStartDate(undefined);
        setSemesterWeeks(DEFAULT_SEMESTER_WEEKS);
        setMaxPeriods(DEFAULT_MAX_PERIODS);
      } finally {
        setIsHydrated(true);
      }
    })();
  }, []);

  // Persist data changes
  useEffect(() => {
    void setStoredValue(STORAGE_KEY, JSON.stringify({ version: 2, courses, importedFileName, semesterStartDate, semesterWeeks, maxPeriods }));
  }, [courses, importedFileName, semesterStartDate, semesterWeeks, maxPeriods]);

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