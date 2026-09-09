// =============================================================================
// parseDiagnostics — device-side IR dump for recognition debugging
// -----------------------------------------------------------------------------
// On-device IR can differ from any desktop-side reconstruction (it did: the
// Origin-only emission and column drift were both invisible until a device
// run). This module serializes EVERYTHING the recognizer saw — raw IR
// tables, the dense grid placement, the detected layout, and the final
// course list — into a JSON string the user can share from the import
// screen (dev builds only). With this artifact, a recognition bug report
// reproduces exactly, no back-and-forth.
// =============================================================================
import type { ScheduledCourse } from '@/types/timetable';
import { irToGridCells } from '@/lib/engine/recognizer';
import { buildDenseGrid, detectLayout, type TableLayout } from '@/lib/engine/tableGrid';
import type { IrTableBlock } from '@/lib/engine/recognizer';

export interface ParseDiagnostics {
  capturedAt: string;
  appVersion: string;
  tables: {
    index: number;
    /** Raw rows exactly as anydoc emitted them (Origin-only, column = array index). */
    irRowCounts: number[];
    /** First N cells of the raw IR, text-truncated, for the report. */
    irSample: string[][];
    /** Dense grid: placed anchors as (row, col, rowSpan, text). */
    gridCells: { r: number; c: number; rs: number; cs: number; text: string }[];
    /** Detected layout roles. */
    layout: {
      headerRow: number | null;
      periodCol: number | null;
      dayCols: { col: number; day: string }[];
    };
    /** Recognized courses from this table (position + fields). */
    courses: {
      name: string;
      day: string;
      start: number;
      end: number;
      weeks: string | null;
      teacher: string | null;
      location: string;
    }[];
  }[];
}

/** Collect full diagnostics for the tables the recognizer just consumed. */
export function collectParseDiagnostics(
  tables: IrTableBlock[],
  courses: ScheduledCourse[],
  appVersion: string,
): ParseDiagnostics {
  const perTable: ParseDiagnostics['tables'] = [];
  const dayName = (d: string | undefined) => d ?? '?';

  // Recognized courses bucketed per day for per-table attribution is
  // approximate (multi-table docs share one course list); we attach ALL
  // courses to the LAST table that has a layout — good enough for the
  // common single-timetable document.
  let lastLayout: TableLayout | null = null;

  for (const table of tables) {
    const anchors = irToGridCells(table);
    const { layout } = detectLayout(buildDenseGrid(anchors));
    lastLayout = layout;
    perTable.push({
      index: perTable.length,
      irRowCounts: (table.rows ?? []).map((row) => (row ?? []).length),
      irSample: (table.rows ?? []).slice(0, 20).map((row) =>
        (row ?? []).map((cell) => {
          const text = (cell?.paragraphs ?? [])
            .map((paraRuns) => (Array.isArray(paraRuns) ? paraRuns : []))
            .flat()
            .map((run) => (typeof run?.text === 'string' ? run.text : ''))
            .join('')
            .slice(0, 40);
          return text;
        }),
      ),
      gridCells: anchors.map((a) => ({
        r: a.rowIndex,
        c: a.colIndex,
        rs: a.rowSpan ?? 1,
        cs: a.colSpan ?? 1,
        text: a.text.slice(0, 80),
      })),
      layout: {
        headerRow: layout.headerRow,
        periodCol: layout.periodCol,
        dayCols: [...layout.dayCols.entries()].map(([col, day]) => ({ col, day: dayName(day) })),
      },
      courses: [],
    });
  }

  // Attach courses to the last table with a usable layout.
  const target = perTable.length ? perTable[perTable.length - 1] : null;
  if (target && lastLayout) {
    target.courses = courses.map((c) => ({
      name: c.name,
      day: String(c.day),
      start: c.startPeriod,
      end: c.endPeriod,
      weeks: c.weekList.length ? `${c.weekList[0]}-${c.weekList[c.weekList.length - 1]}` : null,
      teacher: c.teacher?.name || null,
      location: c.location?.address || '',
    }));
  }
  return {
    capturedAt: new Date().toISOString(),
    appVersion,
    tables: perTable,
  };
}

/** Compact JSON for sharing (clipboard / share sheet). */
export function serializeDiagnostics(d: ParseDiagnostics): string {
  return JSON.stringify(d, null, 1);
}
