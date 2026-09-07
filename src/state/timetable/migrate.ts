import { sanitizeCourses, DEFAULT_SEMESTER_WEEKS, DEFAULT_MAX_PERIODS } from '@/types/timetable';
import type { TimetableSnapshot } from './types';

/**
 * Canonical "nothing imported yet" snapshot. Returned by `loadSnapshot`
 * when storage is empty, when JSON is corrupt, or when no usable
 * payload exists. Field completeness is part of the contract — callers
 * never need to defend against undefined fields.
 */
export const EMPTY_SNAPSHOT: TimetableSnapshot = {
  courses: [],
  importedFileName: undefined,
  semesterStartDate: undefined,
  semesterWeeks: DEFAULT_SEMESTER_WEEKS,
  maxPeriods: DEFAULT_MAX_PERIODS,
};

/**
 * Convert an arbitrary parsed JSON payload (v1 / v2 / v3 / v4) into the
 * canonical v4 `TimetableSnapshot`. Strips removed fields, coerces
 * legacy week shapes via `sanitizeCourses`, and fills missing scalar
 * fields with the empty-snapshot defaults.
 *
 * Pure function — no React, no storage I/O. Unit-tested in
 * `migrate.test.ts`; the previous monolithic provider had no direct
 * coverage of this transform.
 */
export function migrateToV4(parsed: unknown): TimetableSnapshot {
  const raw = (parsed ?? {}) as Partial<TimetableSnapshot> & { courses?: unknown };
  return {
    courses: sanitizeCourses(raw.courses),
    importedFileName: raw.importedFileName,
    semesterStartDate: raw.semesterStartDate,
    semesterWeeks: typeof raw.semesterWeeks === 'number' ? raw.semesterWeeks : DEFAULT_SEMESTER_WEEKS,
    maxPeriods: typeof raw.maxPeriods === 'number' ? raw.maxPeriods : DEFAULT_MAX_PERIODS,
    // Legacy payloads never carry a lastReport — the banner only shows
    // for imports done after this field was added.
    lastReport: undefined,
  };
}

/**
 * Tolerant JSON.parse wrapper. Returns `null` for any failure (corrupt
 * text, non-JSON, empty string). Callers fall back to EMPTY_SNAPSHOT.
 */
export function safeParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}