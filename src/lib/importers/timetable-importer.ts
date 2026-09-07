// =============================================================================
// Document conversion engine
// -----------------------------------------------------------------------------
// `react-native-anydoc` depends on `react-native-nitro-modules`, which in turn
// loads a TurboModule synchronously at module-eval time. Expo Go does not
// include the Nitro native binary, so a static `import` at the top of this
// file would crash the whole importer at app boot — taking the import tab
// down with it.
//
// We work around this by:
//   1. Loading the engine lazily (dynamic `import()` inside `parseDocxFile`)
//   2. Catching the Nitro `ModuleNotFoundError` and translating it into a
//      user-friendly Chinese message that points at Dev Client / EAS Build.
// =============================================================================

// Type-only import is safe: it produces no runtime reference, so Nitro is
// not loaded at boot. The value itself is fetched via `await import(...)`.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type AnydocModule = typeof import('react-native-anydoc');

/**
 * Synchronous capability probe used by callers that want to gate the
 * "选择文件" button on whether the parser engine is reachable. Returns
 * false on Expo Go (no Nitro binary), true on a Dev Client / EAS Build.
 *
 * Implementation: react-native-anydoc's first transitive import pulls in
 * `react-native-nitro-modules/turbomodule/NativeNitroModules`, which calls
 * `TurboModuleRegistry.getEnforcing('NitroModules')`. If we just *touch*
 * the module from JS, that call fires synchronously and either returns a
 * proxy or throws `ModuleNotFoundError`. We use a side-channel that does
 * not crash on the missing case.
 */
export function isNativeBridgeAvailable(): boolean {
  try {
    // Dynamic require (via the CommonJS interop) triggers module
    // evaluation. This is the same path Expo Go fails on; we catch the
    // throw and report `false` so the UI can downgrade gracefully.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-nitro-modules');
    return true;
  } catch {
    return false;
  }
}

async function loadAnydoc(): Promise<AnydocModule> {
  // Dynamic import — nitro module is only evaluated when the user picks a
  // file. On Expo Go this throws a ModuleNotFoundError which we re-raise
  // with a friendlier message.
  return await import('react-native-anydoc');
}

import {
  ScheduledCourse,
  TimetableData,
  WeekDay,
  coursesToTimetable,
} from '@/types/timetable';
import { ParseReport } from '@/lib/reporting/ParseReport';
import type { ReportWarning } from '@/lib/reporting/types';

// =============================================================================
// DocumentIR type aliases
// -----------------------------------------------------------------------------
// react-native-anydoc exposes `ir: unknown`; the structural shape is documented
// (pages -> blocks -> table block with rows: TableCell[][]). We declare the
// narrow slice we actually walk; the rest stays `unknown` so a runtime
// mismatch surfaces loudly instead of silently passing through.
// =============================================================================

interface IrRun {
  text?: string;
  bold?: boolean;
  italic?: boolean;
}

interface IrTableCell {
  paragraphs?: IrRun[][];
  rowSpan?: number;
  colSpan?: number;
  background?: string;
}

type IrTableRow = IrTableCell[];

interface IrTableBlock {
  type: 'table';
  columnWidths?: number[];
  rows?: IrTableRow[];
}

interface IrBlock {
  type: string;
  // Discriminated union: only `table` carries rows. Everything else is opaque.
  rows?: IrTableRow[];
  columnWidths?: number[];
}

interface IrPage {
  pageIndex?: number;
  name?: string;
  blocks?: IrBlock[];
}

interface DocumentIR {
  version?: number;
  sourceType?: string;
  pages?: IrPage[];
}

import {
  validateFile,
  validateBufferSize,
} from '../security';
import {
  MIN_PERIOD,
  MAX_PERIOD,
  type CourseWarning,
} from './parsers';
import {
  extractBlocksFromCell,
  normaliseBlock,
} from './blocks';
import { createParserChain } from '@/lib/parsers/ParserChain';
import {
  selectBestTable,
  type ScorableTable,
} from '@/lib/utils/tableScorer';

// =============================================================================
// Public types
// =============================================================================

export interface ImportResult {
  courses: ScheduledCourse[];
  timetable: TimetableData;
  /**
   * Structured parse report — single source of truth for warnings.
   * Lives next to the imported courses so the UI can show a
   * "查看解析详情" entry alongside the timetable.
   */
  report: { warnings: ReportWarning[]; suggestions: string[] };
}

// =============================================================================
// Result-level complexity guard
// -----------------------------------------------------------------------------
// react-native-anydoc runs in Rust off the JS thread; per-cell timeout/limit
// checks during parsing no longer apply. We enforce limits at two boundaries
// instead:
//
//   1. Pre-parse: file size & extension (validateFile + validateBufferSize)
//   2. Post-parse: count cells across every table in the IR; if the doc is
//      pathologically wide/deep, reject with a localised message.
//
// Threshold chosen to cover real course tables (7 days × ~12 periods × 1
// course = ~84 cells per table; even a 20-page archive stays well under).
// =============================================================================

const MAX_TOTAL_CELLS = 5000;

function countIrCells(ir: DocumentIR): number {
  let total = 0;
  for (const page of ir.pages ?? []) {
    for (const block of page.blocks ?? []) {
      if (block.type !== 'table') continue;
      for (const row of block.rows ?? []) {
        for (const _cell of row ?? []) total++;
      }
    }
  }
  return total;
}

function validateIrComplexity(ir: DocumentIR): { valid: boolean; error?: string } {
  const total = countIrCells(ir);
  if (total > MAX_TOTAL_CELLS) {
    return {
      valid: false,
      error: `文件过于复杂，请简化课表（检测到 ${total} 个单元格，上限 ${MAX_TOTAL_CELLS}）`,
    };
  }
  return { valid: true };
}

// =============================================================================
// Grid model (in-memory)
// -----------------------------------------------------------------------------
// Kept identical to the pre-refactor shape so the renderer (`app/(tabs)/
// index.tsx`) and downstream parsers don't notice the engine swap. Each
// physical cell becomes ONE GridCell with row/col/span metadata; logical
// duplicates from rowspan/colspan are absent here, the renderer filters by
// `isAnchor`.
// =============================================================================

interface GridCell {
  text: string;
  rowIndex: number;
  colIndex: number;
  rowSpan: number;
  colSpan: number;
  isAnchor: boolean;
}

const DAYS: WeekDay[] = [
  WeekDay.MONDAY,
  WeekDay.TUESDAY,
  WeekDay.WEDNESDAY,
  WeekDay.THURSDAY,
  WeekDay.FRIDAY,
  WeekDay.SATURDAY,
  WeekDay.SUNDAY,
];

const DAY_HEADER_KEYWORDS: readonly { day: WeekDay; keywords: string[] }[] = [
  { day: WeekDay.MONDAY, keywords: ['周一', '星期一', 'Monday', 'Mon', 'MON'] },
  { day: WeekDay.TUESDAY, keywords: ['周二', '星期二', 'Tuesday', 'Tue', 'TUE'] },
  { day: WeekDay.WEDNESDAY, keywords: ['周三', '星期三', 'Wednesday', 'Wed', 'WED'] },
  { day: WeekDay.THURSDAY, keywords: ['周四', '星期四', 'Thursday', 'Thu', 'THU'] },
  { day: WeekDay.FRIDAY, keywords: ['周五', '星期五', 'Friday', 'Fri', 'FRI'] },
  { day: WeekDay.SATURDAY, keywords: ['周六', '星期六', 'Saturday', 'Sat', 'SAT'] },
  { day: WeekDay.SUNDAY, keywords: ['周日', '星期日', 'Sunday', 'Sun', 'SUN'] },
];

// =============================================================================
// IR → plain text
// -----------------------------------------------------------------------------
// The IR runs nest as Run[][], and anydoc can attach formatting/asset
// fragments. We strip to text only — the existing regex-driven parser does
// the rest.
// =============================================================================

function extractTextFromCell(cell: IrTableCell): string {
  const paragraphs = cell.paragraphs ?? [];
  const lines: string[] = [];
  for (const paraRuns of paragraphs) {
    if (!Array.isArray(paraRuns)) continue;
    const text = paraRuns
      .map((run) => (typeof run?.text === 'string' ? run.text : ''))
      .join('')
      .trim();
    if (text) lines.push(text);
  }
  return lines.length ? lines.join('\n') : '';
}

// =============================================================================
// IR table → GridCell[]
// -----------------------------------------------------------------------------
// anydoc returns ONE entry per PHYSICAL cell (anchor only), already with
// correct rowspan/colspan. No `occupied[][]` bookkeeping needed — the Rust
// engine resolves the layout upstream.
// =============================================================================

function mapIrTableToGrid(table: IrTableBlock): GridCell[] {
  const cells: GridCell[] = [];
  const rows: IrTableRow[] = table.rows ?? [];
  rows.forEach((row, rowIndex) => {
    const rowCells: IrTableCell[] = row ?? [];
    rowCells.forEach((cell, colIndex) => {
      cells.push({
        text: extractTextFromCell(cell),
        rowIndex,
        colIndex,
        rowSpan: Math.max(1, Number(cell.rowSpan ?? 1)),
        colSpan: Math.max(1, Number(cell.colSpan ?? 1)),
        isAnchor: true,
      });
    });
  });
  return cells;
}

// =============================================================================
// First table block in the IR
// -----------------------------------------------------------------------------
// If the document has multiple tables, pick the one that looks most like a
// course schedule via a keyword + structure heuristic. Falls back to the
// first table when nothing scores high enough — the warning is surfaced
// in the import report so the UI can route the user to a manual picker.
// =============================================================================

/**
 * Adapt an IR table block into the structurally-typed shape
 * `ScorableTable` requires. We materialise each cell's plain text once so
 * the scorer doesn't have to know about paragraphs/runs.
 */
function adaptToScorable(table: IrTableBlock): ScorableTable {
  const rows: { text: string }[][] = [];
  for (const row of table.rows ?? []) {
    const cells: { text: string }[] = [];
    for (const cell of row ?? []) {
      cells.push({ text: extractTextFromCell(cell) });
    }
    rows.push(cells);
  }
  return { rows };
}

function selectBestTableBlock(tables: IrTableBlock[]): {
  selected: IrTableBlock;
  warnings: CourseWarning[];
} {
  const warnings: CourseWarning[] = [];

  if (tables.length === 0) {
    // Caller should have guarded; defensive throw rather than crashing.
    throw new Error('Word 文件没有找到课表。');
  }

  // Adapt IR shapes into the structural `ScorableTable` the pure scorer
    // expects. The IR's richer paragraph/run metadata is discarded here —
    // the scorer only cares about flattened cell text.
    const scorable = tables.map(adaptToScorable);
    const pick = selectBestTable(scorable, 5);
    // Guarded above (tables.length === 0 throws), so `pick.selected` is non-null.
    const bestScorable = pick.selected!;

    // Map the scorable index back to the original IrTableBlock. Indices
    // align 1:1 because `adaptToScorable` is a pure shape transform.
    const bestIndex = scorable.indexOf(bestScorable);
    const selected = tables[bestIndex];

    if (pick.lowConfidence) {
      // Nothing confidently looked like a timetable — surface a warning so
      // the UI can offer a manual picker.
      warnings.push({
        category: 'header',
        severity: 'info',
        message: '未明确识别课表，默认取最匹配的表格，建议手动确认',
      });
    }
    // Silence "score is computed but unused" — kept for future telemetry.
    void pick.score;

    return { selected, warnings };
  }

function findFirstTableBlock(
  ir: DocumentIR,
): { table: IrTableBlock; warnings: CourseWarning[] } {
  const tables: IrTableBlock[] = [];
  for (const page of ir.pages ?? []) {
    for (const block of page.blocks ?? []) {
      if (block.type !== 'table') continue;
      tables.push(block as IrTableBlock);
    }
  }

  if (tables.length === 0) {
    throw new Error('Word 文件没有找到课表。');
  }

  const { selected, warnings } = selectBestTableBlock(tables);

  if (tables.length > 1) {
    warnings.push({
      category: 'header',
      severity: 'info',
      message: `检测到 ${tables.length} 张表格，已选择最匹配的课表`,
    });
  }
  return { table: selected, warnings };
}

// =============================================================================
// detectPeriodColumn — three-stage heuristic (unchanged behaviour)
// -----------------------------------------------------------------------------
//   (A) Header-row hint: 节次 / Period / Class → look at the column to its
//       right in row 0/1.
//   (B) Frequency scan across ALL columns: pick the column whose cells are
//       most often integers in [1, MAX_PERIOD]. Ties broken by leftmost.
//   (C) Fallback: periodCol = 0 with a warning.
// =============================================================================

const PERIOD_HEADER_KEYWORDS: readonly string[] = ['节次', 'Period', 'period', 'Class', '节数'];

interface PeriodColumnDetection {
  periodCol: number;
  /** Day columns inferred from the header. Length 0 = no header hint found. */
  dayColumns: WeekDay[];
  warnings: CourseWarning[];
}

function detectPeriodColumn(cells: GridCell[]): PeriodColumnDetection {
  const warnings: CourseWarning[] = [];

  // Index cells by row for header inspection.
  const byRow = new Map<number, GridCell[]>();
  for (const c of cells) {
    if (!byRow.has(c.rowIndex)) byRow.set(c.rowIndex, []);
    byRow.get(c.rowIndex)!.push(c);
  }
  // Stable order within row.
  for (const arr of byRow.values()) arr.sort((a, b) => a.colIndex - b.colIndex);

  // -------- Stage A: header-row hint --------
  const headerRow = byRow.get(0) ?? [];
  const dayColumns: WeekDay[] = [];

  for (const cell of headerRow) {
    const text = cell.text.trim();
    const day = DAY_HEADER_KEYWORDS.find((entry) =>
      entry.keywords.some((kw) => text === kw || text.includes(kw)),
    );
    if (day) {
      const idx = dayColumns.length;
      dayColumns.push(day.day);
      // Sanity: we expect 0..6 days in order. Emit a warning if duplicates
      // or out-of-order days appear.
      if (idx !== DAYS.indexOf(day.day)) {
        warnings.push({
          category: 'header',
          severity: 'info',
          message: `表头星期顺序异常: 期望 ${DAYS[idx]} 但识别到 ${day.day}`,
          ref: { rowIndex: cell.rowIndex, colIndex: cell.colIndex },
        });
      }
    }
  }

  // Try to find a "节次 / Period" header cell to pin down periodCol.
  let periodCol = -1;
  for (const cell of headerRow) {
    if (PERIOD_HEADER_KEYWORDS.some((kw) => cell.text.trim() === kw)) {
      periodCol = cell.colIndex;
      break;
    }
  }

  // -------- Stage B: frequency scan (fallback when A didn't find periodCol) --------
  if (periodCol < 0) {
    const counts = new Map<number, number>();
    for (const cell of cells) {
      if (!cell.isAnchor) continue;
      const text = cell.text.trim();
      if (!/^\d+$/.test(text)) continue;
      const n = Number(text);
      if (n < MIN_PERIOD || n > MAX_PERIOD) continue;
      counts.set(cell.colIndex, (counts.get(cell.colIndex) ?? 0) + 1);
    }
    let bestCount = 0;
    for (const [col, count] of counts) {
      if (count > bestCount) {
        periodCol = col;
        bestCount = count;
      }
    }
  }

  // -------- Stage C: hard fallback --------
  if (periodCol < 0) {
    periodCol = 0;
    warnings.push({
      category: 'header',
      severity: 'warning',
      message: '未识别到节次列，已使用默认列 0',
    });
  }

  // Day columns: prefer header-detected list. If absent, assume the 7 cols
  // immediately to the right of periodCol are Monday..Sunday.
  if (dayColumns.length === 0) {
    for (let i = 0; i < DAYS.length; i++) dayColumns.push(DAYS[i]);
  }

  return { periodCol, dayColumns, warnings };
}

// =============================================================================
// parseDocxFile — engine entry point
// -----------------------------------------------------------------------------
// Calls react-native-anydoc and forwards its result to the IR-aware pipeline.
// Replaces the previous mammoth → HTML → htmlparser2 chain. The downstream
// shape (GridCell + extractBlocksFromCell + normaliseBlock) is unchanged.
// =============================================================================

export async function parseDocxFile(buffer: ArrayBuffer): Promise<ImportResult> {
  // Single source of truth: clear the report singleton at the start of
  // every import so previous runs don't leak into the current one.
  const report = ParseReport.getInstance();
  report.clear();

  // Build the parser chain once per import — reads the user regex from
  // AsyncStorage (with timeout + web fallback) and freezes it in memory.
  // All `extractBlocksFromCell` calls below then run synchronously.
  const parserChain = await createParserChain();

  let result: Awaited<ReturnType<AnydocModule['convertDocumentToIr']>>;
    try {
      const anydoc = await loadAnydoc();
      result = await anydoc.convertDocumentToIr(buffer);
    } catch (err) {
      // Two failure modes get the same translation:
      //   (a) Nitro TurboModule is missing — Expo Go, no native binary.
      //   (b) The native module is registered but a panic happens inside it.
      // Both surface the same user-facing guidance (build a Dev Client).
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[parseDocxFile] convertDocumentToIr unavailable:', err);
      if (/NitroModules|TurboModule|Module not found|Native module/i.test(msg)) {
        throw new Error(
          '当前运行环境不支持本地解析（Expo Go 不含原生模块）。请使用 Development Build 或 EAS Build 后再试',
          { cause: err },
        );
      }
      throw new Error('本地解析模块不可用，请稍后重试', { cause: err });
    }

  if (result.status !== 'ok') {
    // Document-level failure: corrupt, encrypted, or unsupported.
    throw new Error(mapFallbackReason(result.reason));
  }

  const complexity = validateIrComplexity(result.ir as DocumentIR);
  if (!complexity.valid) {
    report.addWarningFromParts('system', 'error', complexity.error!);
    throw new Error(complexity.error);
  }

  const { table, warnings: tableWarnings } = findFirstTableBlock(result.ir as DocumentIR);
  pushTableWarnings(report, tableWarnings);

  const cells = mapIrTableToGrid(table);

  const detection = detectPeriodColumn(cells);
  pushTableWarnings(report, detection.warnings);

  const { periodCol, dayColumns } = detection;
  const courses: ScheduledCourse[] = [];

  // Group cells by row for sequential walk.
  const byRow = new Map<number, GridCell[]>();
  for (const c of cells) {
    if (!byRow.has(c.rowIndex)) byRow.set(c.rowIndex, []);
    byRow.get(c.rowIndex)!.push(c);
  }
  for (const arr of byRow.values()) arr.sort((a, b) => a.colIndex - b.colIndex);

  // Local accumulator: normaliseBlock pushes CourseWarning entries here
  // (preserving the existing per-field warning pipeline + unit tests).
  // They get drained into the singleton right before we build the result.
  const localWarnings: CourseWarning[] = [];

  for (const [rowIndex, rowCells] of byRow) {
    // Skip header row (row 0) — periodCol cell must contain a number here,
    // but the data rows also need it.
    if (rowIndex === 0) continue;

    // Validate this row's period cell.
    const periodCell = rowCells.find((c) => c.colIndex === periodCol);
    if (!periodCell) continue;
    const periodText = periodCell.text.trim();
    if (!/^\d+$/.test(periodText)) continue;
    const period = Number(periodText);
    if (period < MIN_PERIOD || period > MAX_PERIOD) continue;

    // Walk the day columns.
    for (let dayIdx = 0; dayIdx < dayColumns.length; dayIdx++) {
      const day = dayColumns[dayIdx];
      const colIndex = periodCol + 1 + dayIdx;
      const dayCell = rowCells.find((c) => c.colIndex === colIndex);
      if (!dayCell) continue;

      // Only parse anchor cells; logical duplicates are skipped here.
      if (!dayCell.isAnchor) continue;

      const blocks = extractBlocksFromCell(dayCell.text, parserChain);
      for (const block of blocks) {
        const course = normaliseBlock(block, {
          day,
          rowIndex,
          colIndex,
          warnings: localWarnings,
        });
        if (course) courses.push(course);
      }
    }
  }

  if (!courses.length) {
    throw new Error('未识别到课程，请确认文件是固定课表模板。');
  }

  // Drain the local accumulator into the singleton. Keeping two writers
  // active in the same function would invite ordering bugs; this single
  // handoff at the end guarantees the report is the only authoritative
  // collection point.
  for (const w of localWarnings) {
    report.addWarning({ ...w });
  }
  return { courses, timetable: coursesToTimetable(courses), report: report.snapshot() };
}

/**
 * Move a batch of `CourseWarning` entries (the existing parser type) into
 * the `ReportWarning` shape the singleton expects. Defined here rather
 * than inside `ParseReport` to keep the report module dependency-free.
 */
function pushTableWarnings(report: ParseReport, items: CourseWarning[]): void {
  for (const w of items) {
    report.addWarning({ ...w });
  }
}

function mapFallbackReason(reason: string | undefined): string {
  switch (reason) {
    case 'unsupported-format':
      return '不支持的文件格式，请上传 .docx 文件';
    case 'corrupt':
      return '文件已损坏，无法解析';
    case 'encrypted':
      return '文件已加密，请先解除密码保护';
    case 'too-large':
      return '文件过大，请压缩后重试';
    case 'native-module-missing':
      return '本地解析模块不可用，请稍后重试';
    default:
      return '文件解析失败，请检查文件内容';
  }
}

// =============================================================================
// XLSX (still unsupported in P0)
// =============================================================================

export function parseXlsxTimetable(buffer: ArrayBuffer): ImportResult {
  throw new Error('暂不支持 .xlsx 格式，请转换为 .docx 格式导入');
}

// =============================================================================
// parseTimetableFile — file-level entry point
// =============================================================================

type TimetableFile =
  | { name: string; size?: number; type?: string; arrayBuffer: () => Promise<ArrayBuffer> }
  | { name: string; size?: number; type?: string; uri: string };

export async function parseTimetableFile(file: TimetableFile): Promise<ImportResult> {
  const validation = validateFile(file);
  if (!validation.valid) throw new Error(validation.error);

  const buffer = 'arrayBuffer' in file ? await file.arrayBuffer() : await readNativeFile(file);

  const sizeValidation = validateBufferSize(buffer);
  if (!sizeValidation.valid) throw new Error(sizeValidation.error);

  if (file.name.toLowerCase().endsWith('.docx')) return parseDocxFile(buffer);
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('暂不支持 .xlsx 格式，请转换为 .docx 格式导入');
  }
  throw new Error('暂仅支持 .docx 文件。');
}

async function readNativeFile(file: { name: string; size?: number; uri: string }): Promise<ArrayBuffer> {
  const response = await fetch(file.uri);
  return response.arrayBuffer();
}