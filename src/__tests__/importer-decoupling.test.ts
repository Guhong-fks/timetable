import {
  extractBlocksFromCell,
  normaliseBlock,
  type RawCourseBlock,
  type NormaliseContext,
} from '@/lib/importers/blocks';
import { WeekDay } from '@/types/timetable';
import type { CourseWarning } from '@/lib/importers/parsers';
import { createBuiltInParserChain } from '@/lib/parsers/ParserChain';

describe('extractBlocksFromCell — RawCourseBlock pipeline', () => {
  const chain = createBuiltInParserChain();

  it('emits one block per course code line in the same cell', () => {
    const text = [
      '计算机基础',
      '202420241-CS10001.001',
      '(1-16周)(1-2节) 磬苑校区 博学楼 A205 李教授',
      '(1-16周)(1-2节) 磬苑校区 博学楼 A206 王副教授',
    ].join('\n');
    const blocks = extractBlocksFromCell(text, chain);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.name).toBe('计算机基础');
    expect(blocks[0]?.schedule).toEqual({ weeks: '1-16周', start: 1, end: 2 });
    expect(blocks[0]?.location).toContain('李教授');
    expect(blocks[1]?.location).toContain('王副教授');
  });

  it('falls back to name-only blocks when no course code is present', () => {
    // P1 strategy chain: no code ⇒ FallbackParser yields a name-only block
    // per remaining line. The normaliser downstream decides whether the
    // block is usable; here we just pin the new contract.
    const blocks = extractBlocksFromCell('纯文本课程介绍\n没有代码', chain);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.name).toBe('纯文本课程介绍');
    expect(blocks[0]?.schedule).toBeUndefined();
    expect(blocks[1]?.name).toBe('没有代码');
  });

  it('still emits a block when the schedule line is malformed (no schedule field)', () => {
    const text = [
      '孤立的课程',
      '202420241-CS99999.999',
      'THIS LINE IS NOT A SCHEDULE',
    ].join('\n');
    const blocks = extractBlocksFromCell(text, chain);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.schedule).toBeUndefined();
    expect(blocks[0]?.location).toBe('THIS LINE IS NOT A SCHEDULE');
  });
});

describe('normaliseBlock — per-field failure isolation', () => {
  const ctx = (warnings: CourseWarning[]): NormaliseContext => ({
    day: WeekDay.MONDAY,
    rowIndex: 1,
    colIndex: 2,
    warnings,
  });

  it('drops the block but emits a `cell` warning when schedule is missing', () => {
    const warnings: CourseWarning[] = [];
    const block: RawCourseBlock = {
      source: { lineIndex: 0, raw: '202420241-CS99999.999' },
      name: '孤立课程',
      location: 'somewhere',
    };
    const course = normaliseBlock(block, ctx(warnings));
    expect(course).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toBe('cell');
    expect(warnings[0]?.severity).toBe('warning');
  });

  it('drops the block and emits a `period` error when periods are out of range', () => {
    const warnings: CourseWarning[] = [];
    const block: RawCourseBlock = {
      source: { lineIndex: 0, raw: '202420241-CS99999.999' },
      name: '越界课程',
      schedule: { weeks: '1-18周', start: 14, end: 15 },
    };
    const course = normaliseBlock(block, ctx(warnings));
    expect(course).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toBe('period');
    expect(warnings[0]?.severity).toBe('error');
    expect(warnings[0]?.message).toContain('越界');
  });

  it('emits a `teacher` warning when no teacher regex matches', () => {
    const warnings: CourseWarning[] = [];
    const block: RawCourseBlock = {
      source: { lineIndex: 0, raw: '...' },
      name: '无师课程',
      schedule: { weeks: '1-18周', start: 1, end: 2 },
      location: '磬苑校区 博学楼 B101',
    };
    const course = normaliseBlock(block, ctx(warnings));
    expect(course).not.toBeNull();
    // Per #3: empty string is persisted; UI applies '未填写' at render.
    expect(course?.teacher.name).toBe('');
    const teacherWarnings = warnings.filter((w) => w.category === 'teacher');
    expect(teacherWarnings).toHaveLength(1);
  });

  it('emits a `week` warning when weeks exceed MAX_WEEK', () => {
    const warnings: CourseWarning[] = [];
    const block: RawCourseBlock = {
      source: { lineIndex: 0, raw: '...' },
      name: '长学期课程',
      schedule: { weeks: '1-30周', start: 1, end: 2 },
      location: '磬苑校区 博学楼 B101 张老师',
    };
    normaliseBlock(block, ctx(warnings));
    expect(warnings.some((w) => w.category === 'week')).toBe(true);
  });

  it('happy path: returns a ScheduledCourse with no warnings', () => {
    const warnings: CourseWarning[] = [];
    const block: RawCourseBlock = {
      source: { lineIndex: 0, raw: '...' },
      name: '高等数学',
      schedule: { weeks: '1-18周', start: 1, end: 2 },
      location: '磬苑校区 博学楼 B101 张老师',
    };
    const course = normaliseBlock(block, ctx(warnings));
    expect(course).not.toBeNull();
    expect(course?.name).toBe('高等数学');
    expect(course?.day).toBe(WeekDay.MONDAY);
    expect(course?.startPeriod).toBe(1);
    expect(course?.endPeriod).toBe(2);
    expect(course?.weekList.length).toBe(18);
    expect(course?.isOddEven).toBeNull();
    expect(warnings).toEqual([]);
  });
});