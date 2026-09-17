import type { ScheduledCourse } from '@/types/timetable';
import type { ImportReport, TimetableSnapshot } from './types';

export interface TimetableProfile {
  id: string;
  name: string;
  courses: ScheduledCourse[];
  importedFileName?: string;
  semesterStartDate?: string;
  semesterWeeks: number;
  maxPeriods: number;
  lastReport?: ImportReport;
}

export interface TimetableCollection {
  profiles: TimetableProfile[];
  activeProfileId: string;
}

export function profileFromSnapshot(snapshot: TimetableSnapshot, id = 'default', name = '我的课表'): TimetableProfile {
  return { id, name, courses: snapshot.courses, importedFileName: snapshot.importedFileName, semesterStartDate: snapshot.semesterStartDate, semesterWeeks: snapshot.semesterWeeks, maxPeriods: snapshot.maxPeriods, lastReport: snapshot.lastReport };
}

export function normalizeCollection(raw: unknown, legacy: TimetableSnapshot): TimetableCollection {
  const input = raw as { profiles?: unknown; activeProfileId?: unknown } | null;
  const profiles = Array.isArray(input?.profiles)
    ? input.profiles.filter((p): p is TimetableProfile => {
        const v = p as Partial<TimetableProfile>;
        return typeof v.id === 'string' && typeof v.name === 'string' && Array.isArray(v.courses);
      })
    : [];
  if (!profiles.length) return { profiles: [profileFromSnapshot(legacy)], activeProfileId: 'default' };
  const activeProfileId = typeof input?.activeProfileId === 'string' && profiles.some(p => p.id === input.activeProfileId)
    ? input.activeProfileId
    : profiles[0].id;
  return { profiles, activeProfileId };
}

export function createProfileId(): string {
  return `timetable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
