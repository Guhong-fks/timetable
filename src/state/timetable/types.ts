import type { ScheduledCourse } from '@/types/timetable';
import type { ReportWarning } from '@/lib/reporting/types';
import type { TimetableProfile } from './profiles';

/**
 * Snapshot of an import's parse report. Lives next to the imported
 * courses so the UI can keep showing a "查看解析详情" banner until the
 * user dismisses it or imports a new file.
 */
export interface ImportReport {
  warnings: ReportWarning[];
  suggestions: string[];
}

/**
 * The full persisted shape. Mirrors the on-disk JSON:
 *   { version: 4, courses: [...], importedFileName?, semesterStartDate?,
 *     semesterWeeks, maxPeriods, lastReport? }
 *
 * `lastReport` only appears on payloads written after this field was
 * introduced — legacy payloads (v1/v2/v3) always parse with it as
 * `undefined`.
 */
export interface TimetableSnapshot {
  courses: ScheduledCourse[];
  importedFileName?: string;
  semesterStartDate?: string;
  semesterWeeks: number;
  maxPeriods: number;
  lastReport?: ImportReport;
  profiles?: TimetableProfile[];
  activeProfileId?: string;
}

export const CURRENT_VERSION = 5 as const;

/**
 * Canonical storage key for v5 payloads. Bumping to v6 only requires
 * changing this constant and adding an entry to LEGACY_KEYS.
 */
export const STORAGE_KEY = 'course-table-app.timetable.v5';

/**
 * Legacy storage keys, newest → oldest. The migration reads each in
 * order and adopts the first one whose payload parses successfully.
 * The unversioned key was used before versioning was introduced.
 */
export const LEGACY_KEYS = [
  'course-table-app.timetable.v4',
  'course-table-app.timetable.v3',
  'course-table-app.timetable.v2',
  'course-table-app',
] as const;