/**
 * Public warning descriptor surfaced to the UI.
 *
 * Mirrors the shape that {@link import('./parsers').CourseWarning} already
 * emits from the parser pipeline — the report reuses the existing
 * categories / severities so consumers can filter uniformly.
 *
 * `row`/`rawText` are optional because some warnings come from the
 * importer shell (header detection, fallback path) and have no source row.
 */
export type ReportSeverity = 'info' | 'warning' | 'error';

export type ReportCategory =
  | 'header'    // table header / period column detection
  | 'period'    // period number parsing (out of range, non-integer)
  | 'cell'      // RawCourseBlock extraction (no course code, malformed schedule)
  | 'week'      // week-pattern parsing (out of range, unrecognised token)
  | 'teacher'   // teacher name did not match any teacher regex
  | 'address'   // address parsing fell through to "preserve verbatim"
  | 'system';   // importer shell: corrupt file, fallback, complexity guard

export interface ReportWarning {
  category: ReportCategory;
  severity: ReportSeverity;
  message: string;
  /** Optional anchor back to a course or grid location. */
  ref?: {
    courseId?: string;
    rowIndex?: number;
    colIndex?: number;
    day?: string;
  };
  /** The unparsed source line, when relevant. */
  rawText?: string;
  /** Wall-clock timestamp (ms since epoch) when the warning was added. */
  at: number;
}