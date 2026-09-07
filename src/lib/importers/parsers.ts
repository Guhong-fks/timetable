import { TimeSlot, TIME_SLOT_META, WeekDay } from '@/types/timetable';

/** Pick the TimeSlot that best represents a `[start, end]` period range
 * coming out of the .docx parser. The slot is mainly a label/persistence key
 * for storage — authoritative positioning is driven by `course.startPeriod`
 * / `course.endPeriod` on `ScheduledCourse` — so the rules here are:
 *
 *  - If a slot meta exactly covers `[start, end]`, return it. This gives
 *    `1-2节 -> ONE_TWO`, `5-6节 -> FIVE_SIX`, `8节 -> EIGHT`, etc.
 *  - Otherwise return the slot whose `meta.start === start` so the key still
 *    identifies the *anchor* period (e.g. `5-7节 -> FIVE_SIX`). The renderer's
 *    `course.duration` / `course.endPeriod` carry the real span.
 *  - Unknown starts fall back to `TEN` so the course is still persisted and
 *    shown — the renderer treats it as best-effort. */
export function slot(start: number, end: number = start): TimeSlot {
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    const exact = (Object.entries(TIME_SLOT_META) as [TimeSlot, { start: number; end: number }][])
      .find(([, meta]) => meta.start === start && meta.end === end);
    if (exact) return exact[0];

    const anchor = (Object.entries(TIME_SLOT_META) as [TimeSlot, { start: number; end: number }][])
      .find(([, meta]) => meta.start === start);
    if (anchor) return anchor[0];
  }
  return TimeSlot.TEN;
}

const DAYS = [WeekDay.MONDAY, WeekDay.TUESDAY, WeekDay.WEDNESDAY, WeekDay.THURSDAY, WeekDay.FRIDAY, WeekDay.SATURDAY, WeekDay.SUNDAY];

/** Parse week pattern string into structured data.
 * Supports: "1-18周", "1~18周", "3,5,7周", "3-10周", "1,3-5,7周", "1-3-5周".
 * Returns full-semester flag or specific week numbers. */
export function parseWeekPattern(weeksStr: string): { weekPattern: 'full' | 'specific'; specificWeeks?: number[] } {
  // Single-pass token scan: each token is either a single week "N" or a range "A-B" / "A~B".
  // Range separators and single numbers are recognised by the same regex so the
  // scan position is unambiguous — no risk of a digit being claimed twice by
  // overlapping range + single patterns.
  const tokenPattern = /(\d+)(?:\s*[~-]\s*(\d+))?/g;
  const weeks = new Set<number>();

  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(weeksStr)) !== null) {
    const start = Number(match[1]);
    let end = match[2] !== undefined ? Number(match[2]) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    // Handle chained ranges like "1-3-5周": if another range delimiter
    // immediately follows, extend to the furthest reachable endpoint.
    let cursor = tokenPattern.lastIndex;
    while (true) {
      const tail = weeksStr.slice(cursor);
      const chained = tail.match(/^\s*[~-]\s*(\d+)/);
      if (!chained) break;
      end = Number(chained[1]);
      cursor += chained[0].length;
      tokenPattern.lastIndex = cursor;
    }

    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (let w = lo; w <= hi; w++) weeks.add(w);
  }

  const sorted = [...weeks].sort((a, b) => a - b);
  if (sorted.length === 0) return { weekPattern: 'specific', specificWeeks: [] };

  const isContinuous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  const isFullSemester = isContinuous && sorted[0] === 1 && sorted[sorted.length - 1] >= 18;

  return isFullSemester
    ? { weekPattern: 'full', specificWeeks: undefined }
    : { weekPattern: 'specific', specificWeeks: sorted };
}

/** Sanitize user input to prevent injection */
export function sanitizeInput(input: string): string {
  if (!input) return '';
  let sanitized = input.trim().slice(0, 1000);
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  sanitized = sanitized.replace(/[\u00A0\u2000-\u200F\u2028-\u202F\u205F\u3000]/g, ' ');
  return sanitized;
}

/** Parse a location line into a single address string + teacher name.
 * Address is the original string with the campus prefix and trailing teacher
 * removed (whitespace and common separators trimmed from both ends). Teacher
 * parsing supports compound surnames (e.g. 欧阳) and middle-dot-separated names
 * (e.g. 买买提·艾力). */
export function parseLocationAndTeacher(line: string): { campus: '磬苑校区' | '其他'; building: string; room: string; teacher: string } {
  // Recognize known campus prefixes. Anything else falls back to defaulting to
  // 磬苑校区 (kept for backward-compat) — but we no longer split it into the
  // result; the original address string is preserved verbatim.
  const campusMatch = line.match(/^(磬苑校区|其他校区|望岳校区|翠园校区)\s*/);
  const rawCampus = campusMatch?.[1] ?? '磬苑校区';
  const campus: '磬苑校区' | '其他' = rawCampus === '其他校区' ? '其他' : '磬苑校区';

  // The remainder is the address + teacher; we strip a trailing teacher but
  // never decompose the address itself.
  const afterCampus = line.replace(/^(磬苑校区|其他校区|望岳校区|翠园校区)\s*/, '').trim();

  if (!afterCampus) {
    return { campus, building: '未填写', room: '未填写', teacher: '未填写' };
  }

  // Teacher: a sequence of up to 8 Chinese chars / middle dots, optionally
  // followed by a title word at the end of the address line.
  const teacherPatterns = [
    // 老师|教授|... with or without leading name
    /^(?<address>.+?)[ \t]+(?<name>(?:[\u4e00-\u9fa5]{1,4}·)?[\u4e00-\u9fa5]{2,4}(?:老师|教授|副教授|讲师|助教|工程师|研究员|副研究员|高级工程师))$/,
    // Name only (no title)
    /^(?<address>.+?)[ \t]+(?<name>(?:[\u4e00-\u9fa5]{1,4}·)?[\u4e00-\u9fa5]{2,4})$/,
    // Compound surname without title, e.g. 欧阳娜娜
    /^(?<address>.+?)[ \t]+(?<name>(?:[\u4e00-\u9fa5]{1,4}·)?[\u4e00-\u9fa5]{2,6})$/,
  ];

  let address = afterCampus;
  let teacher = '未填写';

  for (const pattern of teacherPatterns) {
    const match = address.match(pattern);
    if (match?.groups) {
      address = match.groups.address.trim();
      teacher = sanitizeInput(match.groups.name.trim());
      break;
    }
  }

  // Trim leading/trailing separators (whitespace + common Chinese punctuation).
  address = address.replace(/^[\s、，,；;：:]+|[\s、，,；;：:]+$/g, '').trim();

  // Preserve backward-compat fields but they are no longer parsed from the input.
  // UI now reads only `course.location.address`.
  return {
    campus,
    building: address || '未填写',
    room: '未填写',
    teacher,
  };
}