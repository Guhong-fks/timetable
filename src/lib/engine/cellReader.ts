// =============================================================================
// cellReader — position-first cell → course fields
// -----------------------------------------------------------------------------
// Step 2 of the position-first recognizer (validated against real 正方/安大
// exports; see src/__tests__/fixtures/*.json). Principles:
//
//   * The cell's (row, col) position in the dense grid is the PRIMARY source
//     of truth for 星期/节次. Text only ENRICHES: exact periods, weeks,
//     teacher, location.
//   * A cell never gets dropped for missing `(weeks)(X-Y节)` markers — when
//     text offers nothing, period = the row's period digit + rowSpan, and
//     weeks default to full semester (flagged via warning).
//   * 正方-style hard-wrapped details live in SEPARATE plain cells below the
//     course cell in the same column. The reader consumes them (appending
//     text, marking them read) so they don't spawn ghost courses.
// =============================================================================
import {
  isDayHeaderText,
  isPeriodDigitText,
  type GridCell,
  type TableLayout,
} from '@/lib/engine/tableGrid';
import { MIN_PERIOD, MAX_PERIOD, type CourseWarning } from '@/lib/importers/parsers';

// -----------------------------------------------------------------------------
// Regexes (Word 导出方言)
// -----------------------------------------------------------------------------

/** `(1-8周)` / `（1~18周）` — weeks inside parens (安大 style). */
const WEEKS_IN_PAREN = /[(（]\s*([^()（）]*?周[^()（）]*?)\s*[)）]/;
/** `(3-5节)` / `（8-10节）` — the period marker. */
const PERIOD_PAREN = /[(（]\s*(\d{1,2})\s*[-~～—–]\s*(\d{1,2})\s*节\s*[)）]/;
/** `(12节)` — single period marker. */
const SINGLE_PERIOD_PAREN = /[(（]\s*(\d{1,2})\s*节\s*[)）]/;
/** Weeks OUTSIDE parens (正方 style): `1-3周,5-17周` / `9~16周` / `8周,14周`. */
const WEEKS_OUTSIDE = /\d{1,2}\s*[-~～—–]\s*\d{1,2}周(?:\s*[单双]周)?|\d{1,2}周(?:\s*[单双]周)?/g;
/** `202620271-ZH35204.001` — course codes, stripped from names. */
const CODE_ANY = /\d{7,10}-[A-Za-z0-9]{2,8}(\.\d{1,3})?/g;
/** 教师:/授课教师: — labeled teacher (正方 style). */
const TEACHER_LABELED = /(?:授课)?教师\s*[:：]\s*([^/;；\n]*)/;
/** 校区:/楼号:/场地:/地点: — labeled location parts (正方 style). */
const CAMPUS_LABELED = /校区\s*[:：]\s*([^/;；\n]*)/;
const BUILDING_LABELED = /楼号\s*[:：]\s*([^/;；\n]*)/;
const VENUE_LABELED = /(?:场地|地点)\s*[:：]\s*([^/;；\n]*)/;
/** Continuation-cell gate: only cells with label/detail punctuation get folded. */
const DETAILISH = /[/:；;＝=]|[（(]\s*\d|[、,，]/;
/** Star/circle markers appended by 教务 exports (★ 优秀课程, ○ 双语 etc). */
const MARKERS = /[★○△☆◆●✦✚◎〇]/g;
/** Trailing CJK teacher name after a location keyword (安大 style). */
const TRAILING_TEACHER = /[　\s]+([\u4e00-\u9fa5]{2,4})\s*$/;

/**
 * Continuation-fragment test (first line of a cell). True for the hard-wrap
 * debris the 正方 export produces: '(1-2节)…', '沙/楼号:…', '楼D501/教师:…',
 * '进东/教学班:…', ':4.0', '馆/教师:…'. False for anything that starts like a
 * course NAME — a CJK word that runs past one char before punctuation
 * (数字电路与逻辑设计 / CS101 / 大学物理A2).
 */
function isContinuationFragment(firstLine: string): boolean {
  const t = firstLine.trim();
  if (!t) return false;
  // Mid-sentence debris: starts with punctuation or a closing paren.
  if (/^[/:；;＝=、,，.。)]/.test(t)) return true;
  // Period/label debris: starts with '(数字' — '(1-2节)…' / '（8-9节）…'.
  if (/^[（(]\s*\d/.test(t)) return true;
  // Digit/letter-led debris always carries '/' ':' or ';' early
  // ('2;25光电…', '203（智慧教室）/教师', '08G0011-01/教学班组成').
  if (/^[\dA-Za-z]/.test(t) && DETAILISH.test(t)) return true;
  // Truncated-word debris: a SHORT CJK lead (≤2 chars) immediately followed
  // by '/' or ':' — '沙/楼号:…', '进东/教学班:…', '馆/教师:…', '东/教学班'.
  // Real course names run longer before any punctuation, and start-of-cell
  // names never begin 'X/'.
  if (/^[\u4e00-\u9fa5]{1,2}[/：:;]/.test(t)) return true;
  // Teacher-prefixed detail chain: '沈进东/教学班:…', '邬良能/教师:…' — a
  // wrap that landed between the teacher label and its value. A real course
  // name is never followed by one of these detail labels.
  if (/^[\u4e00-\u9fa5]{1,4}[/／](?:教学班|教师|选课备注|选课|学分|场地|楼号|校区)/.test(t)) return true;
  // Detail label near the START of the line: the wrap landed mid-label
  // ('课备注:/学分:3.0' ← 选课备注). Real course names carry labels only
  // AFTER the full name + period marker, i.e. well past the first 8 chars.
  const label = /(?:教学班|课备注|学分|楼号|场地|校区|教师)/.exec(t);
  if (label && label.index <= 8) return true;
  // Ends-incomplete: wrap points leave the line ending at a label boundary
  // '/教师' '/学分' ('楼T202（智慧教室）/教师'), a cut label value
  // '校区:下' ('…/场地:环宇'), or a dangling '-' ('教学班:(2026-2027-1)-').
  if (/\/[\u4e00-\u9fa5]{1,4}$/.test(t)) return true;
  if (/[：:][\u4e00-\u9fa5]{1,2}$/.test(t)) return true;
  if (/[--]$/.test(t)) return true;
  return false;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface CourseFields {
  name: string;
  startPeriod: number;
  endPeriod: number;
  /** True when (X-Y节) came from text; false = position-derived. */
  periodsFromText: boolean;
  weeksSpec: string | null;
  teacher: string | null;
  location: string;
}

interface ReadCellContext {
  grid: (GridCell | null)[][];
  layout: TableLayout;
  /** Cross-cell consumed set (by object identity). */
  consumed: WeakSet<object>;
  /** CourseWarning accumulator for the current import. */
  warnings: CourseWarning[];
}

// -----------------------------------------------------------------------------
// Public entry
// -----------------------------------------------------------------------------

/**
 * Read one anchor cell as zero or more courses. Most cells yield exactly
 * one; a merged cell stacking two courses (安大 export) yields two.
 */
export function readCourseCells(
  cell: GridCell,
  placedCol: number,
  ctx: ReadCellContext,
): CourseFields[] {
  const { grid, layout, consumed, warnings } = ctx;
  const day = layout.dayCols.get(placedCol);
  if (day === undefined) return [];

  const text = cell.text.trim();
  if (!text) return [];
  if (isDayHeaderText(text) || isPeriodDigitText(text)) return [];
  if (layout.headerRow !== null && cell.rowIndex === layout.headerRow) return [];
  if (consumed.has(cell)) return [];
  consumed.add(cell);

  // ---- collect hard-wrapped continuation cells below (正方 dialect) ----
  // A continuation fragment ALWAYS starts mid-sentence (a hard line break
  // split '(1-2节)1-3周,…/校区:…' into '(1-2节)…', '沙/楼号:…', ':4.0'),
  // while a course cell always starts with a course NAME line. So the
  // first-line shape — not the whole text — decides continuation vs course.
  // Checking only the first line is what keeps a below-vMerge course cell
  // (rowSpan unresolved on device ⇒ looks like a plain cell) from being
  // silently swallowed as "details" of the course above it.
  const parts: string[] = [text];
  for (let ri = cell.rowIndex + Math.max(1, cell.rowSpan ?? 1); ri < grid.length; ri++) {
    const below = grid[ri][placedCol];
    if (!below || below === cell || consumed.has(below)) continue;
    const t = below.text.trim();
    if (!t) continue;
    // Structural cells terminate the detail block.
    if (isDayHeaderText(t) || isPeriodDigitText(t)) break;
    // Any spanning cell starts a logical unit — stop before it.
    if ((below.rowSpan ?? 1) > 1) break;
    const firstLine = t.split('\n')[0] ?? '';
    if (!isContinuationFragment(firstLine)) break;
    consumed.add(below);
    parts.push(t);
  }
  const full = parts.join('');
  if (!full) return [];

  // ---- periods: text first, position fallback ----
  let startPeriod: number;
  let endPeriod: number;
  let periodsFromText: boolean;
  const pm = PERIOD_PAREN.exec(full);
  if (pm) {
    startPeriod = Number(pm[1]);
    endPeriod = Number(pm[2]);
    periodsFromText = true;
  } else {
    const sm = SINGLE_PERIOD_PAREN.exec(full);
    if (sm) {
      startPeriod = Number(sm[1]);
      endPeriod = Number(sm[1]);
      periodsFromText = true;
    } else {
      periodsFromText = false;
      // Position-derived periods. Do NOT multiply the period digit by
      // rowSpan: on-device IR may over-report rowSpan for vMerge regions
      // (start 3 × span 5 → "3-7节" → clamped away = lost course). Instead,
      // scan the period column over EVERY row the cell covers — the digits
      // themselves are 1..13, so the result is bounded by construction.
      const covered = scanCoveredPeriodDigits(grid, layout, cell, placedCol);
      if (covered.length > 0) {
        startPeriod = Math.min(...covered);
        endPeriod = Math.max(...covered);
        if (endPeriod - startPeriod + 1 < covered.length) {
          endPeriod = startPeriod + covered.length - 1;
        }
      } else {
        // Raw-row fallback when the period column is missing entirely.
        startPeriod = cell.rowIndex + 1;
        endPeriod = startPeriod;
        warnings.push({
          category: 'period',
          severity: 'info',
          message: `节次无法精确推断，按行位置估算为 ${startPeriod}-${endPeriod} 节，建议手动核对`,
          raw: full.slice(0, 200),
        });
      }
    }
  }
  if (endPeriod < startPeriod) endPeriod = startPeriod;
  // Hard bounds: the data model renders a 13-period grid (CLASS_PERIODS).
  // A block whose periods exceed it is a misread fragment (e.g. a detail
  // cell that took the raw-row fallback on a page-2 table) — drop it with
  // an error warning instead of emitting an unplaceable course.
  if (startPeriod > MAX_PERIOD || endPeriod > MAX_PERIOD) {
    warnings.push({
      category: 'period',
      severity: 'error',
      message: `节次 ${startPeriod}-${endPeriod} 超出支持范围 (${MIN_PERIOD}-${MAX_PERIOD})，已跳过该课程块`,
      raw: full.slice(0, 200),
    });
    return [];
  }

  // ---- weeks ----
  const weeksParts: string[] = [];
  const wm = WEEKS_IN_PAREN.exec(full);
  if (wm && !wm[1].includes('节')) {
    weeksParts.push(wm[1].replace(/\s+/g, ''));
  }
  const outsideText = full.replace(/[(（][^)（）]*[)）]/g, ' ');
  for (const m of outsideText.matchAll(WEEKS_OUTSIDE)) {
    const spec = m[0].replace(/\s+/g, '');
    if (!weeksParts.includes(spec)) weeksParts.push(spec);
  }
  const weeksSpec = weeksParts.length ? weeksParts.join(',') : null;
  if (!weeksSpec) {
    warnings.push({
      category: 'week',
      severity: 'info',
      message: '未识别到周次信息，按全学期处理',
      raw: full.slice(0, 200),
    });
  }

  // ---- teacher(s) ----
  // The 安大 export lists multi-teacher courses as slash-separated names
  // ('王章银/王蓉蓉/尹晓峰/张子云/谢传梅/谌正艮'); keep ALL of them, joined
  // by '、'. The stored model is a single string (teacher.name), so the
  // join preserves every teacher without a data-model migration.
  let teacher: string | null = null;
  const expandTeacherList = (raw: string): string => {
    const names = raw
      .split(/[/／、，,;；]/)
      .map((s) => s.trim())
      .filter((s) => /^[\u4e00-\u9fa5·]{2,4}$/.test(s));
    return names.length ? names.join('、') : raw.trim();
  };
  const tm = TEACHER_LABELED.exec(full);
  if (tm && tm[1].trim()) {
    teacher = expandTeacherList(tm[1]);
  } else {
    // 安大 style: trailing 2-4 char CJK name(s) after the location on a line.
    for (const ln of cell.text.split('\n')) {
      if (!/(楼|室|场|馆|球场)/.test(ln)) continue;
      // Multi-teacher tail: '…笃行北楼A楼[…]  王章银/王蓉蓉/尹晓峰/…'
      const multi = /(?:[　\s]|^)([\u4e00-\u9fa5]{2,4}(?:[/／][\u4e00-\u9fa5]{2,4}){1,})\s*$/.exec(ln);
      if (multi) {
        teacher = expandTeacherList(multi[1]);
        break;
      }
      const m2 = TRAILING_TEACHER.exec(ln);
      if (m2 && !isDayHeaderText(m2[1])) {
        teacher = m2[1];
        break;
      }
    }
    // 正方 wrapped form: teacher name lands BEFORE '教师:' across cells
    // (…沈进东 ends one cell, '/教学班:…' starts the next; the name prefix
    // form '程薇娟/教学班' also carries it before the label).
    if (!teacher) {
      const m3 = /(?:^|[\n/])([\u4e00-\u9fa5]{2,4})\/(?:教师|教学班)[:：]/.exec(full);
      if (m3) teacher = m3[1];
    }
  }

  // ---- location ----
  const addrParts: string[] = [];
  for (const rx of [CAMPUS_LABELED, BUILDING_LABELED, VENUE_LABELED]) {
    const mm = rx.exec(full);
    const v = mm?.[1]?.trim();
    if (v && v !== '无' && v !== '无楼号' && v !== '未排地点' && !addrParts.includes(v)) {
      addrParts.push(v);
    }
  }
  let location = addrParts.join(' ');
  if (!location) {
    // 安大 style: the detail line minus markers/period-paren/trailing teacher.
    for (const ln of cell.text.split('\n')) {
      if (!/(楼|室|场|馆|球场)/.test(ln)) continue;
      const loc = ln
        .replace(PERIOD_PAREN, '')
        .replace(MARKERS, '')
        .replace(/校区/g, ' ')
        // Strip a trailing teacher chain — a multi-teacher course lists
        // '王章银/王蓉蓉/…' after the location; that belongs to the teacher
        // field, not the address.
        .replace(/[　\s]+[\u4e00-\u9fa5]{2,4}(?:[/／][\u4e00-\u9fa5]{2,4})+\s*$/, '')
        .replace(TRAILING_TEACHER, '')
        .replace(/[(（][^)（）]*[)）]/g, '')
        .replace(/^[;；.。、:：\s]+|[;；.。、:：\s]+$/g, '')
        .trim();
      if (loc) {
        location = loc;
        break;
      }
    }
  }

  // ---- name ----
  let name: string | null = null;
  for (const ln of cell.text.split('\n')) {
    // Inline form: '电路与模拟电子技术★ (6-7节)1-3周,.../教师:安斯光/...'
    const seg = ln.split(/[/／]/)[0].split(/[(（]/)[0];
    const clean = seg
      .replace(CODE_ANY, '')
      .replace(MARKERS, '')
      .replace(/[　\s]+$/, '')
      .replace(/^[;；.。、:：\s]+|[;；.。、:：\s]+$/g, '')
      .trim();
    if (clean && !/^[A-Za-z0-9.\-\s]+$/.test(clean) && !DETAILISH.test(clean)) {
      name = clean;
      break;
    }
  }

  const main: CourseFields = {
    name: name ?? '未命名课程',
    startPeriod,
    endPeriod,
    periodsFromText,
    weeksSpec,
    teacher,
    location,
  };

  // ---- same-cell extra courses ----
  // The 安大 export can stack MULTIPLE courses in one merged cell, each with
  // its own name/code/(weeks)(periods) block ('…大学物理实验A…(6-9节)…' +
  // '…形势与政策…(18周)(8-10节)…'). Every course-code boundary after the
  // first starts a new course block; split and read each in turn.
  const out: CourseFields[] = [main];
  const codeMatches = [...full.matchAll(new RegExp(CODE_ANY.source, 'g'))];
  for (let ci = 1; ci < codeMatches.length; ci++) {
    const cut = codeMatches[ci].index ?? -1;
    const cutEnd = ci + 1 < codeMatches.length ? (codeMatches[ci + 1].index ?? full.length) : full.length;
    if (cut <= 0) continue;
    const blockText = full.slice(cut, cutEnd);
    const tm2 = PERIOD_PAREN.exec(blockText) ?? SINGLE_PERIOD_PAREN.exec(blockText);
    if (!tm2) continue;
    const extra: CourseFields = {
      name: '未命名课程',
      startPeriod: Number(tm2[1]),
      endPeriod: Number(tm2[2] ?? tm2[1]),
      periodsFromText: true,
      weeksSpec: null,
      teacher: null,
      location: '',
    };
    // Name: the paragraph BEFORE the code line within the PRECEDING text
    // (安大 stacks name / code / details per course), or the pre-code
    // segment of the code line itself (inline '形势与政策★2026...').
    const head = full.slice(0, cut);
    const lines2 = head.split('\n');
    const codeLineIdx = lines2.length - 1;
    let candidate = '';
    for (let li = codeLineIdx - 1; li >= 0; li--) {
      const seg = (lines2[li] ?? '').split(/[(（]/)[0];
      const clean = seg
        .replace(CODE_ANY, '')
        .replace(MARKERS, '')
        .replace(/[　\s]+$/, '')
        .replace(/^[;；.。、:：\s]+|[;；.。、:：\s]+$/g, '')
        .trim();
      if (clean && !/^[A-Za-z0-9.\-\s]+$/.test(clean) && !DETAILISH.test(clean)) {
        candidate = clean;
        break;
      }
    }
    if (!candidate) {
      const sameLine = (lines2[codeLineIdx] ?? '').split(/[(（]/)[0];
      const cleanSame = sameLine.replace(CODE_ANY, '').replace(MARKERS, '').trim();
      if (cleanSame && !/^[A-Za-z0-9.\-\s]+$/.test(cleanSame) && !DETAILISH.test(cleanSame)) {
        candidate = cleanSame;
      }
    }
    if (candidate) extra.name = candidate;
    // Weeks: parens content around the period marker, plus outside-paren
    // forms ('8周,14周') on the block's own text.
    const wm2 = WEEKS_IN_PAREN.exec(blockText);
    if (wm2 && !wm2[1].includes('节')) extra.weeksSpec = wm2[1].replace(/\s+/g, '');
    const blockOutside = blockText.replace(/[(（][^)（）]*[)）]/g, ' ');
    for (const m of blockOutside.matchAll(WEEKS_OUTSIDE)) {
      const spec = m[0].replace(/\s+/g, '');
      if (!extra.weeksSpec?.includes(spec)) {
        extra.weeksSpec = extra.weeksSpec ? `${extra.weeksSpec},${spec}` : spec;
      }
    }
    // Teacher: labeled or trailing form.
    const tt = TEACHER_LABELED.exec(blockText);
    if (tt && tt[1].trim()) {
      extra.teacher = expandTeacherList(tt[1]);
    } else {
      for (const ln of blockText.split('\n')) {
        if (!/(楼|室|场|馆|球场)/.test(ln)) continue;
        const multiT = /(?:[　\s]|^)([\u4e00-\u9fa5]{2,4}(?:[/／][\u4e00-\u9fa5]{2,4})+)\s*$/.exec(ln);
        if (multiT) {
          extra.teacher = expandTeacherList(multiT[1]);
          break;
        }
        const singleT = TRAILING_TEACHER.exec(ln);
        if (singleT && !isDayHeaderText(singleT[1])) {
          extra.teacher = singleT[1];
          break;
        }
      }
    }
    // Location: labeled parts in the block; when there are no labels
    // (安大's second block: '磬苑校区 博学北楼B101 吴万运'), fall back to
    // the unlabeled detail line minus markers/teacher.
    const blockAddr: string[] = [];
    for (const rx of [CAMPUS_LABELED, BUILDING_LABELED, VENUE_LABELED]) {
      const mm2 = rx.exec(blockText);
      const v = mm2?.[1]?.trim();
      if (v && v !== '无' && v !== '无楼号' && v !== '未排地点' && !blockAddr.includes(v)) {
        blockAddr.push(v);
      }
    }
    let blockLocation = blockAddr.join(' ');
    if (!blockLocation) {
      for (const ln of blockText.split('\n')) {
        if (!/(楼|室|场|馆|球场)/.test(ln)) continue;
        const loc = ln
          .replace(PERIOD_PAREN, '')
          .replace(MARKERS, '')
          .replace(/校区/g, ' ')
          .replace(/[　\s]+[\u4e00-\u9fa5]{2,4}(?:[/／][\u4e00-\u9fa5]{2,4})+\s*$/, '')
          .replace(TRAILING_TEACHER, '')
          .replace(/[(（][^)（）]*[)）]/g, '')
          .replace(/^[;；.。、:：\s]+|[;；.。、:：\s]+$/g, '')
          .trim();
        if (loc) {
          blockLocation = loc;
          break;
        }
      }
    }
    extra.location = blockLocation;
    out.push(extra);
  }

  return out;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Collect the period digits from the period column over every row the cell
 * covers (its anchor row plus its rowSpan reach, defensively extended).
 * Digits are isPeriodDigitText-gated (1..MAX_PERIOD), so the result is
 * bounded regardless of how large the reported rowSpan is.
 *
 * `placedCol` (the dense-grid column) must be strictly right of the period
 * column; the declared colIndex is unreliable (see readCourseCell).
 */
function scanCoveredPeriodDigits(
  grid: (GridCell | null)[][],
  layout: TableLayout,
  cell: GridCell,
  placedCol: number,
): number[] {
  const pc = layout.periodCol;
  if (pc === null || pc >= placedCol) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  const lastRow = Math.min(
    grid.length - 1,
    Math.max(
      cell.rowIndex + Math.max(1, cell.rowSpan ?? 1) - 1,
      cell.rowIndex,
    ),
  );
  for (let ri = cell.rowIndex; ri <= lastRow; ri++) {
    const a = grid[ri][pc];
    if (!a || !isPeriodDigitText(a.text)) continue;
    const n = Number(a.text.trim());
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.sort((x, y) => x - y);
}
