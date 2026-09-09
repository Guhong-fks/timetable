// Semester-weeks adaptation: the displayed total ("第 N 周 / M") follows the
// imported timetable's real max week; the 18-week default applies only when
// no course carries week data.
import { computeSemesterWeeks, WeekDay, TimeSlot, type ScheduledCourse } from '@/types/timetable';

function course(weekList: number[]): ScheduledCourse {
  return {
    id: 'Monday-1-2-x',
    name: 'x',
    day: WeekDay.MONDAY,
    timeSlot: TimeSlot.ONE_TWO,
    startPeriod: 1,
    endPeriod: 2,
    duration: 2,
    location: { address: '' },
    teacher: { name: '' },
    weekList,
    isOddEven: null,
  };
}

describe('computeSemesterWeeks — adapt to the imported timetable', () => {
  it('follows the max week across all courses (20 > 17)', () => {
    expect(computeSemesterWeeks([course([1, 17]), course([1, 2, 20])])).toBe(20);
  });

  it('shrinks below the default when the timetable ends earlier (16-week term)', () => {
    expect(computeSemesterWeeks([course([1, 2, 16]), course([3, 14])])).toBe(16);
  });

  it('returns the 18-week default when no course has week data', () => {
    expect(computeSemesterWeeks([course([]), course([])])).toBe(18);
    expect(computeSemesterWeeks([])).toBe(18);
  });

  it('ignores courses with an empty weekList among others with data', () => {
    expect(computeSemesterWeeks([course([]), course([1, 12])])).toBe(12);
  });
});
