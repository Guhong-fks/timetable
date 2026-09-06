import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { ScheduledCourse, TimetableData, coursesToTimetable, createEmptyTimetable } from '@/types/timetable';
import { getStoredValue, setStoredValue } from '@/lib/storage';

const STORAGE_KEY = 'course-table-app.timetable.v2';

interface ContextValue {
  courses: ScheduledCourse[];
  timetable: TimetableData;
  isHydrated: boolean;
  importedFileName?: string;
  semesterStartDate?: string;
  replaceCourses: (courses: ScheduledCourse[], name?: string, semesterStartDate?: string) => void;
  clearCourses: () => void;
}

const TimetableContext = createContext<ContextValue | null>(null);

export function TimetableProvider({ children }: PropsWithChildren) {
  const [courses, setCourses] = useState<ScheduledCourse[]>([]);
  const [importedFileName, setImportedFileName] = useState<string>();
  const [semesterStartDate, setSemesterStartDate] = useState<string>();
  const [isHydrated, setIsHydrated] = useState(false);

  // Load persisted data on mount
  useEffect(() => {
    void (async () => {
      try {
        const raw = await getStoredValue(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          setCourses(data.courses ?? []);
          setImportedFileName(data.importedFileName);
          setSemesterStartDate(data.semesterStartDate);
        }
      } catch (error) {
        console.warn('Failed to restore timetable data; using an empty timetable.', error);
      } finally {
        setIsHydrated(true);
      }
    })();
  }, []);

  // Persist data changes
  useEffect(() => {
    if (isHydrated) {
      void setStoredValue(STORAGE_KEY, JSON.stringify({ courses, importedFileName, semesterStartDate }));
    }
  }, [courses, importedFileName, semesterStartDate, isHydrated]);

  const value = useMemo(() => ({
    courses,
    timetable: courses.length ? coursesToTimetable(courses) : createEmptyTimetable(),
    isHydrated,
    importedFileName,
    semesterStartDate,
    replaceCourses: (next: ScheduledCourse[], name?: string, startDate?: string) => {
      setCourses(next);
      setImportedFileName(name);
      setSemesterStartDate(startDate);
    },
    clearCourses: () => {
      setCourses([]);
      setImportedFileName(undefined);
      setSemesterStartDate(undefined);
    },
  }), [courses, importedFileName, semesterStartDate, isHydrated]);

  return <TimetableContext.Provider value={value}>{children}</TimetableContext.Provider>;
}

export function useTimetable(): ContextValue {
  const ctx = useContext(TimetableContext);
  if (!ctx) throw new Error('useTimetable must be used inside TimetableProvider');
  return ctx;
}