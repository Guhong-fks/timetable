// =============================================================================
// ics-parser — universal .ics (iCalendar) timetable import
// -----------------------------------------------------------------------------
// Users export a timetable from another schedule app (WakeUp 超级课程表 /
// WakeUpSchedule etc.) "to calendar" and import the resulting .ics here.
// The source honours RFC 5545 (VCALENDAR/VEVENT/RRULE, unfolding, escaping),
// but the event shape varies by exporter, so parsing is shape-tiered:
//
//   Tier A (WakeUp dialect): SUMMARY=course name, DESCRIPTION =
//       "第X - Y节\nlocation\nteacher", LOCATION="location teacher".
//   Tier B (generic calendar): SUMMARY only — time resolution falls to the
//       app's period-times axis (user-configurable); periods default to 1-1.
//   Tier C: "第X-Y节" embedded in SUMMARY, or a "第X - Y节" line inside
//       DESCRIPTION (whitespace-tolerant — not WakeUp-locked).
//
// Week semantics (validated against a real 16-event WakeUp export):
//   * DTSTART fixes the weekday and the FIRST school week of the course.
//   * RRULE FREQ=WEEKLY expands the week list [startWeek .. lastOccWeek]
//     where the last occurrence is RFC-true: the latest DTSTART + k×7d×interval
//     instant that is ≤ UNTIL (occurrence instants compared in UTC; DTSTART
//     TZID=Asia/Shanghai and floating values are read as China wall clock,
//     UTC 'Z' values compare as exact instants). WakeUp writes UNTIL as
//     lastOccurrence + 6 days at 16:00Z, so date-part week mapping overshoots
//     by a week on Wed/Thu/Fri courses — instant arithmetic handles all 16
//     real events correctly.
//   * COUNT expands step-wise; a course recurring as several single-week
//     VEVENTs (WakeUp's non-weekly shape) merges into one course with a
//     unioned week list.
//   * School weeks need 学期开始日期 (week-1 Monday). Without it the whole
//     import degrades to weeks 1..DEFAULT with an explicit warning.
//   * BYDAY is ignored (weekly from DTSTART's own weekday).
//
// Pure JS, no native deps — works on Expo Go too (unlike the anydoc path).
// =============================================================================

import {
  WeekDay,
  DEFAULT_SEMESTER_WEEKS,
  type ScheduledCourse,
  type TimeSlot,
} from '@/types/timetable';
import { MAX_WEEK, type CourseWarning } from '@/lib/importers/parsers';
import { fallbackSlot, toScheduledCourse } from '@/lib/engine/recognizer';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface IcsDateTime {
  year: number;
  month: number; // 1-based
  day: number;
  hour: number | null; // null = DATE value (all-day)
  minute: number | null;
  /** True when the value carried the 'Z' (UTC) designator. */
  utc: boolean;
}

interface IcsEvent {
  summary: string;
  description: string;
  location: string;
  start: IcsDateTime;
  end: IcsDateTime | null;
  /** Raw RRULE payload, e.g. 'FREQ=WEEKLY;UNTIL=20270110T160000Z;INTERVAL=1'. */
  rrule: string | null;
}

interface IcsParseResult {
  courses: ScheduledCourse[];
  warnings: CourseWarning[];
  /**
   * Earliest timed DTSTART as 'YYYY-MM-DD' — the natural week-1 Monday the
   * school calendar almost always aligns with the first meeting date. The
   * import screen adopts this when the user has not set a semester start,
   * so the grid header shows dates immediately after an .ics import.
   */
  inferredSemesterStart: string | null;
}

// -----------------------------------------------------------------------------
// Content-line unfolding (RFC 5545 §3.1)
// -----------------------------------------------------------------------------

/** CRLF + space/HTAB = continuation of the previous line. */
export function unfoldIcsLines(raw: string): string[] {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const out: string[] = [];
  for (const line of normalized.split('\n')) {
    if (out.length > 0 && line.length > 0 && (line[0] === ' ' || line[0] === '\t')) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Content-line parsing
// -----------------------------------------------------------------------------

interface IcsProp {
  name: string; // upper-cased
  params: Record<string, string>;
  value: string;
}

/** Index of the first ':' outside double quotes. */
function findTopLevelColon(line: string): number {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ':' && !inQuotes) return i;
  }
  return -1;
}

/** Parse one content line into name/params/value. */
function parseContentLine(line: string): IcsProp | null {
  const colon = findTopLevelColon(line);
  if (colon === -1) return null;
  const nameAndParams = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semi = nameAndParams.indexOf(';');
  const name = (semi === -1 ? nameAndParams : nameAndParams.slice(0, semi)).trim();
  if (!name) return null;
  const params: Record<string, string> = {};
  if (semi !== -1) {
    let cur = '';
    let inQuotes = false;
    const parts: string[] = [];
    for (const ch of nameAndParams.slice(semi + 1)) {
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ';' && !inQuotes) {
        parts.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    parts.push(cur);
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      params[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
    }
  }
  return { name: name.toUpperCase(), params, value };
}

// -----------------------------------------------------------------------------
// Escaped-text unescaping (RFC 5545 §3.3.11)
// -----------------------------------------------------------------------------

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// -----------------------------------------------------------------------------
// Date-time parsing
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 3600 * 1000;
/** Asia/Shanghai offset — floating and TZID=Asia/Shanghai values are China
 * wall clock; UTC 'Z' values are exact instants. */
const CHINA_TZ_OFFSET_MS = 8 * 3600 * 1000;

/** DATE ('YYYYMMDD') or DATE-TIME ('YYYYMMDDTHHMMSS[Z]'). */
export function parseIcsDateTime(value: string): IcsDateTime | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v);
  if (!m) return null;
  const hasTime = m[4] !== undefined;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: hasTime ? Number(m[4]) : null,
    minute: hasTime ? Number(m[5]) : null,
    utc: m[7] === 'Z', // m[7] = Z flag (m[6] is the seconds group)
  };
}

/**
 * Exact epoch ms for a parsed value. 'Z' values are used as-is; floating /
 * TZID=Asia/Shanghai values are interpreted as China wall clock (the domain
 * assumption — Chinese timetable exporters). `endOfDay` promotes DATE values
 * (hour === null) to 23:59 for inclusive UNTIL boundaries.
 */
function icsToInstantMs(dt: IcsDateTime, endOfDay = false): number {
  const hour = dt.hour ?? (endOfDay ? 23 : 12);
  const minute = dt.minute ?? (endOfDay ? 59 : 0);
  const wallAsUtc = Date.UTC(dt.year, dt.month - 1, dt.day, hour, minute);
  return dt.utc ? wallAsUtc : wallAsUtc - CHINA_TZ_OFFSET_MS;
}

/** China wall-clock view of an instant (read with getUTC* on the shifted
 * date). Returns the calendar fields the course grid needs. */
function chinaWallView(instantMs: number): { year: number; month: number; day: number; weekday: number } {
  const d = new Date(instantMs + CHINA_TZ_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

// -----------------------------------------------------------------------------
// RRULE
// -----------------------------------------------------------------------------

interface IcsRrule {
  freq: string;
  interval: number;
  until: IcsDateTime | null;
  count: number | null;
}

export function parseIcsRrule(value: string): IcsRrule | null {
  const parts: Record<string, string> = {};
  for (const seg of value.split(';')) {
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    parts[seg.slice(0, eq).trim().toUpperCase()] = seg.slice(eq + 1).trim();
  }
  const freq = parts['FREQ'];
  if (!freq) return null;
  const intervalRaw = parts['INTERVAL'] ? Number(parts['INTERVAL']) : NaN;
  const countRaw = parts['COUNT'] ? Number(parts['COUNT']) : NaN;
  return {
    freq: freq.toUpperCase(),
    interval: Number.isFinite(intervalRaw) && intervalRaw >= 1 ? intervalRaw : 1,
    until: parts['UNTIL'] ? parseIcsDateTime(parts['UNTIL']) : null,
    count: Number.isFinite(countRaw) && countRaw >= 1 ? countRaw : null,
  };
}

/**
 * School week of the LAST occurrence (RFC-true): the latest start + k×7d×
 * interval instant ≤ UNTIL. DATE-form UNTIL counts as end-of-day. Returns
 * null when the rule never ends. COUNT-based rules expand step-wise without
 * a date boundary. Degenerate UNTIL (< start) yields the start week.
 */
export function rruleEndWeek(rule: IcsRrule, startWeek: number, startInstantMs: number): number | null {
  if (rule.count !== null) {
    return Math.min(MAX_WEEK, startWeek + (rule.count - 1) * rule.interval);
  }
  if (!rule.until) return null;
  const untilMs = icsToInstantMs(rule.until, rule.until.hour === null);
  if (untilMs < startInstantMs) return startWeek;
  const stepMs = 7 * DAY_MS * rule.interval;
  const k = Math.floor((untilMs - startInstantMs) / stepMs);
  return Math.min(MAX_WEEK, startWeek + k * rule.interval);
}

// -----------------------------------------------------------------------------
// VEVENT collection
// -----------------------------------------------------------------------------

/** Collect VEVENT blocks from unfolded content lines.
 *
 * Component-stack aware: WakeUp embeds VALARM inside each VEVENT, and the
 * alarm carries its own DESCRIPTION ("课名@地点") — reading event-level
 * props without depth tracking lets the alarm clobber the course's
 * DESCRIPTION (periods/location/teacher live there). Only direct children
 * of VEVENT are read. */
function collectEvents(lines: string[]): IcsEvent[] {
  const events: IcsEvent[] = [];
  const stack: string[] = [];
  let cur: IcsEvent | null = null;
  for (const line of lines) {
    if (!line) continue;
    const beginMatch = /^BEGIN:(.+)$/i.exec(line);
    if (beginMatch) {
      const comp = beginMatch[1].trim().toUpperCase();
      stack.push(comp);
      if (comp === 'VEVENT') {
        cur = {
          summary: '',
          description: '',
          location: '',
          start: { year: 1970, month: 1, day: 1, hour: 0, minute: 0, utc: false },
          end: null,
          rrule: null,
        };
      }
      continue;
    }
    const endMatch = /^END:(.+)$/i.exec(line);
    if (endMatch) {
      const comp = endMatch[1].trim().toUpperCase();
      if (comp === 'VEVENT' && cur) {
        events.push(cur);
        cur = null;
      }
      // Pop back to (and including) the matching BEGIN; tolerate mismatched
      // nesting by popping until the name is found or the stack empties.
      while (stack.length > 0 && stack.pop() !== comp) {
        /* keep popping */
      }
      continue;
    }
    if (!cur) continue;
    if (stack[stack.length - 1] !== 'VEVENT') continue; // inside VALARM etc.
    const prop = parseContentLine(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'SUMMARY':
        cur.summary = unescapeIcsText(prop.value).trim();
        break;
      case 'DESCRIPTION':
        cur.description = unescapeIcsText(prop.value);
        break;
      case 'LOCATION':
        cur.location = unescapeIcsText(prop.value).trim();
        break;
      case 'DTSTART': {
        const dt = parseIcsDateTime(prop.value);
        if (dt) cur.start = dt;
        break;
      }
      case 'DTEND': {
        const dt = parseIcsDateTime(prop.value);
        if (dt) cur.end = dt;
        break;
      }
      case 'RRULE':
        cur.rrule = prop.value.trim();
        break;
      default:
        break;
    }
  }
  return events;
}

// -----------------------------------------------------------------------------
// Period markers ("第X - Y节" / "第X-Y节" / "第X节")
// -----------------------------------------------------------------------------

const PERIOD_MARKER = /第\s*(\d{1,2})\s*(?:[-~～—–]\s*(\d{1,2})\s*)?节/;

interface PeriodSpan {
  start: number;
  end: number;
}

export function extractPeriodMarker(text: string): PeriodSpan | null {
  const m = PERIOD_MARKER.exec(text);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  if (end < start) return null;
  return { start, end };
}

/** Strip the period marker from a SUMMARY that embeds one. */
function stripPeriodMarker(summary: string): string {
  return summary.replace(PERIOD_MARKER, '').trim();
}

// -----------------------------------------------------------------------------
// LOCATION "地点 教师" split (Tier A)
// -----------------------------------------------------------------------------

/**
 * WakeUp's LOCATION is "<address> <teacher>": the address carries no CJK
 * (campus/building/room codes, brackets, '-'), the trailing CJK run is the
 * teacher; multi-teacher chains are joined by '/'. The teacher must start
 * after a non-CJK boundary so pure-CJK addresses keep their tail.
 */
export function splitLocationTeacher(location: string): { address: string; teacher: string | null } {
  const trimmed = location.trim();
  if (!trimmed) return { address: '', teacher: null };
  const m = /([\u4e00-\u9fa5][\u4e00-\u9fa5·]*(?:[/／][\u4e00-\u9fa5]{2,4})*)\s*$/.exec(trimmed);
  if (!m || m.index === 0) return { address: trimmed, teacher: null };
  const teacher = m[1].trim();
  const address = trimmed.slice(0, m.index).trim();
  if (!address) return { address: trimmed, teacher: null };
  // Normalise the multi-teacher separator to '、' — same display convention
  // as the docx import path (cellReader.expandTeacherList); '/' inside one
  // person's name does not occur in Chinese names.
  const normalized = teacher.includes('/') || teacher.includes('／')
    ? teacher.split(/[/／]/).map((s) => s.trim()).filter(Boolean).join('、')
    : teacher;
  return { address, teacher: normalized };
}

// -----------------------------------------------------------------------------
// Weekday mapping
// -----------------------------------------------------------------------------

const WEEKDAY_BY_INDEX: WeekDay[] = [
  WeekDay.SUNDAY, // chinaWallView().weekday = Date.getUTCDay(): 0
  WeekDay.MONDAY,
  WeekDay.TUESDAY,
  WeekDay.WEDNESDAY,
  WeekDay.THURSDAY,
  WeekDay.FRIDAY,
  WeekDay.SATURDAY,
];

// -----------------------------------------------------------------------------
// Week math (school weeks against the 学期开始日期 anchor)
// -----------------------------------------------------------------------------

/** Monday 00:00 (local) of the week containing `date`. */
function weekStartMonday(date: Date): number {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Wall-clock calendar date → 'YYYY-MM-DD' (zero-padded). */
function wallDateToIso(dt: IcsDateTime): string {
  const mm = String(dt.month).padStart(2, '0');
  const dd = String(dt.day).padStart(2, '0');
  return `${dt.year}-${mm}-${dd}`;
}

/** Parse 'YYYY-MM-DD' to the Monday of its week; null when malformed. */
export function weekAnchorFromIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return weekStartMonday(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** 1-based school week of a China wall-clock calendar date. */
export function weekOfWallDate(year: number, month: number, day: number, anchorMs: number): number {
  const diffWeeks = Math.round(
    (weekStartMonday(new Date(year, month - 1, day)) - anchorMs) / (7 * DAY_MS),
  );
  return diffWeeks + 1;
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

const MAX_ICS_EVENTS = 500;

/**
 * Parse .ics text into ScheduledCourses. `semesterStartDate` is the user-set
 * 'YYYY-MM-DD' of week-1 Monday; without it weeks degrade to 1..18 with an
 * explicit warning (the UI tells users to set it before importing).
 */
export function parseIcsTimetable(
  text: string,
  semesterStartDate: string | undefined,
): IcsParseResult {
  const warnings: CourseWarning[] = [];
  const events = collectEvents(unfoldIcsLines(text));
  if (!events.length) {
    warnings.push({
      category: 'cell',
      severity: 'error',
      message: '未在文件中找到日历事件（VEVENT），请确认是课程表软件导出的 .ics 文件',
      raw: text.slice(0, 200),
    });
    return { courses: [], warnings, inferredSemesterStart: null };
  }
  if (events.length > MAX_ICS_EVENTS) {
    warnings.push({
      category: 'cell',
      severity: 'warning',
      message: `事件数量超过 ${MAX_ICS_EVENTS}，已截断`,
      raw: String(events.length),
    });
    events.length = MAX_ICS_EVENTS;
  }

  const anchorMs = semesterStartDate ? weekAnchorFromIso(semesterStartDate) : null;
  if (semesterStartDate && anchorMs === null) {
    warnings.push({
      category: 'week',
      severity: 'info',
      message: `学期开始日期 ${semesterStartDate} 无效（需 YYYY-MM-DD），周次按 1-${DEFAULT_SEMESTER_WEEKS} 周处理`,
      raw: semesterStartDate,
    });
  }
  const noAnchor = anchorMs === null;

  // Earliest timed DTSTART (wall-clock) across events — the inferred
  // semester start. All-day events carry no meeting time and are skipped
  // (they also warn below).
  let earliest: IcsDateTime | null = null;
  for (const event of events) {
    if (event.start.hour === null) continue;
    if (!earliest || icsToInstantMs(event.start) < icsToInstantMs(earliest)) {
      earliest = event.start;
    }
  }
  const inferredSemesterStart = earliest ? wallDateToIso(earliest) : null;

  // Per-event drafts keyed for merging: the same course recurring as several
  // single-week VEVENTs (WakeUp's non-weekly shape) must become ONE course
  // with a unioned week list, not N duplicates.
  interface Draft {
    fields: {
      name: string;
      startPeriod: number;
      endPeriod: number;
      day: WeekDay;
      timeSlot: TimeSlot;
      location: string;
      teacher: string;
    };
    weeks: Set<number>;
  }
  const drafts = new Map<string, Draft>();

  for (const event of events) {
    const name = stripPeriodMarker(event.summary);
    if (!name) {
      warnings.push({
        category: 'cell',
        severity: 'warning',
        message: '跳过一个没有标题（SUMMARY）的事件',
        raw: (event.description || event.location).slice(0, 120),
      });
      continue;
    }
    if (event.start.hour === null) {
      warnings.push({
        category: 'period',
        severity: 'warning',
        message: `「${name}」是全天事件，未带上课时间，已跳过；如确有此课请在 App 内手动添加`,
        raw: event.summary,
      });
      continue;
    }

    // China wall-clock fields of the first occurrence.
    const startInstantMs = icsToInstantMs(event.start);
    const wall = chinaWallView(startInstantMs);
    const day = WEEKDAY_BY_INDEX[wall.weekday] ?? WeekDay.MONDAY;

    // Periods: Tier A DESCRIPTION marker → Tier C SUMMARY-embedded marker.
    const span = extractPeriodMarker(event.description) ?? extractPeriodMarker(event.summary);
    const startPeriod = span ? span.start : 1;
    const endPeriod = span ? span.end : 1;

    // Location/teacher: Tier A LOCATION split; DESCRIPTION line fallback.
    let address = '';
    let teacher: string | null = null;
    const locSplit = splitLocationTeacher(event.location);
    if (locSplit.address) {
      address = locSplit.address;
      teacher = locSplit.teacher;
    }
    if ((!address || teacher === null) && event.description) {
      const descLines = event.description
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      // Prefer the lines AFTER the "第X节" line (WakeUp shape); otherwise the
      // first non-marker line is the location, the next the teacher.
      const periodIdx = descLines.findIndex((l) => extractPeriodMarker(l) !== null);
      const locLine = periodIdx >= 0 ? (descLines[periodIdx + 1] ?? '') : (descLines[0] ?? '');
      const teacherLine = periodIdx >= 0 ? (descLines[periodIdx + 2] ?? '') : (descLines[1] ?? '');
      if (!address && locLine) address = locLine;
      if (teacher === null && teacherLine) teacher = teacherLine;
    }
    if (address === event.summary) address = '';

    // Without an anchor the week number is meaningless — drafts still carry
    // one so courses assemble; course.weekList below replaces it with 1..18.
    const startWeek = anchorMs === null ? 1 : weekOfWallDate(wall.year, wall.month, wall.day, anchorMs);
    if (startWeek > MAX_WEEK) {
      warnings.push({
        category: 'week',
        severity: 'warning',
        message: `「${name}」的上课日期距学期第一周超过 ${MAX_WEEK} 周，已跳过`,
        raw: event.summary,
      });
      continue;
    }

    // Week list from the recurrence: single meeting by default; RRULE
    // expands [startWeek .. last-occurrence week] with interval stepping.
    const weeks: number[] = [startWeek];
    if (event.rrule) {
      const rule = parseIcsRrule(event.rrule);
      if (rule && rule.freq === 'WEEKLY') {
        const endWeek = rruleEndWeek(rule, startWeek, startInstantMs);
        if (endWeek !== null) {
          weeks.length = 0;
          for (let w = startWeek; w <= endWeek; w += rule.interval) weeks.push(w);
        }
      }
    }
    let truncated = false;
    for (const w of weeks) {
      if (w > MAX_WEEK) {
        truncated = true;
        break;
      }
    }
    if (truncated) {
      warnings.push({
        category: 'week',
        severity: 'info',
        message: `「${name}」的重复规则超出 ${MAX_WEEK} 周，已截断`,
        raw: event.summary,
      });
    }

    const key = `${day}|${startPeriod}|${endPeriod}|${name}|${address}|${teacher ?? ''}`;
    let draft = drafts.get(key);
    if (!draft) {
      draft = {
        fields: { name, startPeriod, endPeriod, day, timeSlot: fallbackSlot(startPeriod), location: address, teacher: teacher ?? '' },
        weeks: new Set(),
      };
      drafts.set(key, draft);
    }
    for (const w of weeks) {
      if (w >= 1 && w <= MAX_WEEK) draft.weeks.add(w);
    }
  }

  if (noAnchor && events.length > 0) {
    warnings.push({
      category: 'week',
      severity: 'info',
      message: `未设置学期开始日期，无法换算周次：所有课程按第 1-${DEFAULT_SEMESTER_WEEKS} 周导入。请先在上方填写第一周周一的日期再重新导入，即可精确对齐`,
      raw: '',
    });
  }

  const courses: ScheduledCourse[] = [];
  const usedIds = new Set<string>();
  for (const draft of drafts.values()) {
    const f = draft.fields;
    const course = toScheduledCourse(
      {
        name: f.name,
        startPeriod: f.startPeriod,
        endPeriod: f.endPeriod,
        periodsFromText: true,
        weeksSpec: null, // weeks are set explicitly below
        teacher: f.teacher,
        location: f.location,
      },
      f.day,
    );
    if (!course) {
      warnings.push({
        category: 'period',
        severity: 'error',
        message: `「${f.name}」的节次 ${f.startPeriod}-${f.endPeriod} 超出支持范围 (1-13)，已跳过`,
        raw: f.name,
      });
      continue;
    }
    course.timeSlot = f.timeSlot;
    course.weekList = noAnchor
      ? Array.from({ length: DEFAULT_SEMESTER_WEEKS }, (_, i) => i + 1)
      : [...draft.weeks].sort((a, b) => a - b);
    // toScheduledCourse ids are `${day}-${start}-${end}-${name}` — two drafts
    // differing only by location/teacher would collide; disambiguate.
    if (usedIds.has(course.id)) {
      let n = 2;
      while (usedIds.has(`${course.id}-${n}`)) n++;
      course.id = `${course.id}-${n}`;
    }
    usedIds.add(course.id);
    courses.push(course);
  }

  return { courses, warnings, inferredSemesterStart };
}
