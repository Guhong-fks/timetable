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
//
// Recognition itself lives in src/lib/engine/ (position-first recognizer):
// this file is only the bridge — file validation, anydoc invocation, IR
// extraction, and error translation.
// =============================================================================

import { File } from 'expo-file-system';
import {
  ScheduledCourse,
  TimetableData,
  coursesToTimetable,
} from '@/types/timetable';
import { ParseReport } from '@/lib/reporting/ParseReport';
import type { ReportWarning } from '@/lib/reporting/types';
// Static import is safe here: expo-file-system has no nitro-module
// load-at-boot side effect (unlike react-native-anydoc, which must stay
// dynamic). Static keeps Metro from splitting it into an async chunk.
import {
  validateFile,
  validateBufferSize,
} from '../security';
import { recognizeCourses, type IrTableBlock } from '@/lib/engine/recognizer';
import { collectParseDiagnostics, serializeDiagnostics } from '@/lib/engine/parseDiagnostics';
import { parseIcsTimetable, type IcsPeriodSchedule } from '@/lib/importers/ics-parser';

// Type-only reference to react-native-anydoc: produces no runtime import, so
// Nitro is not loaded at boot. The runtime value is fetched via
// `await import('react-native-anydoc')` inside parseDocxFile.
type AnydocModule = typeof import('react-native-anydoc');

// =============================================================================
// Public types
// =============================================================================

interface ImportResult {
  courses: ScheduledCourse[];
  timetable: TimetableData;
  /**
   * .ics only: the earliest timed DTSTART as 'YYYY-MM-DD' (natural week-1
   * Monday). The import screen adopts it as 学期开始日期 when the user has
   * not set one, so grid dates render right after the import. Other
   * formats leave it undefined.
   */
  inferredSemesterStart?: string;
  /**
   * Structured parse report — single source of truth for warnings.
   * Lives next to the imported courses so the UI can show a
   * "查看解析详情" entry alongside the timetable.
   */
  report: { warnings: ReportWarning[]; suggestions: string[] };
}

/**
 * Synchronous capability probe used by callers that want to gate the
 * "选择文件" button on whether the parser engine is reachable. Returns
 * false on Expo Go (no Nitro binary), true on a Dev Client / EAS Build.
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

// =============================================================================
// IR shapes (narrow slice of anydoc's DocumentIR)
// =============================================================================

interface IrBlock {
  type: string;
  rows?: unknown[];
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

function collectTables(ir: DocumentIR): IrTableBlock[] {
  const tables: IrTableBlock[] = [];
  for (const page of ir.pages ?? []) {
    for (const block of page.blocks ?? []) {
      if (block.type !== 'table') continue;
      tables.push(block as IrTableBlock);
    }
  }
  return tables;
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
      const rows = (block.rows ?? []) as unknown[][];
      for (const row of rows) {
        total += Array.isArray(row) ? row.length : 1;
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
// parseDocxFile — engine entry point
// -----------------------------------------------------------------------------
// Calls react-native-anydoc, then hands EVERY table in the document to the
// position-first recognizer (src/lib/engine/recognizer.ts). Cross-page table
// continuation (正方 exports split one timetable over two pages) is handled
// inside the recognizer via mergeTableSegments.
// =============================================================================

async function parseDocxFile(buffer: ArrayBuffer): Promise<ImportResult> {
  // Single source of truth: clear the report singleton at the start of
  // every import so previous runs don't leak into the current one.
  const report = ParseReport.getInstance();
  report.clear();

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

  const tables = collectTables(result.ir as DocumentIR);
  if (tables.length === 0) {
    throw new Error('Word 文件没有找到课表。');
  }
  if (tables.length > 1) {
    report.addWarningFromParts(
      'header',
      'info',
      `检测到 ${tables.length} 张表格，已按章节合并/逐表识别`,
    );
  }

  const courses = recognizeCourses(tables, report);
  if (!courses.length) {
    // Attach the accumulated diagnostics to the error so the UI (and the
    // user) can see WHY nothing was recognized instead of a bare message.
    // The raw IR rides along for the device-side debugging workflow.
    throw new ImportDiagnosticsError(
      '未识别到课程，请确认文件是课表文件。',
      report.snapshot(),
      serializeDiagnostics(collectParseDiagnostics(tables, [], 'unknown')),
    );
  }

  return { courses, timetable: coursesToTimetable(courses), report: report.snapshot() };
}

/** Error carrying the parse report (and IR diagnostics) on total failure. */
export class ImportDiagnosticsError extends Error {
  readonly report: { warnings: ReportWarning[]; suggestions: string[] };
  /** Serialized IR/grid/layout dump for the share-debug workflow. */
  readonly diagnostics?: string;
  constructor(
    message: string,
    report: { warnings: ReportWarning[]; suggestions: string[] },
    diagnostics?: string,
  ) {
    super(message);
    this.name = 'ImportDiagnosticsError';
    this.report = report;
    this.diagnostics = diagnostics;
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
// parseTimetableFile — file-level entry point
// -----------------------------------------------------------------------------
// Every accepted extension routes through the SAME anydoc → recognizer
// pipeline: the Rust engine parses .docx/.doc/.xlsx natively and the
// position-first recognizer consumes the resulting DocumentIR unchanged.
// =============================================================================

type TimetableFile =
  | { name: string; size?: number; type?: string; arrayBuffer: () => Promise<ArrayBuffer> }
  | { name: string; size?: number; type?: string; uri: string };

export async function parseTimetableFile(
  file: TimetableFile,
  icsSemesterStartInput?: string,
  icsPeriodSchedule?: IcsPeriodSchedule,
): Promise<ImportResult> {
  const validation = validateFile(file);
  if (!validation.valid) throw new Error(validation.error);

  const buffer = 'arrayBuffer' in file ? await file.arrayBuffer() : await readNativeFile(file);

  const sizeValidation = validateBufferSize(buffer);
  if (!sizeValidation.valid) throw new Error(sizeValidation.error);

  const lower = file.name.toLowerCase();
  if (lower.endsWith('.ics')) {
    const icsSemesterStart = icsSemesterStartInput && icsSemesterStartInput.trim() ? icsSemesterStartInput.trim() : undefined;
    return parseIcsFile(buffer, icsSemesterStart, icsPeriodSchedule);
  }
  if (lower.endsWith('.docx') || lower.endsWith('.doc') || lower.endsWith('.xlsx')) {
    return parseDocxFile(buffer);
  }
  throw new Error('暂支持 .docx / .doc / .xlsx / .ics 课表文件。');
}

// =============================================================================
// parseIcsFile — calendar (.ics) entry point
// -----------------------------------------------------------------------------
// 纯 JS 解析（src/lib/importers/ics-parser.ts），不走 anydoc / Nitro，在
// Expo Go 里也能用。周次换算依赖学期开始日期（week-1 Monday）：没设置时
// 全部课程退化为 1..18 周并附明确提示，让用户填好日期再导一次。
// =============================================================================

/**
 * Decode .ics bytes to text, robust against the encodings real exporters
 * produce:
 *   - BOM sniffing: UTF-8 (EF BB BF), UTF-16LE (FF FE), UTF-16BE (FE FF).
 *   - No BOM: strict UTF-8 (RFC 5545 default). GBK / other legacy encodings
 *     (some Windows schedule apps) fail strict decode — we surface a clear
 *     localised error instead of silently importing U+FFFD garbage, since
 *     TextDecoder('gbk') is unavailable on Hermes.
 */
export function decodeIcsText(buffer: ArrayBuffer): { text: string; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' } {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buffer.slice(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeUtf16Le(new Uint8Array(buffer.slice(2))), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeUtf16Be(new Uint8Array(buffer.slice(2))), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    throw new Error('文件编码无法识别（可能是 GBK 等旧编码）：请在原课表 App 中导出时选择 UTF-8 编码，或另存为 UTF-8 后再导入');
  }
}

/**
 * Manual UTF-16 decoders: Expo Winter / Hermes' TextDecoder only supports
 * 'utf-8' (an unknown-encoding RangeError is thrown for utf-16le), so both
 * BOM variants are decoded by hand. Surrogate pairs are joined correctly.
 */
function decodeUtf16Le(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code >= 0xd800 && code <= 0xdbff && i + 3 < bytes.length) {
      const low = bytes[i + 2] | (bytes[i + 3] << 8);
      if (low >= 0xdc00 && low <= 0xdfff) {
        out += String.fromCharCode(code, low);
        i += 2;
        continue;
      }
    }
    out += String.fromCharCode(code);
  }
  return out;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
    if (code >= 0xd800 && code <= 0xdbff && i + 3 < bytes.length) {
      const low = (bytes[i + 2] << 8) | bytes[i + 3];
      if (low >= 0xdc00 && low <= 0xdfff) {
        out += String.fromCharCode(code, low);
        i += 2;
        continue;
      }
    }
    out += String.fromCharCode(code);
  }
  return out;
}

async function parseIcsFile(
  buffer: ArrayBuffer,
  icsSemesterStart?: string,
  icsPeriodSchedule?: IcsPeriodSchedule,
): Promise<ImportResult> {
  const report = ParseReport.getInstance();
  report.clear();

  let text: string;
  try {
    text = decodeIcsText(buffer).text;
  } catch (err) {
    // decodeIcsText throws a localised Chinese message — pass it through so
    // the user sees the actionable guidance; anything else becomes generic.
    if (err instanceof Error && /[一-龥]/.test(err.message)) throw err;
    throw new Error('文件编码无法识别，请用 UTF-8 编码重新导出 .ics 文件');
  }

  const { courses, warnings, inferredSemesterStart } = parseIcsTimetable(
    text,
    icsSemesterStart,
    icsPeriodSchedule,
  );

  for (const w of warnings) {
    report.addWarningFromParts(w.category, w.severity, w.message, undefined, w.raw);
  }

  if (!courses.length) {
    const firstError = warnings.find((w) => w.severity === 'error');
    throw new Error(firstError?.message ?? '未能从该日历文件识别出课程');
  }

  return {
    courses,
    timetable: coursesToTimetable(courses),
    report: report.snapshot(),
    inferredSemesterStart: inferredSemesterStart ?? undefined,
  };
}

/**
 * 学期开始日期对 ICS 是硬依赖（week-1 Monday 换算周次）。由调用方通过
 * parseTimetableFile(file, icsSemesterStartInput) 显式传入（见 import.tsx），
 * 不再依赖模块级可变状态。
 */

async function readNativeFile(file: { name: string; size?: number; uri: string }): Promise<ArrayBuffer> {
  // fetch() cannot read `content://` URIs (OkHttp casts to java.net.URL and
  // throws MalformedURLException). Use expo-file-system's File API instead —
  // it understands content:// and file:// on Android.
  const f = new File(file.uri);
  return await f.arrayBuffer();
}
