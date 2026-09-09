// =============================================================================
// tableGrid — dense-grid reconstruction + layout role detection
// -----------------------------------------------------------------------------
// Position-first recognition, step 1 (validated against real 正方/安大 docx
// exports; see src/__tests__/fixtures/*.json):
//
//   1. buildDenseGrid: expand anchor cells (rowIndex/colIndex/rowSpan/colSpan)
//      into a full logical matrix. Self-heals two upstream representations:
//        (a) anydoc emitting a dense logical grid — zero collisions;
//        (b) anydoc emitting a physical <w:tc> stream where vMerge-continue
//            columns are shadowed — declared colIndex undercounts after a
//            merged column, so placement shifts right to the first free slot.
//   2. detectLayout: find the header row (within the first 3 rows), map each
//      day header to its ACTUAL column index (tolerates 备注列 between the
//      period column and the day columns), and locate the period column.
//   3. mergeTableSegments: append header-less continuation tables (cross-page
//      splits in 正方 exports) into the previous table, row-offset.
// =============================================================================

import { WeekDay } from '@/types/timetable';
import { MIN_PERIOD, MAX_PERIOD, type CourseWarning } from '@/lib/importers/parsers';

/** A single anchor cell of a table grid (one entry per physical cell). */
export interface GridCell {
  text: string;
  rowIndex: number;
  colIndex: number;
  rowSpan?: number;
  colSpan?: number;
  isAnchor?: boolean;
}

/** Longest-first so '星期一' wins over a hypothetical '周' prefix collision. */
const DAY_ALTS: readonly (readonly [string, WeekDay])[] = [
  ['星期一', WeekDay.MONDAY], ['周一', WeekDay.MONDAY], ['Monday', WeekDay.MONDAY], ['Mon', WeekDay.MONDAY],
  ['星期二', WeekDay.TUESDAY], ['周二', WeekDay.TUESDAY], ['Tuesday', WeekDay.TUESDAY], ['Tue', WeekDay.TUESDAY],
  ['星期三', WeekDay.WEDNESDAY], ['周三', WeekDay.WEDNESDAY], ['Wednesday', WeekDay.WEDNESDAY], ['Wed', WeekDay.WEDNESDAY],
  ['星期四', WeekDay.THURSDAY], ['周四', WeekDay.THURSDAY], ['Thursday', WeekDay.THURSDAY], ['Thu', WeekDay.THURSDAY],
  ['星期五', WeekDay.FRIDAY], ['周五', WeekDay.FRIDAY], ['Friday', WeekDay.FRIDAY], ['Fri', WeekDay.FRIDAY],
  ['星期六', WeekDay.SATURDAY], ['周六', WeekDay.SATURDAY], ['Saturday', WeekDay.SATURDAY], ['Sat', WeekDay.SATURDAY],
  ['星期日', WeekDay.SUNDAY], ['星期天', WeekDay.SUNDAY], ['周日', WeekDay.SUNDAY], ['Sunday', WeekDay.SUNDAY], ['Sun', WeekDay.SUNDAY],
];

const DAY_NAMES = new Set<string>([
  '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日', '星期天',
  '周一', '周二', '周三', '周四', '周五', '周六', '周日',
  '时间段', '节次',
]);

export function isDayHeaderText(text: string): boolean {
  const t = text.trim();
  return DAY_NAMES.has(t);
}

/** '3'..'13' style lone period digits (a period-column cell). */
export function isPeriodDigitText(text: string): boolean {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return false;
  const n = Number(t);
  return n >= MIN_PERIOD && n <= MAX_PERIOD;
}

/** Match a day keyword anywhere in the text; returns its WeekDay. */
function matchDayKeyword(text: string): WeekDay | null {
  for (const [kw, day] of DAY_ALTS) {
    if (text.includes(kw)) return day;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Dense grid
// -----------------------------------------------------------------------------

/**
 * Expand anchor cells into a dense logical matrix. Every logical position
 * points at its owning anchor; empty gaps become null.
 *
 * Placement is aware-aware (mirrors anydoc's GridBuilder): cells arrive
 * top-down, left-to-right WITHIN each physical row, and the declared
 * colIndex is just that array order — Covered (vMerge-continue) slots are
 * omitted from the stream, so the declared index drifts left of the true
 * column whenever spans precede it. Placement therefore walks each row with
 * a cursor that jumps over columns already claimed by earlier rows'
 * rowSpans (the Covered slots anydoc skipped), then trusts the cursor.
 */
export function buildDenseGrid(cells: GridCell[]): (GridCell | null)[][] {
  const spans = cells.map((c) => ({
    cell: c,
    rowSpan: Math.max(1, Math.floor(c.rowSpan ?? 1)),
    colSpan: Math.max(1, Math.floor(c.colSpan ?? 1)),
  }));
  let maxRow = 0;
  let maxCol = 0;
  for (const s of spans) {
    maxRow = Math.max(maxRow, s.cell.rowIndex + s.rowSpan);
    maxCol = Math.max(maxCol, s.cell.colIndex + s.colSpan);
  }
  if (maxRow === 0 || maxCol === 0) return [];
  const grid: (GridCell | null)[][] = Array.from({ length: maxRow }, () =>
    Array<(GridCell | null)>(maxCol).fill(null),
  );

  const fits = (row: number, col: number, rs: number, cs: number): boolean => {
    for (let r = row; r < Math.min(row + rs, maxRow); r++) {
      for (let c = col; c < col + cs; c++) {
        if (grid[r][c] !== null) return false;
      }
    }
    return true;
  };

  const sorted = [...spans].sort(
    (a, b) => a.cell.rowIndex - b.cell.rowIndex || a.cell.colIndex - b.cell.colIndex,
  );
  let currentRow = -1;
  let cursor = 0;
  for (const { cell, rowSpan, colSpan } of sorted) {
    const row = Math.min(cell.rowIndex, maxRow - 1);
    if (row !== currentRow) {
      currentRow = row;
      cursor = 0;
    }
    // Start from the declared column, then slide right past anything taken.
    let col = Math.max(cursor, Math.min(cell.colIndex, maxCol - 1));
    while (col < maxCol && !fits(row, col, rowSpan, colSpan)) col++;
    if (col >= maxCol) continue;
    for (let r = row; r < Math.min(row + rowSpan, maxRow); r++) {
      for (let c = col; c < Math.min(col + colSpan, maxCol); c++) {
        grid[r][c] = cell;
      }
    }
    cursor = col + colSpan;
  }
  return grid;
}

// -----------------------------------------------------------------------------
// Layout detection
// -----------------------------------------------------------------------------

export interface TableLayout {
  /** dayIdx (0=Monday..6=Sunday) keyed by the ACTUAL column index. */
  dayCols: Map<number, WeekDay>;
  /** Period-number column, or null when undetectable. */
  periodCol: number | null;
  /** Row index carrying the day headers, or null when there is none. */
  headerRow: number | null;
}

const MIN_HEADER_ROW = 3;

/**
 * Detect which columns are days and which column carries period numbers.
 * Emits a 'header' warning when only fallback inference is possible.
 */
export function detectLayout(grid: (GridCell | null)[][]): { layout: TableLayout; warnings: CourseWarning[] } {
  const warnings: CourseWarning[] = [];
  const nrows = grid.length;
  const ncols = nrows ? grid[0].length : 0;

  // ---- header row: first row (within the first 3) with ≥3 day keywords ----
  let headerRow: number | null = null;
  for (let ri = 0; ri < Math.min(MIN_HEADER_ROW, nrows); ri++) {
    const hits = grid[ri].filter((a) => a !== null && matchDayKeyword(a.text) !== null).length;
    if (hits >= 3) {
      headerRow = ri;
      break;
    }
  }

  const dayCols = new Map<number, WeekDay>();
  let periodCol: number | null = null;

  if (headerRow !== null) {
    const seen = new Set<WeekDay>();
    for (let ci = 0; ci < ncols; ci++) {
      const a = grid[headerRow][ci];
      if (!a) continue;
      const day = matchDayKeyword(a.text);
      if (day !== null && !seen.has(day)) {
        seen.add(day);
        dayCols.set(ci, day);
      }
    }
    if (dayCols.size > 0) {
      periodCol = guessPeriodCol(grid, headerRow, Math.min(...dayCols.keys()));
      if (periodCol === null) {
        warnings.push({
          category: 'header',
          severity: 'info',
          message: '未识别到节次列，节次将从课程文本或行位置推断',
        });
      }
    }
  }

  if (dayCols.size === 0) {
    // No usable header: infer the period column by digit frequency and take
    // the columns to its right as Monday..Sunday.
    let bestCol = -1;
    let bestCount = 0;
    for (let ci = 0; ci < ncols; ci++) {
      let n = 0;
      for (let ri = 0; ri < nrows; ri++) {
        const a = grid[ri][ci];
        if (a && isPeriodDigitText(a.text)) n++;
      }
      if (n > bestCount) {
        bestCount = n;
        bestCol = ci;
      }
    }
    if (bestCol >= 0 && bestCount >= 3) {
      periodCol = bestCol;
      let idx = 0;
      for (let ci = bestCol + 1; ci < ncols && idx < 7; ci++, idx++) {
        dayCols.set(ci, DAY_ORDER[idx]);
      }
      warnings.push({
        category: 'header',
        severity: 'warning',
        message: '未找到星期表头，已按节次列右侧各列依次推断为周一至周日，建议手动核对',
      });
    } else {
      warnings.push({
        category: 'header',
        severity: 'error',
        message: '无法识别课表布局（未找到星期表头或节次列）',
      });
    }
  }

  return { layout: { dayCols, periodCol, headerRow }, warnings };
}

const DAY_ORDER: WeekDay[] = [
  WeekDay.MONDAY, WeekDay.TUESDAY, WeekDay.WEDNESDAY, WeekDay.THURSDAY,
  WeekDay.FRIDAY, WeekDay.SATURDAY, WeekDay.SUNDAY,
];

/** Column left of the first day column that holds period digits. */
function guessPeriodCol(grid: (GridCell | null)[][], headerRow: number, firstDayCol: number): number | null {
  for (let ci = firstDayCol - 1; ci >= 0; ci--) {
    let n = 0;
    for (let ri = headerRow + 1; ri < grid.length; ri++) {
      const a = grid[ri][ci];
      if (a && isPeriodDigitText(a.text)) n++;
    }
    if (n >= 3) return ci;
  }
  // The header may itself label the period column (节次 / Period).
  for (let ci = firstDayCol - 1; ci >= 0; ci--) {
    const a = grid[headerRow][ci];
    if (a && /节次|Period|period|节数/.test(a.text)) return ci;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Table merging (cross-page continuation)
// -----------------------------------------------------------------------------

/** True when the grid's first row carries ≥3 day headers. */
function hasDayHeader(grid: (GridCell | null)[][]): boolean {
  if (!grid.length) return false;
  return grid[0].filter((a) => a !== null && matchDayKeyword(a.text) !== null).length >= 3;
}

/**
 * Append header-less continuation tables into the previous table with a row
 * offset (正方 exports split one timetable across pages like this). Tables
 * WITH a header start a new segment and are recognized independently.
 * Mutates (and returns) the merged anchor lists.
 */
export function mergeTableSegments(segments: GridCell[][]): GridCell[][] {
  const merged: GridCell[][] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(seg);
      continue;
    }
    const grid = buildDenseGrid(seg);
    const prevGrid = buildDenseGrid(prev);
    const sameWidth = (prevGrid[0]?.length ?? 0) === (grid[0]?.length ?? 0);
    if (hasDayHeader(grid) || !sameWidth) {
      merged.push(seg);
      continue;
    }
    const offset = prev.reduce((m, c) => Math.max(m, c.rowIndex + (c.rowSpan ?? 1)), 0) + 1;
    for (const c of seg) {
      c.rowIndex += offset;
      prev.push(c);
    }
  }
  return merged;
}
