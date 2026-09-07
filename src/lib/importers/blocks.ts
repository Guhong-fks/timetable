// =============================================================================
// Cell-text → RawCourseBlock → ScheduledCourse
// -----------------------------------------------------------------------------
// This module is intentionally free of mammoth / htmlparser2 so that unit
// tests can exercise the per-field warning pipeline without pulling in the
// docx→html conversion step (which is ESM-only and breaks jest's CJS
// transformer).
//
// `timetable-importer.ts` is the only consumer in production.
// =============================================================================

import { ScheduledCourse, WeekDay } from '@/types/timetable';
import {
  slot,
  parseWeekPattern,
  sanitizeInput,
  parseLocationAndTeacherDetailed,
  MIN_PERIOD,
  MAX_PERIOD,
  type CourseWarning,
  type ParsedLocation,
} from './parsers';
import type { ParserChain } from '@/lib/parsers/ParserChain';
import type { ParsedCourseCode } from '@/lib/parsers/ICourseCodeParser';

// =============================================================================
// RawCourseBlock
// =============================================================================

export interface RawCourseBlock {
  source: { lineIndex: number; raw: string };
  name?: string;
  /** `(weeksStr)(start-end节)` — captured verbatim, not yet validated. */
  schedule?: { weeks: string; start: number; end: number };
  /** The full schedule line AFTER the closing parenthesis, raw. */
  location?: string;
}

// =============================================================================
// Cell → blocks
// =============================================================================

/**
 * Convert one cell's text into zero-or-more RawCourseBlocks.
 *
 * Two passes:
 *
 *  1. **Code-anchored pass** — for every line the parser chain recognises
 *     a course code, collect that line as the code row and the following
 *     `(…周)(…节) …` lines as schedule/location rows. Stops at the next
 *     code row (start of a new block).
 *  2. **Fallback pass** — for any line that the chain did NOT recognise
 *     as code-bearing, hand it to the FallbackParser so it can yield a
 *     name-only block. This salvages primary-school / overseas styles
 *     where the row is `name + schedule` glued together.
 *
 * The fallback pass produces blocks with `schedule` populated from the
 * same `(…周)(…节) …` regex as pass 1; the importer's normaliser
 * decides what's usable.
 */
export function extractBlocksFromCell(text: string, parserChain: ParserChain): RawCourseBlock[] {
  const blocks: RawCourseBlock[] = [];
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Track which lines pass 1 already consumed, so pass 2 skips them.
  const consumed = new Set<number>();

  // -----------------------------------------------------------------------
  // Pass 1: code-anchored blocks (university-style `202420241-CS10101.001`
  // and the generic / user-defined codes).
  // -----------------------------------------------------------------------
  for (let index = 0; index < lines.length; index++) {
    if (consumed.has(index)) continue;
    const parsed = parserChain.parse(lines[index]);
    if (parsed.code === null) continue;
    consumed.add(index);

    // Pass 1 owns the line above the code row — it's the course-name row
    // belonging to THIS block. Mark it consumed so Pass 2 doesn't try to
    // re-parse it as a self-contained `name + schedule` payload.
    if (index > 0 && !consumed.has(index - 1)) consumed.add(index - 1);

    const name = lines[index - 1];
    for (let scheduleIndex = index + 1; scheduleIndex < lines.length; scheduleIndex++) {
      const scheduleLine = lines[scheduleIndex];
      // Stop when the next line is itself code-bearing — new block starts.
      if (parserChain.parse(scheduleLine).code !== null) break;

      consumed.add(scheduleIndex);
      const scheduleMatch = scheduleLine.match(/\(([^)]*周)\)\s*\((\d+)-(\d+)节\)/);
      if (!scheduleMatch) {
        // Schedule line present but unparseable — keep the block so the
        // normaliser can report a `cell` warning.
        blocks.push({
          source: { lineIndex: index, raw: lines[index] },
          name,
          location: scheduleLine.trim(),
        });
        continue;
      }

      const weeks = scheduleMatch[1];
      const start = Number(scheduleMatch[2]);
      const end = Number(scheduleMatch[3]);
      const after = scheduleLine.slice(scheduleMatch.index! + scheduleMatch[0].length).trim();

      blocks.push({
        source: { lineIndex: index, raw: lines[index] },
        name,
        schedule: { weeks, start, end },
        location: after,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Pass 2: fallback — every remaining line is a self-contained
  // `name + schedule` payload (no code anchor). Try to extract a name and
  // an optional `(…周)(…节) …` schedule from the rest. Lines that yield
  // neither still become a name-only block; the normaliser emits a
  // `cell` warning and may drop them.
  // -----------------------------------------------------------------------
  for (let index = 0; index < lines.length; index++) {
    if (consumed.has(index)) continue;
    consumed.add(index);

    const raw = lines[index];
    const parsed: ParsedCourseCode = parserChain.parse(raw);
    const name = parsed.name ?? (parsed.code === null ? raw : undefined);
    if (!name) continue;

    const rest = parsed.rest;
    const scheduleMatch = rest.match(/\(([^)]*周)\)\s*\((\d+)-(\d+)节\)/);
    if (!scheduleMatch) {
      blocks.push({
        source: { lineIndex: index, raw },
        name,
        location: rest || undefined,
      });
      continue;
    }

    const weeks = scheduleMatch[1];
    const start = Number(scheduleMatch[2]);
    const end = Number(scheduleMatch[3]);
    const after = rest.slice(scheduleMatch.index! + scheduleMatch[0].length).trim();

    blocks.push({
      source: { lineIndex: index, raw },
      name,
      schedule: { weeks, start, end },
      location: after || undefined,
    });
  }

  return blocks;
}

// =============================================================================
// Normalise: RawCourseBlock → ScheduledCourse
// =============================================================================

export interface NormaliseContext {
  day: WeekDay;
  rowIndex: number;
  colIndex: number;
  warnings: CourseWarning[];
}

/**
 * Convert one RawCourseBlock into a ScheduledCourse. Returns `null` when
 * the block is unusable; populates `ctx.warnings` with category-specific
 * CourseWarning entries describing what went wrong. Callers must handle
 * the null return — silent `push` of invalid courses is a regression.
 */
export function normaliseBlock(
  block: RawCourseBlock,
  ctx: NormaliseContext,
): ScheduledCourse | null {
  const id = `${ctx.day}-${ctx.rowIndex}-${block.source.lineIndex}`;

  if (!block.schedule) {
    ctx.warnings.push({
      category: 'cell',
      severity: 'warning',
      message: `课程代码 "${truncate(block.source.raw, 60)}" 缺少可解析的节次行，已跳过`,
      ref: { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex, day: ctx.day },
      raw: block.source.raw,
    });
    return null;
  }

  const { weeks, start, end } = block.schedule;
  const timeSlot = slot(start, end);
  if (timeSlot === null) {
    ctx.warnings.push({
      category: 'period',
      severity: 'error',
      message: `节次 ${start}-${end} 越界 (有效范围 ${MIN_PERIOD}-${MAX_PERIOD})，已跳过`,
      ref: { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex, day: ctx.day },
      raw: block.source.raw,
    });
    return null;
  }

  const weekResult = parseWeekPattern(weeks);
  for (const w of weekResult.warnings) {
    ctx.warnings.push({
      ...w,
      ref: { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex, day: ctx.day },
    });
  }

  const locationParsed: ParsedLocation = block.location
    ? parseLocationAndTeacherDetailed(block.location)
    : { campus: 'unknown', address: '', teacher: null, confidence: 'low' };

  if (locationParsed.teacher === null) {
    ctx.warnings.push({
      category: 'teacher',
      severity: 'warning',
      message: '教师姓名未识别，已保留原文',
      ref: { courseId: id, rowIndex: ctx.rowIndex, colIndex: ctx.colIndex, day: ctx.day },
      raw: block.location,
    });
  }
  if (locationParsed.address === '' && block.location) {
    ctx.warnings.push({
      category: 'address',
      severity: 'info',
      message: '上课地址解析为空，已保留原文',
      ref: { courseId: id, rowIndex: ctx.rowIndex, colIndex: ctx.colIndex, day: ctx.day },
      raw: block.location,
    });
  }

  return {
    id,
    name: sanitizeInput(block.name ?? '未命名课程'),
    day: ctx.day,
    timeSlot,
    startPeriod: start,
    endPeriod: end,
    duration: end - start + 1,
    // Persist empty strings rather than '未填写' placeholders — the UI
    // applies the placeholder at render time (`value || '未填写'`). Storing
    // the placeholder directly muddies migrate-from-legacy logic and makes
    // it impossible to distinguish "user-typed 未填写" from "no data".
    location: { address: locationParsed.address || block.location || '' },
    teacher: { name: locationParsed.teacher ?? '' },
    weekList: weekResult.weekList,
    isOddEven: weekResult.isOddEven ?? null,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}