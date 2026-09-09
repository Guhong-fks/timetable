// =============================================================================
// recognizer — position-first recognition entry point
// -----------------------------------------------------------------------------
// Replaces the old grid walk (detectPeriodColumn + 垂直折叠 + per-cell regex
// chain) with the validated position-first pipeline:
//
//   IR table → GridCell anchors → mergeTableSegments → buildDenseGrid
//   → detectLayout → readCourseCell per day-column anchor → ScheduledCourse[]
//
// Validated against real 正方 (中国计量大学) and 安大 exports; fixtures under
// src/__tests__/fixtures/. parseWeekPattern / sanitize / storage migration
// are reused unchanged — only the recognition layer was rebuilt.
// =============================================================================
import { WeekDay, TimeSlot, type ScheduledCourse } from '@/types/timetable';
import { ParseReport } from '@/lib/reporting/ParseReport';
import { slot, parseWeekPattern, sanitizeInput, type CourseWarning } from '@/lib/importers/parsers';
import {
  buildDenseGrid,
  mergeTableSegments,
  detectLayout,
  type GridCell,
} from '@/lib/engine/tableGrid';
import { readCourseCells, type CourseFields } from '@/lib/engine/cellReader';

// -----------------------------------------------------------------------------
// IR adaptation
// -----------------------------------------------------------------------------

/** Narrow anydoc IR table slice (same shape as timetable-importer's aliases). */
interface IrTableCell {
  paragraphs?: { text?: string; bold?: boolean }[][];
  rowSpan?: number;
  colSpan?: number;
  background?: string;
}

export interface IrTableBlock {
  type: 'table';
  rows?: IrTableCell[][];
}

/** IR cell → GridCell anchor (text + spans).
 *
 * Handles BOTH upstream encodings:
 *   (a) anchor-only: one entry per logical cell, spans declared — pass-through.
 *   (b) dense copies: a spanned cell repeated at every position it covers
 *       (rowSpan=1 each). Consecutive same-text runs in a column are
 *       collapsed back into one anchor with the accumulated rowSpan, which
 *       is the contract the rest of the pipeline expects.
 */
export function irToGridCells(table: IrTableBlock): GridCell[] {
  const raw: GridCell[] = [];
  (table.rows ?? []).forEach((row, rowIndex) => {
    (row ?? []).forEach((cell, colIndex) => {
      const paragraphs = cell?.paragraphs ?? [];
      const lines: string[] = [];
      for (const paraRuns of paragraphs) {
        if (!Array.isArray(paraRuns)) continue;
        const line = paraRuns
          .map((run) => (typeof run?.text === 'string' ? run.text : ''))
          .join('')
          .trim();
        if (line) lines.push(line);
      }
      raw.push({
        text: lines.join('\n'),
        rowIndex,
        colIndex,
        rowSpan: Math.max(1, Number(cell?.rowSpan ?? 1)),
        colSpan: Math.max(1, Number(cell?.colSpan ?? 1)),
        isAnchor: true,
      });
    });
  });

  // ---- collapse vertical duplicate runs per column (dense → anchor) ----
  const byCol = new Map<number, GridCell[]>();
  for (const c of raw) {
    if (!byCol.has(c.colIndex)) byCol.set(c.colIndex, []);
    byCol.get(c.colIndex)!.push(c);
  }
  const out: GridCell[] = [];
  for (const colCells of byCol.values()) {
    colCells.sort((a, b) => a.rowIndex - b.rowIndex);
    let open: GridCell | null = null;
    for (const c of colCells) {
      const cur: GridCell = { ...c, rowSpan: Math.max(1, c.rowSpan ?? 1) };
      // Dense-copy fallback: a copy overlaps or abuts its origin anchor with
      // identical text. Absorb conservatively (extend to the copy's row).
      if (
        open !== null &&
        cur.text === open.text &&
        open.text !== '' &&
        cur.rowIndex <= open.rowIndex + (open.rowSpan ?? 1)
      ) {
        open.rowSpan = Math.max(open.rowSpan ?? 1, cur.rowIndex + 1 - open.rowIndex);
        continue;
      }
      open = cur;
      out.push(cur);
    }
  }
  out.sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex);
  return out;
}

// -----------------------------------------------------------------------------
// Recognition
// -----------------------------------------------------------------------------

/** Default semester length when a course carries no week info at all. */
const DEFAULT_TOTAL_WEEKS = 18;

/**
 * Recognize courses from one or more IR tables. Layout warnings go straight
 * into `report`; field-level warnings are attached per course below.
 */
export function recognizeCourses(tables: IrTableBlock[], report: ParseReport): ScheduledCourse[] {
  const merged = mergeTableSegments(tables.map(irToGridCells));
  const courses: ScheduledCourse[] = [];

  for (const segment of merged) {
    const grid = buildDenseGrid(segment);
    if (!grid.length) continue;
    const { layout, warnings } = detectLayout(grid);
    for (const w of warnings) report.addWarning(w);

    // Scan each day column top-down. Identity checks use the PLACED
    // position, not the cell's declared colIndex: anydoc emits one entry
    // per Origin with the column implied by array order, so declared
    // indices drift left of the true columns whenever a Covered slot
    // precedes them (gridSpan headers, vMerge). Placement in the dense
    // grid restores the truth — declared colIndex does not.
    const consumed = new WeakSet<object>();
    const courseWarnings: CourseWarning[] = [];
    const dayColIdx = [...layout.dayCols.keys()].sort((a, b) => a - b);
    for (const ci of dayColIdx) {
      for (let ri = 0; ri < grid.length; ri++) {
        const cell = grid[ri][ci];
        if (!cell) continue;
        if (cell.rowIndex !== ri) continue; // read each anchor once, at its origin row
        // Read only at the anchor's leftmost PLACED column in this row
        // (colSpan coverage and collision shifts both end here).
        if (ci > 0 && grid[ri][ci - 1] === cell) continue;
        const fieldList = readCourseCells(cell, ci, { grid, layout, consumed, warnings: courseWarnings });
        for (const fields of fieldList) {
          const course = toScheduledCourse(fields, layout.dayCols.get(ci)!);
          if (course) courses.push(course);
        }
      }
    }

    for (const w of courseWarnings) report.addWarning(w);
  }

  if (courses.length === 0) {
    report.addWarningFromParts('system', 'info', '未识别到课程：文件中没有可识别的课表网格');
  }
  return courses;
}

// -----------------------------------------------------------------------------
// CourseFields → ScheduledCourse
// -----------------------------------------------------------------------------

/** Nearest slot anchor at-or-before `start` — display anchor for non-standard
 * spans ('2-3节' → THREE_FOUR carries no meaning; renderer uses startPeriod).
 * Exported for the ICS importer, which builds ScheduledCourse directly and
 * needs the same non-standard-span anchor semantics. */
export function fallbackSlot(start: number): TimeSlot {
  if (start <= 1) return TimeSlot.ONE_TWO;
  if (start <= 3) return TimeSlot.THREE_FOUR;
  if (start <= 5) return TimeSlot.FIVE_SIX;
  if (start <= 7) return TimeSlot.SEVEN_EIGHT;
  if (start === 8) return TimeSlot.EIGHT;
  if (start === 9) return TimeSlot.NINE;
  if (start === 10) return TimeSlot.TEN;
  if (start === 11) return TimeSlot.ELEVEN;
  if (start === 12) return TimeSlot.TWELVE;
  return TimeSlot.THIRTEEN;
}

function fullSemester(total: number = DEFAULT_TOTAL_WEEKS): number[] {
  return Array.from({ length: total }, (_, i) => i + 1);
}

/** 周次 spec → concrete weekList via the existing parseWeekPattern. */
function resolveWeeks(fields: CourseFields): number[] {
  if (!fields.weeksSpec) return fullSemester();
  const result = parseWeekPattern(fields.weeksSpec);
  return result.weekList.length ? result.weekList : fullSemester();
}

export function toScheduledCourse(fields: CourseFields, day: WeekDay): ScheduledCourse | null {
  // Final clamp: the renderer builds a CLASS_PERIODS grid and keys period
  // times by 1..13 — out-of-range periods would crash the UI downstream.
  if (fields.startPeriod < 1 || fields.endPeriod > 13 || fields.endPeriod < fields.startPeriod) {
    return null;
  }
  const timeSlot = slot(fields.startPeriod, fields.endPeriod) ?? fallbackSlot(fields.startPeriod);
  return {
    id: `${day}-${fields.startPeriod}-${fields.endPeriod}-${fields.name}`,
    name: sanitizeInput(fields.name) || '未命名课程',
    day,
    timeSlot,
    // Authoritative positioning fields (renderer uses these, index.tsx:160).
    startPeriod: Math.max(1, fields.startPeriod),
    endPeriod: Math.min(99, fields.endPeriod),
    duration: fields.endPeriod - fields.startPeriod + 1,
    location: { address: sanitizeInput(fields.location) },
    teacher: { name: sanitizeInput(fields.teacher ?? '') },
    weekList: resolveWeeks(fields),
    // Odd/even resolution: parseWeekPattern keeps the marker semantics for
    // explicit 单周/双周 specs; position-derived specs have none.
    isOddEven: null,
  };
}
