import { buildWidgetTimeText, writeWidgetData, type WidgetCourseData } from '@/lib/widget-data';

const mockSetWidgetData = jest.fn();

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-constants', () => ({ expoConfig: { android: { package: 'com.fksguh.coursetableapp' } } }));
jest.mock('@/lib/storage', () => ({ getStoredValue: jest.fn().mockResolvedValue(null) }));
jest.mock('@bittingz/expo-widgets', () => ({ setWidgetData: mockSetWidgetData }));

const makeCourse = (id: string, weekList: number[]): WidgetCourseData => ({
  id,
  name: id,
  day: 'Monday',
  timeSlot: '1-2',
  startPeriod: 1,
  endPeriod: 2,
  location: { address: '' },
  teacher: { name: '' },
  weekList,
});

describe('writeWidgetData', () => {
  beforeEach(() => mockSetWidgetData.mockClear());

  it('formats course clock time from the configured period schedule', () => {
    expect(buildWidgetTimeText(
      makeCourse('test', [1]),
      { '1': '08:30', '2': '09:20' },
      { '2': 45 },
    )).toBe('08:30-10:05');
  });

  it('persists all semester courses so the native widget can recalculate weeks later', async () => {
    const courses = [makeCourse('week-one', [1]), makeCourse('week-two', [2])];

    await writeWidgetData(courses, 1, '2026-09-07');

    expect(mockSetWidgetData).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockSetWidgetData.mock.calls[0][0] as string);
    expect(payload.currentWeek).toBe(1);
    expect(payload.courses.map((course: WidgetCourseData) => course.id)).toEqual([
      'week-one',
      'week-two',
    ]);
    expect(payload.courses[0].timeText).toBe('08:00-09:35');
  });
});
