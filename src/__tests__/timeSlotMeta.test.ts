import { computeMaxPeriods, DEFAULT_MAX_PERIODS, getTimeSlotMeta, sanitizeCourses, TimeSlot } from '@/types/timetable';
import type { ScheduledCourse } from '@/types/timetable';

describe('getTimeSlotMeta', () => {
  it('returns meta for current slot keys', () => {
    expect(getTimeSlotMeta(TimeSlot.EIGHT)?.start).toBe(8);
    expect(getTimeSlotMeta(TimeSlot.ELEVEN)?.start).toBe(11);
    expect(getTimeSlotMeta(TimeSlot.TWELVE)?.start).toBe(12);
    expect(getTimeSlotMeta(TimeSlot.THIRTEEN)?.start).toBe(13);
  });

  it('returns legacy meta for the pre-split "11-13" key', () => {
    const meta = getTimeSlotMeta('11-13');
    expect(meta).not.toBeNull();
    expect(meta?.start).toBe(11);
    expect(meta?.end).toBe(13);
    expect(meta?.duration).toBe(3);
  });

  it('returns null for unknown keys', () => {
    expect(getTimeSlotMeta('99')).toBeNull();
    expect(getTimeSlotMeta('')).toBeNull();
  });
});

describe('computeMaxPeriods', () => {
  const base = (overrides: Partial<ScheduledCourse>): ScheduledCourse => ({
    id: 'x', name: 'x', day: 'Monday' as any, timeSlot: TimeSlot.ONE_TWO,
    startPeriod: 1, endPeriod: 2, duration: 2,
    location: { address: '博学楼 B101' },
    teacher: { name: 't' }, weekList: [1, 2, 3], isOddEven: null,
    ...overrides,
  });

  it('renders the ACTUAL max end period — a 12-period timetable shows 12 rows', () => {
    const courses = [
      base({ timeSlot: TimeSlot.EIGHT, startPeriod: 8, endPeriod: 8, duration: 1 }),
      base({ timeSlot: TimeSlot.TWELVE, startPeriod: 12, endPeriod: 12, duration: 1 }),
    ];
    expect(computeMaxPeriods(courses)).toBe(12);
  });

  it('non-standard spans drive the row count (7-9节 -> endPeriod=9 -> 9 rows)', () => {
    const courses = [
      base({ timeSlot: TimeSlot.SEVEN_EIGHT, startPeriod: 7, endPeriod: 9, duration: 3 }),
    ];
    expect(computeMaxPeriods(courses)).toBe(9);
  });

  it('clamps to the 13-period ceiling (5-13节 -> 13 rows)', () => {
    const courses = [
      base({ timeSlot: TimeSlot.FIVE_SIX, startPeriod: 5, endPeriod: 13, duration: 9 }),
    ];
    expect(computeMaxPeriods(courses)).toBe(13);
  });

  it('legacy "11-13" data is read through meta (13 rows)', () => {
    const courses = [base({ timeSlot: '11-13' as any, startPeriod: undefined as any, endPeriod: undefined as any })];
    expect(computeMaxPeriods(courses)).toBe(13);
  });

  it('drops courses whose timeSlot cannot be resolved — nothing left -> default', () => {
    const courses = [base({ timeSlot: '99' as any, startPeriod: undefined as any, endPeriod: undefined as any })];
    expect(computeMaxPeriods(courses)).toBe(DEFAULT_MAX_PERIODS);
  });

  it('no courses at all -> default', () => {
    expect(computeMaxPeriods([])).toBe(DEFAULT_MAX_PERIODS);
  });

  it('falls back to slot meta when positional fields are absent (5-6 -> 6 rows)', () => {
    const courses = [base({ timeSlot: TimeSlot.FIVE_SIX, startPeriod: undefined as any, endPeriod: undefined as any })];
    expect(computeMaxPeriods(courses)).toBe(6);
  });
});

describe('sanitizeCourses', () => {
  const validCourse = {
    id: 'Monday-0-0',
    name: '测试课',
    day: 'Monday',
    timeSlot: TimeSlot.ONE_TWO,
    startPeriod: 1,
    endPeriod: 2,
    duration: 2,
    location: { address: '博学楼 B101' },
    teacher: { name: 't' },
    weekList: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    isOddEven: null,
  };

  it('returns [] for non-array input', () => {
    expect(sanitizeCourses(null)).toEqual([]);
    expect(sanitizeCourses({})).toEqual([]);
    expect(sanitizeCourses('x')).toEqual([]);
  });

  it('strips `code` and `classes` (v3 schema)', () => {
    const legacy = {
      ...validCourse,
      code: '2024-CS101.001',
      classes: [{ grade: '22级', major: '计算机' }],
    };
    const [out] = sanitizeCourses([legacy]);
    expect(out).not.toHaveProperty('code');
    expect(out).not.toHaveProperty('classes');
    expect(out.id).toBe('Monday-0-0');
    expect(out.timeSlot).toBe(TimeSlot.ONE_TWO);
  });

  it('keeps legacy timeSlot "11-13" via getTimeSlotMeta fallback', () => {
    const legacy = { ...validCourse, timeSlot: '11-13' };
    const [out] = sanitizeCourses([legacy]);
    expect(out).toBeDefined();
    expect(out.timeSlot).toBe('11-13');
  });

  it('drops courses with unknown timeSlot', () => {
    const bad = { ...validCourse, timeSlot: '99' };
    expect(sanitizeCourses([bad])).toEqual([]);
  });

  it('drops non-object entries', () => {
    expect(sanitizeCourses([null, undefined, 1, 'x', validCourse])).toHaveLength(1);
  });

  it('coerces legacy location {campus, building, room} into {address}', () => {
    const legacy = {
      ...validCourse,
      location: { campus: '磬苑校区', building: '博学楼', room: 'B101' },
    };
    const [out] = sanitizeCourses([legacy]);
    expect(out.location).toEqual({ address: '磬苑校区 博学楼 B101' });
  });

  it('filters "未填写" placeholder from legacy joined address', () => {
    const legacy = {
      ...validCourse,
      location: { campus: '磬苑校区', building: '博学楼', room: '未填写' },
    };
    const [out] = sanitizeCourses([legacy]);
    expect(out.location.address).toBe('磬苑校区 博学楼');
  });

  it('prefers new {address} over legacy fields when both are present', () => {
    const mixed = {
      ...validCourse,
      location: { address: '望岳校区 笃行楼 C303', campus: 'ignored', building: 'ignored', room: 'ignored' },
    };
    const [out] = sanitizeCourses([mixed]);
    expect(out.location.address).toBe('望岳校区 笃行楼 C303');
  });

  it('recomputes endPeriod from stored duration when only meta + duration are present (legacy 5-7节 persisted as FIVE_SIX with duration=3)', () => {
    // Simulates a pre-fix import persisted as timeSlot=FIVE_SIX, duration=3.
    // After sanitize: startPeriod=5, endPeriod=7, duration=3.
    const legacy = {
      ...validCourse,
      timeSlot: TimeSlot.FIVE_SIX as string,
      duration: 3,
    };
    // Strip the explicit startPeriod/endPeriod we set in validCourse for
    // this test so we exercise the recovery path.
    delete (legacy as any).startPeriod;
    delete (legacy as any).endPeriod;
    const [out] = sanitizeCourses([legacy]);
    expect(out).toBeDefined();
    expect(out.startPeriod).toBe(5);
    expect(out.endPeriod).toBe(7);
    expect(out.duration).toBe(3);
  });

  it('preserves explicit startPeriod/endPeriod over meta + duration', () => {
    const explicit = {
      ...validCourse,
      timeSlot: TimeSlot.FIVE_SIX as string,
      duration: 2,
      startPeriod: 5,
      endPeriod: 7,
    };
    const [out] = sanitizeCourses([explicit]);
    expect(out.startPeriod).toBe(5);
    expect(out.endPeriod).toBe(7);
    expect(out.duration).toBe(3);
  });
});