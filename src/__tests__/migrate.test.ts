import { migrateToV4, EMPTY_SNAPSHOT, safeParse } from '@/state/timetable/migrate';

describe('migrate', () => {
  describe('migrateToV4', () => {
    it('returns EMPTY_SNAPSHOT for null/undefined input', () => {
      expect(migrateToV4(null)).toEqual(EMPTY_SNAPSHOT);
      expect(migrateToV4(undefined)).toEqual(EMPTY_SNAPSHOT);
    });

    it('returns EMPTY_SNAPSHOT for non-object input', () => {
      expect(migrateToV4('not-an-object')).toEqual(EMPTY_SNAPSHOT);
      expect(migrateToV4(42)).toEqual(EMPTY_SNAPSHOT);
    });

    it('preserves a valid v4 payload and drops lastReport (always undefined on read)', () => {
      const v4 = {
        version: 4,
        courses: [
          {
            id: 'Monday-1-0',
            name: '高等数学',
            day: 'Monday',
            timeSlot: '1-2',
            startPeriod: 1,
            endPeriod: 2,
            duration: 2,
            location: { address: '教101' },
            teacher: { name: '张老师' },
            weekList: [1, 2, 3],
            isOddEven: null,
          },
        ],
        importedFileName: 'test.docx',
        semesterStartDate: '2025-02-17',
        semesterWeeks: 18,
        maxPeriods: 13,
        lastReport: { warnings: [], suggestions: [] },
      };
      const result = migrateToV4(v4);
      expect(result.courses).toHaveLength(1);
      expect(result.courses[0].name).toBe('高等数学');
      expect(result.importedFileName).toBe('test.docx');
      expect(result.semesterStartDate).toBe('2025-02-17');
      expect(result.semesterWeeks).toBe(18);
      expect(result.maxPeriods).toBe(13);
      // lastReport is always reset — the existing semantics in the
      // monolithic provider were "legacy payloads → undefined", and we
      // extend that to ALL inbound payloads for consistency.
      expect(result.lastReport).toBeUndefined();
    });

    it('migrates a v3 payload with weekPattern="full" to 18-week list', () => {
      const v3 = {
        version: 3,
        courses: [
          {
            id: 'c1',
            name: '物理',
            day: 'Tuesday',
            timeSlot: '3-4',
            weekPattern: 'full',
            location: { campus: '磬苑校区', building: '教', room: '202' },
            teacher: { name: '李老师' },
          },
        ],
        semesterWeeks: 20,
      };
      const result = migrateToV4(v3);
      expect(result.courses).toHaveLength(1);
      expect(result.courses[0].weekList).toEqual(
        Array.from({ length: DEFAULT_SEMESTER_WEEKS }, (_, i) => i + 1),
      );
      expect(result.courses[0].isOddEven).toBeNull();
      // semesterWeeks on the *envelope* is preserved if numeric — that's
      // a top-level field; the course's weekList uses DEFAULT_SEMESTER_WEEKS.
      expect(result.semesterWeeks).toBe(20);
    });

    it('coerces legacy location.campus/building/room into a single address', () => {
      const v3 = {
        courses: [
          {
            id: 'c1',
            name: '化学',
            day: 'Wednesday',
            timeSlot: '5-6',
            weekPattern: 'full',
            location: { campus: '磬苑校区', building: '理工楼', room: '301' },
            teacher: { name: '王老师' },
          },
        ],
      };
      const result = migrateToV4(v3);
      expect(result.courses[0].location.address).toBe('磬苑校区 理工楼 301');
    });

    it('strips removed fields (code, classes)', () => {
      const v3 = {
        courses: [
          {
            id: 'c1',
            name: '生物',
            day: 'Thursday',
            timeSlot: '7-8',
            weekPattern: 'full',
            code: 'BIO101',
            classes: [{ grade: '2024', major: '生物' }],
            location: { address: '教102' },
            teacher: { name: '王老师' },
          },
        ],
      };
      const result = migrateToV4(v3);
      const course = result.courses[0] as unknown as Record<string, unknown>;
      expect(course.code).toBeUndefined();
      expect(course.classes).toBeUndefined();
      expect(course.location).toEqual({ address: '教102' });
    });

    it('coerces legacy teacher.name "未填写" to empty string', () => {
      const v3 = {
        courses: [
          {
            id: 'c1',
            name: '历史',
            day: 'Friday',
            timeSlot: '1-2',
            weekPattern: 'full',
            location: { address: '教103' },
            teacher: { name: '未填写' },
          },
        ],
      };
      const result = migrateToV4(v3);
      expect(result.courses[0].teacher.name).toBe('');
    });

    it('drops courses whose timeSlot cannot be resolved', () => {
      const v3 = {
        courses: [
          {
            id: 'c1',
            name: '丢弃',
            day: 'Monday',
            timeSlot: 'invalid-slot',
            weekPattern: 'full',
            location: { address: 'x' },
            teacher: { name: 'x' },
          },
          {
            id: 'c2',
            name: '保留',
            day: 'Monday',
            timeSlot: '1-2',
            weekPattern: 'full',
            location: { address: 'y' },
            teacher: { name: 'y' },
          },
        ],
      };
      const result = migrateToV4(v3);
      expect(result.courses).toHaveLength(1);
      expect(result.courses[0].name).toBe('保留');
    });

    it('fills missing fields with defaults', () => {
      const partial = { courses: [] };
      const result = migrateToV4(partial);
      expect(result.semesterWeeks).toBe(EMPTY_SNAPSHOT.semesterWeeks);
      expect(result.maxPeriods).toBe(EMPTY_SNAPSHOT.maxPeriods);
      expect(result.importedFileName).toBeUndefined();
      expect(result.semesterStartDate).toBeUndefined();
      expect(result.lastReport).toBeUndefined();
    });

    it('handles non-array courses gracefully', () => {
      expect(migrateToV4({ courses: 'not-an-array' }).courses).toEqual([]);
      expect(migrateToV4({ courses: null }).courses).toEqual([]);
    });

    it('migrates v3 specificWeeks to weekList with isOddEven null', () => {
      const v3 = {
        courses: [
          {
            id: 'c1',
            name: '体育',
            day: 'Monday',
            timeSlot: '9',
            weekPattern: 'specific',
            specificWeeks: [1, 3, 5, 7],
            location: { address: '操场' },
            teacher: { name: '教练' },
          },
        ],
      };
      const result = migrateToV4(v3);
      expect(result.courses[0].weekList).toEqual([1, 3, 5, 7]);
      expect(result.courses[0].isOddEven).toBeNull();
    });
  });

  describe('safeParse', () => {
    it('parses valid JSON', () => {
      expect(safeParse('{"a":1}')).toEqual({ a: 1 });
      expect(safeParse('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('returns null for invalid JSON', () => {
      expect(safeParse('not json')).toBeNull();
      expect(safeParse('{')).toBeNull();
      expect(safeParse('')).toBeNull();
    });
  });
});

// Local alias to avoid an extra import line — matches the production default.
const DEFAULT_SEMESTER_WEEKS = 18;