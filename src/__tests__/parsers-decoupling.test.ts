import {
  slot,
  parseWeekPattern,
  parseLocationAndTeacher,
  parseLocationAndTeacherDetailed,
  MIN_PERIOD,
  MAX_PERIOD,
} from '@/lib/importers/parsers';
import { TimeSlot } from '@/types/timetable';

describe('slot() — null-fallback contract', () => {
  it('returns null for periods out of [MIN_PERIOD, MAX_PERIOD]', () => {
    expect(MIN_PERIOD).toBe(1);
    expect(MAX_PERIOD).toBe(13);
    expect(slot(0, 0)).toBeNull();
    expect(slot(14, 14)).toBeNull();
    expect(slot(1, 14)).toBeNull(); // end overflow
    expect(slot(0, 5)).toBeNull();  // start under
  });

  it('returns null for non-finite input', () => {
    expect(slot(Number.NaN, 5)).toBeNull();
    expect(slot(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('returns null when end < start', () => {
    expect(slot(5, 4)).toBeNull();
    expect(slot(13, 1)).toBeNull();
  });

  it('still returns the exact TimeSlot for valid inputs', () => {
    expect(slot(1, 2)).toBe(TimeSlot.ONE_TWO);
    expect(slot(8, 8)).toBe(TimeSlot.EIGHT);
    expect(slot(5, 7)).toBe(TimeSlot.FIVE_SIX); // anchor match
  });
});

describe('parseWeekPattern() — warning emission', () => {
  it('returns no warnings for valid input', () => {
    const r = parseWeekPattern('1-18周');
    expect(r.warnings).toEqual([]);
  });

  it('warns on a single week number > MAX_WEEK', () => {
    const r = parseWeekPattern('30周');
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]?.category).toBe('week');
    expect(r.warnings[0]?.severity).toBe('warning');
    // 30 is rejected, so weekList is empty.
    expect(r.weekList).toEqual([]);
  });

  it('truncates a range whose upper bound exceeds MAX_WEEK', () => {
    const r = parseWeekPattern('20-30周');
    // The valid portion [20..25] is kept; 26..30 dropped.
    expect(r.weekList).toEqual([20, 21, 22, 23, 24, 25]);
    expect(r.warnings.some((w) => w.message.includes('上限'))).toBe(true);
  });

  it('warns on a range whose lower bound is below MIN_WEEK', () => {
    const r = parseWeekPattern('0-5周');
    expect(r.weekList).toEqual([1, 2, 3, 4, 5]);
    expect(r.warnings.some((w) => w.message.includes('下限'))).toBe(true);
  });

  it('emits a rawText echo', () => {
    const r = parseWeekPattern('1-8周 单周');
    expect(r.rawText).toBe('1-8周 单周');
  });
});

describe('parseLocationAndTeacherDetailed() — null teacher + raw address', () => {
  it('returns null teacher when no regex matches', () => {
    const r = parseLocationAndTeacherDetailed('磬苑校区 博学楼 B101');
    expect(r.teacher).toBeNull();
    expect(r.address).toBe('博学楼 B101');
    expect(r.confidence).toBe('low');
  });

  it('returns null teacher for an address with no campus prefix and no name', () => {
    const r = parseLocationAndTeacherDetailed('某栋某教室');
    expect(r.campus).toBe('unknown');
    expect(r.teacher).toBeNull();
    expect(r.address).toBe('某栋某教室');
  });

  it('returns "high" confidence when title-bearing name matches', () => {
    const r = parseLocationAndTeacherDetailed('磬苑校区 博学楼 B101 李欧阳老师');
    expect(r.teacher).toBe('李欧阳老师');
    expect(r.confidence).toBe('high');
  });

  it('returns "medium" confidence for NAME_ONLY match', () => {
    const r = parseLocationAndTeacherDetailed('磬苑校区 博学楼 B101 张老师');
    expect(r.teacher).toBe('张老师');
    expect(r.confidence).toBe('medium');
  });

  it('returns empty address for campus-only line', () => {
    const r = parseLocationAndTeacherDetailed('磬苑校区');
    expect(r.address).toBe('');
    expect(r.teacher).toBeNull();
  });
});

describe('parseLocationAndTeacher() — back-compat wrapper', () => {
  it('coerces null teacher to "未填写"', () => {
    const r = parseLocationAndTeacher('磬苑校区 博学楼 B101');
    expect(r.teacher).toBe('未填写');
  });

  it('coerces "unknown" campus to 磬苑校区 (legacy default)', () => {
    const r = parseLocationAndTeacher('某栋某教室');
    expect(r.campus).toBe('磬苑校区');
    expect(r.building).toBe('某栋某教室');
  });

  it('coerces empty address to "未填写"', () => {
    const r = parseLocationAndTeacher('磬苑校区');
    expect(r.building).toBe('未填写');
  });

  it('keeps existing title-bearing match unchanged', () => {
    const r = parseLocationAndTeacher('磬苑校区 博学楼 B101 张老师');
    expect(r.teacher).toBe('张老师');
    expect(r.building).toBe('博学楼 B101');
  });
});