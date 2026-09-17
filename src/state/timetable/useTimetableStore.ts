import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScheduledCourse, TimetableData, coursesToTimetable, computeSemesterWeeks, computeMaxPeriods, sanitizeCourses, DEFAULT_SEMESTER_WEEKS, DEFAULT_MAX_PERIODS } from '@/types/timetable';
import type { ImportReport, TimetableSnapshot } from './types';
import type { TimetableProfile } from './profiles';
import { createProfileId, profileFromSnapshot } from './profiles';
import { writeWidgetData, getCurrentWeek, type WidgetCourseData } from '@/lib/widget-data';

interface TimetableStore {
  snapshot: TimetableSnapshot;
  isHydrated: boolean;
  setHydrated: (v: boolean) => void;
  timetable: TimetableData;
  replaceCourses: (courses: ScheduledCourse[], name?: string, semesterStartDate?: string, report?: ImportReport) => void;
  updateCourse: (id: string, patch: Partial<ScheduledCourse>) => void;
  addCourse: (course: Omit<ScheduledCourse, 'id'> & { id?: string }) => void;
  deleteCourses: (ids: string[]) => void;
  clearCourses: () => void;
  setSemesterStartDate: (date: string) => void;
  setSemesterWeeks: (n: number) => void;
  setMaxPeriods: (n: number) => void;
  restoreManualBounds: (weeks: number, periods: number) => void;
  dismissReport: () => void;
  profiles: TimetableProfile[];
  activeProfileId: string;
  switchProfile: (id: string) => void;
  addProfile: (name: string) => void;
  renameProfile: (id: string, name: string) => void;
  deleteProfile: (id: string) => void;
  restoreSnapshot: (snapshot: TimetableSnapshot) => void;
}

export function useTimetableStore(): TimetableStore {
  const [courses, setCourses] = useState<ScheduledCourse[]>([]);
  const [importedFileName, setImportedFileName] = useState<string | undefined>();
  const [semesterStartDate, setSemesterStartDate] = useState<string | undefined>();
  const [autoWeeks, setAutoWeeks] = useState(DEFAULT_SEMESTER_WEEKS);
  const [autoPeriods, setAutoPeriods] = useState(DEFAULT_MAX_PERIODS);
  const [weeksOverride, setWeeksOverride] = useState<number | null>(null);
  const [periodOverride, setPeriodOverride] = useState<number | null>(null);
  const semesterWeeks = weeksOverride ?? autoWeeks;
  const maxPeriods = periodOverride ?? autoPeriods;
  const [lastReport, setLastReport] = useState<ImportReport | undefined>();
  const [isHydrated, setHydrated] = useState(false);
  const [profiles, setProfiles] = useState<TimetableProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('default');

  const updateActiveProfile = useCallback((patch: Partial<TimetableProfile>) => {
    setProfiles(current => current.map(profile => profile.id === activeProfileId ? { ...profile, ...patch } : profile));
  }, [activeProfileId]);

  const replaceCourses = useCallback((next: ScheduledCourse[], name?: string, startDate?: string, report?: ImportReport) => {
    const clean = sanitizeCourses(next);
    const nextWeeks = computeSemesterWeeks(clean);
    const nextPeriods = computeMaxPeriods(clean);
    setCourses(clean);
    setImportedFileName(name);
    if (startDate !== undefined) setSemesterStartDate(startDate);
    setAutoWeeks(nextWeeks);
    setAutoPeriods(nextPeriods);
    setWeeksOverride(null);
    setPeriodOverride(null);
    setLastReport(report);
    updateActiveProfile({ courses: clean, importedFileName: name, ...(startDate !== undefined ? { semesterStartDate: startDate } : {}), semesterWeeks: nextWeeks, maxPeriods: nextPeriods, lastReport: report });
  }, [updateActiveProfile]);

  const updateCourse = useCallback((id: string, patch: Partial<ScheduledCourse>) => {
    setCourses(current => {
      const clean = sanitizeCourses(current.map(c => c.id === id ? { ...c, ...patch, id: c.id } : c));
      setAutoWeeks(computeSemesterWeeks(clean));
      setAutoPeriods(computeMaxPeriods(clean));
      updateActiveProfile({ courses: clean, semesterWeeks: computeSemesterWeeks(clean), maxPeriods: computeMaxPeriods(clean) });
      return clean;
    });
  }, [updateActiveProfile]);

  const addCourse = useCallback((course: Omit<ScheduledCourse, 'id'> & { id?: string }) => {
    const id = course.id ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setCourses(current => {
      const clean = sanitizeCourses([...current, { ...course, id } as ScheduledCourse]);
      setAutoWeeks(computeSemesterWeeks(clean));
      setAutoPeriods(computeMaxPeriods(clean));
      updateActiveProfile({ courses: clean, semesterWeeks: computeSemesterWeeks(clean), maxPeriods: computeMaxPeriods(clean) });
      return clean;
    });
  }, [updateActiveProfile]);

  const deleteCourses = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setCourses(current => {
      const clean = sanitizeCourses(current.filter(c => !drop.has(c.id)));
      setAutoWeeks(computeSemesterWeeks(clean));
      setAutoPeriods(computeMaxPeriods(clean));
      updateActiveProfile({ courses: clean, semesterWeeks: computeSemesterWeeks(clean), maxPeriods: computeMaxPeriods(clean) });
      return clean;
    });
  }, [updateActiveProfile]);

  const clearCourses = useCallback(() => {
    setCourses([]); setImportedFileName(undefined); setSemesterStartDate(undefined);
    setAutoWeeks(DEFAULT_SEMESTER_WEEKS); setAutoPeriods(DEFAULT_MAX_PERIODS);
    setWeeksOverride(null); setPeriodOverride(null); setLastReport(undefined);
    updateActiveProfile({ courses: [], importedFileName: undefined, semesterStartDate: undefined, semesterWeeks: DEFAULT_SEMESTER_WEEKS, maxPeriods: DEFAULT_MAX_PERIODS, lastReport: undefined });
  }, [updateActiveProfile]);

  const setSemesterStartDateForActive = useCallback((date: string) => { setSemesterStartDate(date); updateActiveProfile({ semesterStartDate: date }); }, [updateActiveProfile]);
  const setSemesterWeeks = useCallback((n: number) => { const value = Math.min(30, Math.max(1, Math.round(n))); setWeeksOverride(value); updateActiveProfile({ semesterWeeks: value }); }, [updateActiveProfile]);
  const setMaxPeriods = useCallback((n: number) => { const value = Math.min(20, Math.max(1, Math.round(n))); setPeriodOverride(value); updateActiveProfile({ maxPeriods: value }); }, [updateActiveProfile]);
  const restoreManualBounds = useCallback((weeks: number, periods: number) => { const w = Math.max(1, Math.round(weeks)); const p = Math.max(1, Math.round(periods)); setWeeksOverride(w); setPeriodOverride(p); updateActiveProfile({ semesterWeeks: w, maxPeriods: p }); }, [updateActiveProfile]);
  const dismissReport = useCallback(() => { setLastReport(undefined); updateActiveProfile({ lastReport: undefined }); }, [updateActiveProfile]);

  const restoreSnapshot = useCallback((snapshot: TimetableSnapshot) => {
    const restored = snapshot.profiles?.length ? snapshot.profiles : [profileFromSnapshot(snapshot)];
    const active = snapshot.activeProfileId && restored.some(p => p.id === snapshot.activeProfileId) ? snapshot.activeProfileId : restored[0].id;
    const profile = restored.find(p => p.id === active) ?? restored[0];
    setProfiles(restored); setActiveProfileId(active);
    setCourses(profile.courses); setImportedFileName(profile.importedFileName); setSemesterStartDate(profile.semesterStartDate);
    setAutoWeeks(profile.semesterWeeks); setAutoPeriods(profile.maxPeriods); setLastReport(profile.lastReport);
  }, []);

  const switchProfile = useCallback((id: string) => {
    setProfiles(current => {
      const profile = current.find(p => p.id === id);
      if (!profile) return current;
      setActiveProfileId(id); setCourses(profile.courses); setImportedFileName(profile.importedFileName); setSemesterStartDate(profile.semesterStartDate);
      setAutoWeeks(profile.semesterWeeks); setAutoPeriods(profile.maxPeriods); setLastReport(profile.lastReport);
      setWeeksOverride(null); setPeriodOverride(null);
      return current;
    });
  }, []);

  const addProfile = useCallback((name: string) => {
    const profile: TimetableProfile = { id: createProfileId(), name: name.trim() || '新课表', courses: [], semesterWeeks: DEFAULT_SEMESTER_WEEKS, maxPeriods: DEFAULT_MAX_PERIODS };
    setProfiles(current => [...current, profile]);
    setActiveProfileId(profile.id); setCourses([]); setImportedFileName(undefined); setSemesterStartDate(undefined); setAutoWeeks(DEFAULT_SEMESTER_WEEKS); setAutoPeriods(DEFAULT_MAX_PERIODS); setLastReport(undefined); setWeeksOverride(null); setPeriodOverride(null);
  }, []);

  const renameProfile = useCallback((id: string, name: string) => {
    const trimmed = name.trim(); if (!trimmed) return;
    setProfiles(current => current.map(p => p.id === id ? { ...p, name: trimmed } : p));
  }, []);

  const deleteProfile = useCallback((id: string) => {
    setProfiles(current => {
      if (current.length <= 1 || !current.some(p => p.id === id)) return current;
      const next = current.filter(p => p.id !== id);
      if (id === activeProfileId) {
        const profile = next[0]; setActiveProfileId(profile.id); setCourses(profile.courses); setImportedFileName(profile.importedFileName); setSemesterStartDate(profile.semesterStartDate); setAutoWeeks(profile.semesterWeeks); setAutoPeriods(profile.maxPeriods); setLastReport(profile.lastReport);
      }
      return next;
    });
  }, [activeProfileId]);

  const snapshot = useMemo<TimetableSnapshot>(() => ({ courses, importedFileName, semesterStartDate, semesterWeeks, maxPeriods, lastReport, profiles, activeProfileId }), [courses, importedFileName, semesterStartDate, semesterWeeks, maxPeriods, lastReport, profiles, activeProfileId]);
  const timetable = useMemo(() => coursesToTimetable(courses), [courses]);

  useEffect(() => {
    if (!isHydrated) return;
    const widgetCourses: WidgetCourseData[] = courses.map(c => ({ id: c.id, name: c.name, day: c.day, timeSlot: c.timeSlot, startPeriod: c.startPeriod, endPeriod: c.endPeriod, location: c.location, teacher: c.teacher, weekList: c.weekList, isOddEven: c.isOddEven }));
    writeWidgetData(widgetCourses, getCurrentWeek(semesterStartDate), semesterStartDate);
  }, [isHydrated, courses, semesterStartDate]);

  return { snapshot, isHydrated, setHydrated, timetable, replaceCourses, updateCourse, addCourse, deleteCourses, clearCourses, setSemesterStartDate: setSemesterStartDateForActive, setSemesterWeeks, setMaxPeriods, restoreManualBounds, dismissReport, profiles, activeProfileId, switchProfile, addProfile, renameProfile, deleteProfile, restoreSnapshot };
}
