import { TimeSlot, TIME_SLOT_META } from '@/types/timetable';

// =============================================================================
// CourseWarning
// -----------------------------------------------------------------------------
// Flat warning descriptor emitted by the parser. The shape is intentionally
// not tied to ScheduledCourse: warnings can fire BEFORE a block normalises
// (e.g. period column not detected), and consumers (UI / log / tests) can
// filter by severity / category without walking a tree.
// =============================================================================

/** Six parser phases that can each emit their own warnings. */
export type WarningCategory =
  | 'header'    // table header / period column detection
  | 'period'    // period number parsing (out of range, non-integer)
  | 'cell'      // RawCourseBlock extraction (no course code, malformed schedule)
  | 'week'      // week-pattern parsing (out of range, unrecognised token)
  | 'teacher'   // teacher name did not match any teacher regex
  | 'address';  // address parsing fell through to "preserve verbatim"

/** Three severity levels. `error` is recoverable: parse still completes. */
export type WarningSeverity = 'info' | 'warning' | 'error';

export interface CourseWarning {
  /** Stable category for filtering/routing. */
  category: WarningCategory;
  /** Severity bucket — UI maps it to icon + color. */
  severity: WarningSeverity;
  /** Human-readable message (already localised to Chinese). */
  message: string;
  /**
   * Optional anchor back to a course or grid location. Set when the warning
   * can be tied to a specific scheduled course or table row, otherwise omit.
   */
  ref?: {
    /** Course id (ScheduledCourse.id) when known. */
    courseId?: string;
    /** Original row index in the docx table (0-based, header excluded). */
    rowIndex?: number;
    /** Original column index in the docx table. */
    colIndex?: number;
    /** Day the warning pertains to (when the column is a day column). */
    day?: string;
  };
  /** The unparsed source line, when relevant — capped to 200 chars. */
  raw?: string;
}

// =============================================================================
// Named regular-expression constants
// =============================================================================

/**
 * Course-code marker used by the .docx importer to locate a course block in a
 * cell. Now defined inside {@link DefaultParser.ts} as part of the strategy
 * chain; see `src/lib/parsers/DefaultParser.ts` for the canonical regex.
 */

/**
 * Token pattern kept for back-compat / unit tests. The state machine in
 * `tokenizeWeekSpec` does not consume this regex directly.
 */
export const WEEK_TOKEN_PATTERN: RegExp = /(\d+)(?:\s*[~-]\s*(\d+))?/g;

/** Title words the with-title teacher regex accepts. */
export const TEACHER_TITLES: readonly string[] = [
  '老师',
  '教授',
  '副教授',
  '讲师',
  '助教',
  '高级工程师',
  '副研究员',
  '研究员',
  '工程师',
] as const;

function buildTeacherWithTitlePattern(titles: readonly string[] = TEACHER_TITLES): RegExp {
  const titleAlternation = titles.map(escapeRegExp).join('|');
  return new RegExp(
    `^(?<address>.+?)[ \\t]+(?<name>(?:[\\u4e00-\\u9fa5]{1,4}·)?[\\u4e00-\\u9fa5]{2,4}(?:${titleAlternation}))$`,
  );
}

export const TEACHER_WITH_TITLE_PATTERN: RegExp = buildTeacherWithTitlePattern();

export const TEACHER_NAME_ONLY_PATTERN: RegExp =
  /^(?<address>.+?)[ \t]+(?<name>(?:[\u4e00-\u9fa5]{1,4}·)?[\u4e00-\u9fa5]{2,4})$/;

export const TEACHER_COMPOUND_SURNAME_PATTERN: RegExp =
  /^(?<address>.+?)[ \t]+(?<name>(?:[\u4e00-\u9fa5]{1,4}·)?[\u4e00-\u9fa5]{2,6})$/;

// =============================================================================
// Parser: TimeSlot mapping
// -----------------------------------------------------------------------------
// Now returns TimeSlot | null so callers can decide whether to drop the
// course or fall through to a default. Replaces the previous `return TEN`
// silent-fallback behaviour, which masked invalid period numbers.
// =============================================================================

export const MIN_PERIOD = 1;
export const MAX_PERIOD = 13;

/**
 * Pick the TimeSlot that best represents a `[start, end]` period range.
 *
 * Returns `null` when the range is invalid (start > end, out of [1, 13], or
 * non-finite). Callers must treat `null` as a recoverable parse failure:
 * normalizeBlock emits a `period` warning and skips the course.
 *
 * For valid inputs, the resolution rules are:
 *  - Exact match: `[1,2]` → `ONE_TWO`, `[5,6]` → `FIVE_SIX`, `[8,8]` → `EIGHT`
 *  - Anchor match: `[5,7]` → `FIVE_SIX` (renderer carries the real span)
 *  - Otherwise: `null` (unknown start)
 */
export function slot(start: number, end: number = start): TimeSlot | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end < start) return null;
  if (start < MIN_PERIOD || start > MAX_PERIOD || end > MAX_PERIOD) return null;

  const exact = (Object.entries(TIME_SLOT_META) as [TimeSlot, { start: number; end: number }][])
    .find(([, meta]) => meta.start === start && meta.end === end);
  if (exact) return exact[0];

  const anchor = (Object.entries(TIME_SLOT_META) as [TimeSlot, { start: number; end: number }][])
    .find(([, meta]) => meta.start === start);
  if (anchor) return anchor[0];

  return null;
}

// =============================================================================
// Parser: Week pattern (explicit state machine)
// -----------------------------------------------------------------------------
// Output shape (v4):
//   - weekList:   sorted, deduped, 1-based array of weeks the course runs in
//   - isOddEven:  'odd' | 'even' | null | undefined — present when the
//                 source text explicitly used 单周 / 双周 markers
//   - rawText:    the original input, echoed back for warning context
//   - warnings:   CourseWarning entries for out-of-range weeks
// =============================================================================

const MIN_WEEK = 1;
/** 25 covers the longest documented semester (24 weeks + grace). */
export const MAX_WEEK = 25;
/** Chinese university semesters are typically 18 weeks (15 teaching + exams). */
export const DEFAULT_SEMESTER_TOTAL_WEEKS = 18;

type WeekToken = { type: 'single'; n: number } | { type: 'range'; from: number; to: number };

export function tokenizeWeekSpec(spec: string): WeekToken[] {
  // ^ exposed only so `parsers-patterns.test.ts` can drive the state machine
  // directly. Production callers should go through `parseWeekPattern`.

  const out: WeekToken[] = [];
  let i = 0;

  while (i < spec.length) {
    const ch = spec[i];
    if (ch === undefined || /\s/.test(ch) || ch === '周') {
      i++;
      continue;
    }
    if (/\d/.test(ch)) {
      const [first, afterFirst] = readNumber(spec, i);
      i = afterFirst;
      const sep = readRangeSeparator(spec, i);
      if (sep !== null) {
        const [second, afterSecond] = readNumber(spec, sep.endIndex);
        const token: WeekToken = { type: 'range', from: first, to: second };
        out.push(token);
        i = afterSecond;
        while (true) {
          const nextSep = readRangeSeparator(spec, i);
          if (nextSep === null) break;
          if (!/\d/.test(spec[nextSep.endIndex] ?? '')) break;
          const [third, afterThird] = readNumber(spec, nextSep.endIndex);
          if (token.type === 'range') token.to = third;
          i = afterThird;
        }
      } else {
        out.push({ type: 'single', n: first });
      }
      continue;
    }
    i++;
  }
  return out;
}

function readNumber(spec: string, start: number): [number, number] {
  let end = start;
  while (end < spec.length && /\d/.test(spec[end] ?? '')) end++;
  return [Number(spec.slice(start, end)), end];
}

function readRangeSeparator(spec: string, start: number): { endIndex: number } | null {
  let i = start;
  while (i < spec.length && /\s/.test(spec[i] ?? '')) i++;
  const ch = spec[i];
  if (ch !== '-' && ch !== '~' && ch !== '－' && ch !== '〜') return null;
  i++;
  while (i < spec.length && /\s/.test(spec[i] ?? '')) i++;
  return { endIndex: i };
}

// =============================================================================
// New v4 result shape
// =============================================================================

export interface WeekParseResult {
  /** Concrete, sorted, deduped 1-based week numbers the course meets in. */
  weekList: number[];
  /**
   * 'odd'   — source explicitly said "单周" only
   * 'even'  — source explicitly said "双周" only
   * null    — single-week / range expression with no odd/even marker, or
   *           both markers present (conflict ⇒ treated as full)
   * undefined — no usable week info at all (empty input)
   */
  isOddEven?: 'odd' | 'even' | null;
  /** Echo of the input for warning context. */
  rawText: string;
  warnings: CourseWarning[];
}

/**
 * Detect odd/even markers. We strip the marker phrases first so the
 * numeric tokenizer doesn't see them as garbage.
 *
 * Returns:
 *   - 'odd' | 'even' if exactly one marker appears
 *   - 'both' if both appear (caller treats as null + warning)
 *   - undefined if neither appears
 */
function detectOddEvenMarker(spec: string): 'odd' | 'even' | 'both' | undefined {
  // `\b` doesn't help with CJK — use explicit lookarounds.
  const hasOdd = /(?:^|[^\u4e00-\u9fa5])单\s*周/.test(spec);
  const hasEven = /(?:^|[^\u4e00-\u9fa5])双\s*周/.test(spec);
  if (hasOdd && hasEven) return 'both';
  if (hasOdd) return 'odd';
  if (hasEven) return 'even';
  return undefined;
}

/** Strip 单周 / 双周 phrases so the numeric tokenizer is unaffected. */
function stripOddEvenMarkers(spec: string): string {
  return spec.replace(/(单|双)\s*周/g, '').trim();
}

/**
 * Generate odd or even weeks in [1, totalWeeks].
 *
 * Examples (totalWeeks=18):
 *   odd  → [1, 3, 5, 7, 9, 11, 13, 15, 17]
 *   even → [2, 4, 6, 8, 10, 12, 14, 16, 18]
 */
function expandOddEven(kind: 'odd' | 'even', totalWeeks: number): number[] {
  const start = kind === 'odd' ? 1 : 2;
  const out: number[] = [];
  for (let w = start; w <= totalWeeks; w += 2) out.push(w);
  return out;
}

/**
 * Expand a numeric range into its inclusive week list, clamped to
 * [MIN_WEEK, MAX_WEEK]. Returns [] for invalid input.
 */
function expandRange(lo: number, hi: number): number[] {
  const from = Math.min(lo, hi);
  const to = Math.max(lo, hi);
  const start = Math.max(from, MIN_WEEK);
  const end = Math.min(to, MAX_WEEK);
  if (start > end) return [];
  const out: number[] = [];
  for (let w = start; w <= end; w++) out.push(w);
  return out;
}

/**
 * Parse a week pattern string into the v4 shape.
 *
 * Supported source forms:
 *   - "1-18周"           → full semester (continuous, ≥ 18 weeks) ⇒ all weeks
 *   - "1-8,10-16周"      → range union, deduped
 *   - "3,5,7周"          → specific weeks
 *   - "单周"             → all odd weeks [1,3,5,...,totalWeeks]
 *   - "双周"             → all even weeks [2,4,6,...,totalWeeks]
 *   - "1-8周 单周"       → odd weeks within 1..8
 *   - "1-8周 双周"       → even weeks within 1..8
 *   - "1-8周 单周 双周"  → treated as full 1..8 + warning
 *   - "30周" / "20-30周" → clamped to [1, MAX_WEEK] with warning
 *
 * @param weeksStr    the source text (e.g. "1-8周 单周")
 * @param totalWeeks  semester length for "单周/双周 全程" expansion
 *                    (defaults to DEFAULT_SEMESTER_TOTAL_WEEKS = 18)
 */
export function parseWeekPattern(
  weeksStr: string,
  totalWeeks: number = DEFAULT_SEMESTER_TOTAL_WEEKS,
): WeekParseResult {
  const warnings: CourseWarning[] = [];
  const rawText = weeksStr;

  // Empty input → no week info at all; downstream normaliser treats as
  // "specific with []" and emits its own `cell` warning.
  if (!weeksStr || !weeksStr.trim()) {
    return { weekList: [], isOddEven: undefined, rawText, warnings };
  }

  const oddEven = detectOddEvenMarker(weeksStr);
  const numericPart = stripOddEvenMarkers(weeksStr);
  const tokens = tokenizeWeekSpec(numericPart);

  // Build the numeric week list.
  const weeks = new Set<number>();
  for (const token of tokens) {
    if (token.type === 'single') {
      if (!Number.isFinite(token.n)) continue;
      if (token.n < MIN_WEEK || token.n > MAX_WEEK) {
        warnings.push({
          category: 'week',
          severity: 'warning',
          message: `周次 ${token.n} 超出支持范围 (${MIN_WEEK}-${MAX_WEEK})，已忽略`,
          raw: rawText,
        });
        continue;
      }
      weeks.add(token.n);
      continue;
    }
    if (!Number.isFinite(token.from) || !Number.isFinite(token.to)) continue;
    const lo = Math.min(token.from, token.to);
    const hi = Math.max(token.from, token.to);
    if (hi > MAX_WEEK) {
      warnings.push({
        category: 'week',
        severity: 'warning',
        message: `周次范围 ${lo}-${hi} 上限超出 ${MAX_WEEK}，已截断`,
        raw: rawText,
      });
    }
    if (lo < MIN_WEEK) {
      warnings.push({
        category: 'week',
        severity: 'warning',
        message: `周次范围 ${lo}-${hi} 下限低于 ${MIN_WEEK}，已截断`,
        raw: rawText,
      });
    }
    for (const w of expandRange(token.from, token.to)) weeks.add(w);
  }

  // If we have a range AND an odd/even marker, intersect.
  //   "1-8周 单周" → odd weeks in [1..8]
  //   "1-8周 双周" → even weeks in [1..8]
  if (weeks.size > 0 && (oddEven === 'odd' || oddEven === 'even')) {
    const numericList = [...weeks].sort((a, b) => a - b);
    const filtered = numericList.filter((w) =>
      oddEven === 'odd' ? w % 2 === 1 : w % 2 === 0,
    );
    weeks.clear();
    for (const w of filtered) weeks.add(w);
  }

  // If we have NO numbers but a single odd/even marker, expand over the
  // full semester. "单周" / "双周" alone is a valid form.
  if (weeks.size === 0 && (oddEven === 'odd' || oddEven === 'even')) {
    for (const w of expandOddEven(oddEven, Math.min(totalWeeks, MAX_WEEK))) {
      weeks.add(w);
    }
    if (totalWeeks > MAX_WEEK) {
      warnings.push({
        category: 'week',
        severity: 'info',
        message: `学期总周数 ${totalWeeks} 超出 ${MAX_WEEK}，已截断`,
        raw: rawText,
      });
    }
  }

  let sorted = [...weeks].sort((a, b) => a - b);

  // Post-truncation guard: any value still > MAX_WEEK is dropped here
  // (covers the "1-25,100周" edge that the per-token clamps may not
  // catch because they only fire on tokens, not on a merged set).
  const beforeTrim = sorted.length;
  sorted = sorted.filter((w) => w >= MIN_WEEK && w <= MAX_WEEK);
  if (sorted.length !== beforeTrim) {
    warnings.push({
      category: 'week',
      severity: 'warning',
      message: `生成结果中存在超出 ${MAX_WEEK} 的周次，已移除`,
      raw: rawText,
    });
  }

  // Resolve isOddEven.
  let isOddEven: 'odd' | 'even' | null | undefined;
  if (oddEven === 'both') {
    // Conflict: both 单周 and 双周 in the same text ⇒ full weeks.
    // If we previously filtered with one of them, undo that filter by
    // re-expanding the original range.
    if (tokens.length > 0) {
      const expanded = new Set<number>();
      for (const token of tokens) {
        if (token.type === 'single') {
          if (token.n >= MIN_WEEK && token.n <= MAX_WEEK) expanded.add(token.n);
          continue;
        }
        for (const w of expandRange(token.from, token.to)) expanded.add(w);
      }
      sorted = [...expanded].sort((a, b) => a - b);
    } else {
      // No numeric anchors at all but both markers → fall back to all weeks.
      sorted = [];
      for (let w = MIN_WEEK; w <= Math.min(totalWeeks, MAX_WEEK); w++) sorted.push(w);
    }
    isOddEven = null;
    warnings.push({
      category: 'week',
      severity: 'info',
      message: '检测到同时包含单双周标记，已按全周处理',
      raw: rawText,
    });
  } else if (oddEven === 'odd' || oddEven === 'even') {
    isOddEven = oddEven;
  } else {
    // No marker; the result is whatever the range expression yielded.
    isOddEven = null;
  }

  return { weekList: sorted, isOddEven, rawText, warnings };
}

// =============================================================================
// Parser: Input sanitization
// =============================================================================

const CONTROL_AND_SPACE_PATTERN: RegExp = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u00A0\u2000-\u200F\u2028-\u202F\u205F\u3000]/g;
const BIDI_AND_ZERO_WIDTH_PATTERN: RegExp = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const NEWLINE_NORMALIZE_PATTERN: RegExp = /\r?\n/g;
const NEWLINE_FOLD_PATTERN: RegExp = /\n{2,}/g;

export function sanitizeInput(
  input: string,
  maxLength: number = 1000,
  preserveWhitespace: boolean = true,
): string {
  if (!input) return '';
  let sanitized = input.slice(0, maxLength);
  if (!preserveWhitespace) sanitized = sanitized.trim();
  sanitized = sanitized.replace(NEWLINE_NORMALIZE_PATTERN, '\n');
  sanitized = sanitized.replace(BIDI_AND_ZERO_WIDTH_PATTERN, '');
  sanitized = sanitized.replace(NEWLINE_FOLD_PATTERN, '\n');
  sanitized = sanitized.replace(CONTROL_AND_SPACE_PATTERN, ' ');
  if (!preserveWhitespace) sanitized = sanitized.trim();
  return sanitized;
}

// =============================================================================
// Parser: Location + teacher
// -----------------------------------------------------------------------------
// New return shape:
//   - campus:   '磬苑校区' | '其他' | 'unknown'   ('unknown' = no campus prefix)
//   - address:  the raw remainder, trimmed; never '未填写' — empty means empty
//   - teacher:  string | null                     (null = no regex matched)
// `confidence: 'high' | 'medium' | 'low'` tells the UI how much weight to
// give the teacher field when displaying the course card.
// =============================================================================

export type TeacherConfidence = 'high' | 'medium' | 'low';

export interface ParsedLocation {
  campus: '磬苑校区' | '其他' | 'unknown';
  address: string;
  teacher: string | null;
  confidence: TeacherConfidence;
}

/**
 * @deprecated Prefer {@link parseLocationAndTeacherDetailed}. Kept for
 * back-compat with existing UI: returns `teacher ?? '未填写'` and
 * `address || '未填写'` so the renderer doesn't have to special-case null.
 */
export function parseLocationAndTeacher(line: string): {
  campus: '磬苑校区' | '其他';
  building: string;
  room: string;
  teacher: string;
} {
  const r = parseLocationAndTeacherDetailed(line);
  return {
    campus: r.campus === 'unknown' ? '磬苑校区' : r.campus,
    building: r.address || '未填写',
    room: '未填写',
    teacher: r.teacher ?? '未填写',
  };
}

/**
 * Lossless version of the location parser. Returns the raw remainder as
 * `address` (never coerced to a placeholder) and `null` for teacher when no
 * pattern matched (UI can choose to show "未识别" vs "未填写").
 */
export function parseLocationAndTeacherDetailed(line: string): ParsedLocation {
  const trimmed = line.trim();
  if (!trimmed) {
    return { campus: 'unknown', address: '', teacher: null, confidence: 'low' };
  }

  // Campus prefix: known prefix → concrete campus; otherwise 'unknown'.
  const campusMatch = trimmed.match(/^(磬苑校区|其他校区|望岳校区|翠园校区)\s*/);
  let campus: '磬苑校区' | '其他' | 'unknown';
  let afterCampus: string;
  if (campusMatch) {
    campus = campusMatch[1] === '其他校区' ? '其他' : '磬苑校区';
    afterCampus = trimmed.slice(campusMatch[0].length).trim();
  } else {
    campus = 'unknown';
    afterCampus = trimmed;
  }

  if (!afterCampus) {
    return { campus, address: '', teacher: null, confidence: 'low' };
  }

  // Try patterns most-specific first.
  const teacherPatterns: { pattern: RegExp; confidence: TeacherConfidence }[] = [
    { pattern: TEACHER_WITH_TITLE_PATTERN, confidence: 'high' },
    { pattern: TEACHER_NAME_ONLY_PATTERN, confidence: 'medium' },
    { pattern: TEACHER_COMPOUND_SURNAME_PATTERN, confidence: 'low' },
  ];

  let address = afterCampus;
  let teacher: string | null = null;
  let confidence: TeacherConfidence = 'low';

  for (const { pattern, confidence: c } of teacherPatterns) {
    const match = address.match(pattern);
    if (match?.groups) {
      address = match.groups.address.trim();
      teacher = sanitizeInput(match.groups.name.trim());
      confidence = c;
      break;
    }
  }

  address = address.replace(/^[\s、，,；;：:]+|[\s、，,；;：:]+$/g, '').trim();

  return { campus, address, teacher, confidence };
}

// =============================================================================
// Helpers
// =============================================================================

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}