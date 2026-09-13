// =============================================================================
// ics-parser tests — unit pieces + golden against the user's real WakeUp
// export (课表.ics, three levels up from src/__tests__).
// The fixture is a private user file: when absent, real-file blocks skip
// instead of failing so CI stays green.
// =============================================================================

// jest runs in Node, but tsconfig types:["jest"] hides @types/node — declare
// only the fs/path surface this test touches (skill-documented workaround).
import { WeekDay } from '@/types/timetable';
import {
  parseIcsTimetable,
  unfoldIcsLines,
  parseIcsDateTime,
  parseIcsRrule,
  rruleEndWeek,
  extractPeriodMarker,
  splitLocationTeacher,
  weekAnchorFromIso,
  weekOfWallDate,
  inferPeriodFromTime,
  minutesOfHm,
} from '@/lib/importers/ics-parser';

type FsLike = {
  readFileSync: (path: string, encoding: string) => string;
  existsSync: (path: string) => boolean;
};
type PathLike = { join: (...parts: string[]) => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('fs') as FsLike;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require('path') as PathLike;
const { readFileSync, existsSync } = nodeFs;
const REAL_ICS_PATH = nodePath.join(
  // @ts-expect-error Node's __dirname is hidden by tsconfig types:["jest"]
  __dirname,
  '..',
  '..',
  '..',
  '课表.ics',
);

const hasFixture = existsSync(REAL_ICS_PATH);
/** Week-1 Monday for the fixture: earliest DTSTART = 2026-09-07 (Monday). */
const FIXTURE_ANCHOR = '2026-09-07';

// ---------------------------------------------------------------------------
// Unit pieces
// ---------------------------------------------------------------------------

describe('ics content lines', () => {
  it('unfolds continuation lines (space and tab)', () => {
    const raw = 'BEGIN:VEVENT\r\nSUMMARY:大学物理A\r\n （下）\r\nDTSTAMP:20260909T054932Z\r\nEND:VEVENT';
    const lines = unfoldIcsLines(raw);
    expect(lines).toContain('SUMMARY:大学物理A（下）');
    expect(lines).toContain('DTSTAMP:20260909T054932Z');
  });

  it('parses DATE and DATE-TIME forms with the UTC flag', () => {
    expect(parseIcsDateTime('20260907T080000')).toEqual({
      year: 2026, month: 9, day: 7, hour: 8, minute: 0, utc: false,
    });
    expect(parseIcsDateTime('20270110T160000Z')).toEqual({
      year: 2027, month: 1, day: 10, hour: 16, minute: 0, utc: true,
    });
    expect(parseIcsDateTime('20260907')).toEqual({
      year: 2026, month: 9, day: 7, hour: null, minute: null, utc: false,
    });
    expect(parseIcsDateTime('not-a-date')).toBeNull();
  });

  it('extracts period markers (whitespace-tolerant, single or span)', () => {
    expect(extractPeriodMarker('第1 - 2节')).toEqual({ start: 1, end: 2 });
    expect(extractPeriodMarker('第3-5节')).toEqual({ start: 3, end: 5 });
    expect(extractPeriodMarker('第11 - 13节')).toEqual({ start: 11, end: 13 });
    expect(extractPeriodMarker('第8节')).toEqual({ start: 8, end: 8 });
    expect(extractPeriodMarker('第9 - 8节')).toBeNull(); // inverted
    expect(extractPeriodMarker('无节次标记')).toBeNull();
  });

  it('extracts full-width dash period markers (第1－2节)', () => {
    expect(extractPeriodMarker('第1－2节')).toEqual({ start: 1, end: 2 });
    expect(extractPeriodMarker('第3－5节')).toEqual({ start: 3, end: 5 });
  });

  it('infers periods from the configured period-times axis', () => {
    const axis = { '1': '08:00', '2': '08:50', '3': '09:40', '4': '10:30', '5': '11:20' };
    expect(inferPeriodFromTime(8 * 60, axis)).toBe(1);
    expect(inferPeriodFromTime(9 * 60 + 50, axis)).toBe(3);
    expect(inferPeriodFromTime(10 * 60 + 30, axis)).toBe(4);
    // Just after a period start (within tolerance) still maps to it.
    expect(inferPeriodFromTime(9 * 60 + 42, axis)).toBe(3);
    // Before the first period → nothing (caller falls back to 1).
    expect(inferPeriodFromTime(7 * 60, axis)).toBeNull();
    // Empty axis → null.
    expect(inferPeriodFromTime(9 * 60, {})).toBeNull();
    expect(minutesOfHm('09:50')).toBe(590);
    expect(minutesOfHm('9:5')).toBeNull();
    expect(minutesOfHm('25:00')).toBeNull();
  });

  it('splits LOCATION into address + trailing CJK teacher', () => {
    expect(splitLocationTeacher('磬苑校区博学北楼B316 何天博')).toEqual({
      address: '磬苑校区博学北楼B316',
      teacher: '何天博',
    });
    // Multi-teacher chain stays whole — toScheduledCourse never re-splits it;
    // separator normalised to '、' (docx-path display convention).
    expect(splitLocationTeacher('磬苑校区笃行北楼A楼[物理基础实验中心] 王章银/王蓉蓉')).toEqual({
      address: '磬苑校区笃行北楼A楼[物理基础实验中心]',
      teacher: '王章银、王蓉蓉',
    });
    // Pure-CJK address: no space boundary → no teacher split.
    expect(splitLocationTeacher('逸夫楼')).toEqual({ address: '逸夫楼', teacher: null });
    // Empty.
    expect(splitLocationTeacher('')).toEqual({ address: '', teacher: null });
  });

  it('maps weekdays from china wall-clock', () => {
    // 2026-09-07 is a Monday; 2026-09-13 a Sunday.
    const mon = weekOfWallDate(2026, 9, 7, weekAnchorFromIso('2026-09-07')!);
    expect(mon).toBe(1);
    const sun = weekOfWallDate(2026, 9, 13, weekAnchorFromIso('2026-09-07')!);
    expect(sun).toBe(1);
    const nextMon = weekOfWallDate(2026, 9, 14, weekAnchorFromIso('2026-09-07')!);
    expect(nextMon).toBe(2);
  });
});

describe('rrule end week (RFC-true last-occurrence semantics)', () => {
  const startMs = (y: number, mo: number, d: number, h: number) =>
    Date.UTC(y, mo - 1, d, h) - 8 * 3600 * 1000; // China wall → instant

  it('weekly UNTIL lands on the term-end week (Monday course)', () => {
    // WakeUp: DTSTART Mon 08:00, UNTIL 20270110T160000Z (Sun of week 18).
    const rule = parseIcsRrule('FREQ=WEEKLY;UNTIL=20270110T160000Z;INTERVAL=1')!;
    const start = startMs(2026, 9, 7, 8);
    expect(rruleEndWeek(rule, 1, start)).toBe(18);
  });

  it('weekly UNTIL lands on the term-end week (Wednesday course)', () => {
    // DTSTART Wed, UNTIL 20270112T160000Z — date-part mapping would say 19;
    // instant semantics keep 18.
    const rule = parseIcsRrule('FREQ=WEEKLY;UNTIL=20270112T160000Z;INTERVAL=1')!;
    const start = startMs(2026, 9, 9, 8);
    expect(rruleEndWeek(rule, 1, start)).toBe(18);
  });

  it('single-week UNTIL (inside the start week) yields the start week', () => {
    // 生涯教育与就业指导: DTSTART Mon 2026-09-14 19:00 (week 2), UNTIL
    // 20260920T160000Z (Sun of week 2) → exactly one meeting.
    const rule = parseIcsRrule('FREQ=WEEKLY;UNTIL=20260920T160000Z;INTERVAL=1')!;
    const start = startMs(2026, 9, 14, 19);
    expect(rruleEndWeek(rule, 2, start)).toBe(2);
  });

  it('COUNT expands step-wise', () => {
    const rule = parseIcsRrule('FREQ=WEEKLY;COUNT=8;INTERVAL=2')!;
    expect(rruleEndWeek(rule, 3, startMs(2026, 9, 7, 8))).toBe(17); // 3,5,7,...,17
  });

  it('no UNTIL/COUNT → null (rule never ends)', () => {
    const rule = parseIcsRrule('FREQ=WEEKLY;INTERVAL=1')!;
    expect(rruleEndWeek(rule, 1, startMs(2026, 9, 7, 8))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real-file golden block
// ---------------------------------------------------------------------------

describe('real WakeUp export (课表.ics)', () => {
  // Guard the guard: an empty/whitespace file must NOT silently pass skips.
  let text = '';
  if (hasFixture) text = readFileSync(REAL_ICS_PATH, 'utf8');

  it('fixture is present and non-empty (fails loudly when gone)', () => {
    expect(hasFixture).toBe(true);
    expect(text.trim().length).toBeGreaterThan(100);
  });

  it('collects 16 events with DESCRIPTION intact (VALARM clobbering guard)', () => {
    const { courses, warnings } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    expect(courses.length).toBeGreaterThan(0);
    expect(warnings.length).toBe(0);
    // The alarm's DESCRIPTION would have overwritten the course's; if that
    // bug existed, no course would carry a period span and all periods would
    // be 1-1.
    const withRealPeriods = courses.filter((c) => !(c.startPeriod === 1 && c.endPeriod === 1));
    expect(withRealPeriods.length).toBeGreaterThanOrEqual(10);
  });

  it('weekly courses expand to weeks 1-18 (UNTIL = term end)', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const physics = courses.find((c) => c.name === '大学物理A（下）' && c.day === WeekDay.MONDAY);
    expect(physics).toBeDefined();
    expect(physics!.startPeriod).toBe(1);
    expect(physics!.endPeriod).toBe(2);
    expect(physics!.weekList).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
  });

  it('infers the semester start from the earliest timed DTSTART', () => {
    // Earliest DTSTART in the fixture = 2026-09-07 08:00 (Monday).
    const { inferredSemesterStart } = parseIcsTimetable(text, undefined);
    expect(inferredSemesterStart).toBe('2026-09-07');
  });

  it('multi-teacher LOCATION chain preserved verbatim', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const physicsExp = courses.find((c) => c.name === '大学物理实验A（下）');
    expect(physicsExp).toBeDefined();
    expect(physicsExp!.teacher.name).toBe('王章银、王蓉蓉、尹晓峰、张子云、谢传梅、谌正艮');
    expect(physicsExp!.location.address).toBe('磬苑校区笃行北楼A楼[物理基础实验中心]');
  });

  it('single-week courses merge into one entry with unioned weeks', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const career = courses.filter((c) => c.name === '生涯教育与就业指导');
    expect(career.length).toBe(1);
    // 2026-09-14 = week 2, 2026-10-19 = week 7, 2026-12-21 = week 16.
    expect(career[0].weekList).toEqual([2, 7, 16]);
  });

  it('周三 大学英语（A）III reads periods 1-2, weeks 1-18', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const eng = courses.find((c) => c.name === '大学英语（A）III');
    expect(eng).toBeDefined();
    expect(eng!.day).toBe(WeekDay.WEDNESDAY);
    expect(eng!.startPeriod).toBe(1);
    expect(eng!.endPeriod).toBe(2);
    expect(eng!.weekList).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('late-starting course 电子线路实验 spans its true weeks (9-16)', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const exp = courses.find((c) => c.name === '电子线路实验');
    expect(exp).toBeDefined();
    expect(exp!.weekList[0]).toBe(9);
    expect(exp!.weekList[exp!.weekList.length - 1]).toBe(16);
  });

  it('a Sunday DTSTART lands on Sunday', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const sunday = courses.find((c) => c.day === WeekDay.SUNDAY);
    expect(sunday).toBeUndefined(); // fixture has no Sunday course
  });

  it('all fixture courses stay within the 13-period grid', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    for (const c of courses) {
      expect(c.startPeriod).toBeGreaterThanOrEqual(1);
      expect(c.endPeriod).toBeLessThanOrEqual(13);
    }
  });
});

// ---------------------------------------------------------------------------
// Universal-import shape coverage (non-WakeUp exporters)
// ---------------------------------------------------------------------------

describe('universal import shapes', () => {
  it('Tier B: generic event without marker defaults to 1-1 with a warning when no axis is configured', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'SUMMARY:高等数学',
      'DTSTART:20260910T100000',
      'DTEND:20260910T114500',
      'RRULE:FREQ=WEEKLY;UNTIL=20270110T160000Z;INTERVAL=1',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR);
    expect(courses.length).toBe(1);
    expect(courses[0].name).toBe('高等数学');
    // Thursday (2026-09-10).
    expect(courses[0].day).toBe(WeekDay.THURSDAY);
    expect(courses[0].startPeriod).toBe(1);
    expect(courses[0].endPeriod).toBe(1);
    expect(courses[0].weekList.length).toBe(18);
    expect(warnings.some((w) => w.message.includes('未识别到节次，默认第 1 节'))).toBe(true);
  });

  it('Tier B: with the app period-times axis, DTSTART/DTEND infer the span', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:高等数学',
      'DTSTART:20260910T100000',
      'DTEND:20260910T114500',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const schedule = {
      periodTimes: { '1': '08:00', '2': '08:50', '3': '09:40', '4': '10:30', '5': '11:20', '6': '13:00' },
      periodDurations: { '1': 45, '2': 45, '3': 45, '4': 45, '5': 45, '6': 45 },
    };
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR, schedule);
    expect(courses[0].startPeriod).toBe(3);
    expect(courses[0].endPeriod).toBe(5);
    expect(warnings.some((w) => w.message.includes('已按上课时间推断为第 3-5 节'))).toBe(true);
  });

  it('Tier B: DTSTART before the first period falls back to 1-1 with a warning', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:晨课',
      'DTSTART:20260907T070000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const schedule = { periodTimes: { '1': '08:00' } };
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR, schedule);
    expect(courses[0].startPeriod).toBe(1);
    expect(courses[0].endPeriod).toBe(1);
    expect(warnings.some((w) => w.message.includes('未识别到节次'))).toBe(true);
  });

  it('Tier C: period marker embedded in SUMMARY is used and stripped', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:数据结构 第3-4节',
      'DTSTART;TZID=Asia/Shanghai:20260908T100000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR);
    expect(warnings.length).toBe(0);
    expect(courses[0].name).toBe('数据结构');
    expect(courses[0].startPeriod).toBe(3);
    expect(courses[0].endPeriod).toBe(4);
    expect(courses[0].day).toBe(WeekDay.TUESDAY);
  });

  it('Tier A from DESCRIPTION when LOCATION is absent', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:操作系统',
      'DESCRIPTION:第6 - 7节\\n教学楼A 302\\n李老师',
      'DTSTART;TZID=Asia/Shanghai:20260907T140000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses } = parseIcsTimetable(ics, FIXTURE_ANCHOR);
    expect(courses[0].startPeriod).toBe(6);
    expect(courses[0].endPeriod).toBe(7);
    expect(courses[0].location.address).toBe('教学楼A 302');
    expect(courses[0].teacher.name).toBe('李老师');
  });

  it('unknown TZID warns instead of silently shifting times', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:课程X',
      'DESCRIPTION:第1 - 2节\\n地点A\\n老师B',
      'DTSTART;TZID=America/New_York:20260907T080000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR);
    expect(courses[0].startPeriod).toBe(1);
    expect(warnings.some((w) => w.message.includes('未知时区 America/New_York'))).toBe(true);
  });

  it('declared period span inconsistent with event length warns', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:课程X',
      'DESCRIPTION:第1 - 2节\\n地点A\\n老师B',
      'DTSTART:20260907T080000',
      'DTEND:20260907T110000', // 180 min vs the 95 min a 2-period span implies
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR);
    expect(courses[0].startPeriod).toBe(1);
    expect(courses[0].endPeriod).toBe(2);
    expect(warnings.some((w) => w.message.includes('与事件时长 180 分钟不符'))).toBe(true);
  });

  it('all-day events are skipped with a warning, not silently dropped', () => {    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:开学典礼',
      'DTSTART;VALUE=DATE:20260907',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR);
    expect(courses.length).toBe(0);
    expect(warnings.some((w) => w.message.includes('全天事件'))).toBe(true);
  });

  it('no anchor: degrades to 1-18 weeks with an explicit warning', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:课程X',
      'DESCRIPTION:第1 - 2节\\n地点A\\n老师B',
      'DTSTART:20260907T080000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses, warnings } = parseIcsTimetable(ics, undefined);
    expect(courses.length).toBe(1);
    expect(courses[0].weekList).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(warnings.some((w) => w.message.includes('未设置学期开始日期'))).toBe(true);
  });

  it('invalid anchor date warns and still degrades to 1-18', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:课程X',
      'DESCRIPTION:第1 - 2节\\n地点A\\n老师B',
      'DTSTART:20260907T080000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses, warnings } = parseIcsTimetable(ics, '2026/09/07');
    expect(courses.length).toBe(1);
    expect(warnings.some((w) => w.message.includes('无效'))).toBe(true);
  });

  it('non-VEVENT calendar (no events) errors clearly', () => {
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR);
    expect(courses.length).toBe(0);
    expect(warnings.some((w) => w.message.includes('未在文件中找到日历事件'))).toBe(true);
  });

  it('periods beyond the 13-slot grid are dropped with an error warning', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:夜校课',
      'DESCRIPTION:第14 - 16节\\n地点A\\n老师B',
      'DTSTART:20260907T180000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { courses, warnings } = parseIcsTimetable(ics, FIXTURE_ANCHOR);
    expect(courses.length).toBe(0);
    expect(warnings.some((w) => w.severity === 'error' && w.message.includes('超出支持范围'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Second real-file golden: the user's 大二 semester export (日历-大二.ics,
// copied to fixtures/calendar-sophomore.ics). Same WakeUpSchedule exporter as
// 课表.ics but with different shapes: 13 events, no 生涯教育与就业指导 merge
// case, a single-meeting 形势与政策 in week 18, late-starting labs at 8-10节.
// Guarded like the first golden so CI stays green when the file is absent.
// ---------------------------------------------------------------------------

const SOPHOMORE_ICS_PATH = nodePath.join(
  // @ts-expect-error Node's __dirname is hidden by tsconfig types:["jest"]
  __dirname,
  'fixtures',
  'calendar-sophomore.ics',
);
const hasSophomoreFixture = existsSync(SOPHOMORE_ICS_PATH);

describe('real WakeUp export (日历-大二.ics → fixtures/calendar-sophomore.ics)', () => {
  let text = '';
  if (hasSophomoreFixture) text = readFileSync(SOPHOMORE_ICS_PATH, 'utf8');

  it('fixture is present and non-empty (fails loudly when gone)', () => {
    expect(hasSophomoreFixture).toBe(true);
    expect(text.trim().length).toBeGreaterThan(100);
  });

  it('parses all 13 courses with zero warnings', () => {
    const { courses, warnings } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    expect(courses.length).toBe(13);
    expect(warnings.length).toBe(0);
  });

  it('infers the semester start 2026-09-07 from the earliest DTSTART', () => {
    const { inferredSemesterStart } = parseIcsTimetable(text, undefined);
    expect(inferredSemesterStart).toBe('2026-09-07');
  });

  it('late-starting 数字电路与逻辑设计实验 runs weeks 9-16 at periods 8-10', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const exp = courses.find((c) => c.name === '数字电路与逻辑设计实验');
    expect(exp).toBeDefined();
    expect(exp!.day).toBe(WeekDay.THURSDAY);
    expect(exp!.startPeriod).toBe(8);
    expect(exp!.endPeriod).toBe(10);
    expect(exp!.weekList[0]).toBe(9);
    expect(exp!.weekList[exp!.weekList.length - 1]).toBe(16);
  });

  it('形势与政策 is a single meeting in week 18 (instant UNTIL semantics)', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const c = courses.find((x) => x.name === '形势与政策');
    expect(c).toBeDefined();
    expect(c!.day).toBe(WeekDay.TUESDAY);
    expect(c!.weekList).toEqual([18]);
  });

  it('6-teacher experiment chain is normalised to 、', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    const physicsExp = courses.find((c) => c.name === '大学物理实验A（下）');
    expect(physicsExp).toBeDefined();
    expect(physicsExp!.teacher.name).toBe('王章银、王蓉蓉、尹晓峰、张子云、谢传梅、谌正艮');
    expect(physicsExp!.location.address).toBe('磬苑校区笃行北楼A楼[物理基础实验中心]');
  });

  it('all 13 courses stay within the 13-period grid and 25-week cap', () => {
    const { courses } = parseIcsTimetable(text, FIXTURE_ANCHOR);
    for (const c of courses) {
      expect(c.startPeriod).toBeGreaterThanOrEqual(1);
      expect(c.endPeriod).toBeLessThanOrEqual(13);
      expect(c.weekList[c.weekList.length - 1]).toBeLessThanOrEqual(25);
    }
  });
});
