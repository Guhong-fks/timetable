/**
 * notifications.ts 行为测试。
 *
 * 覆盖此前 P0 bug 曾藏身的区域：节次时间回退、通知时间计算、提前分钟数归一化；
 * 以及 P1 重构新增的：调度批次 epoch 防抖、按课程定向取消/重排、课程调度等价 diff。
 *
 * 环境说明：notifications.ts 在模块顶层调用 Notifications.setNotificationHandler(...)，
 * 且依赖 react-native 的 Platform —— 测试用 jest.mock 隔离这两个原生依赖。
 */
import * as Notifications from 'expo-notifications';
import {
  DEFAULT_LEAD_MINUTES,
  MAX_LEAD_MINUTES,
  normalizeLeadMinutes,
  getDefaultPeriodStartMinutes,
  getDefaultPeriodDuration,
  beginScheduleEpoch,
  isCurrentScheduleEpoch,
  cancelCourseNotifications,
  rescheduleCourseNotifications,
  scheduleAllNotifications,
  scheduleCourseNotification,
  coursesScheduleEqual,
} from '@/lib/notifications';
import type { ScheduledCourse } from '@/types/timetable';
import { WeekDay, TimeSlot } from '@/types/timetable';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

// storage.ts 在模块加载时引入 AsyncStorage；jest-expo 下原生包不可用，需 mock。
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidNotificationPriority: { HIGH: 'HIGH' },
  AndroidImportance: { HIGH: 'HIGH' },
  SchedulableTriggerInputTypes: { DATE: 'DATE' },
}));

// jest.mock 工厂内建 mock 实例；测试通过模块访问同一实例断言调用。
const scheduleNotificationAsync = Notifications.scheduleNotificationAsync as jest.Mock;
const cancelScheduledNotificationAsync = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const cancelAllScheduledNotificationsAsync = Notifications.cancelAllScheduledNotificationsAsync as jest.Mock;

function makeCourse(overrides: Partial<ScheduledCourse> = {}): ScheduledCourse {
  return {
    id: 'c1',
    name: '高等数学',
    day: WeekDay.MONDAY,
    timeSlot: TimeSlot.ONE_TWO,
    startPeriod: 1,
    endPeriod: 2,
    location: { address: 'A101' },
    teacher: { name: '张老师' },
    weekList: [1, 2, 3],
    isOddEven: undefined,
    duration: 2,
    ...overrides,
  };
}

/** 学期开始日期（第 1 周周一）固定为 2027-09-06，week 1 Monday = 2027-09-06（未来）。 */
const SEMESTER = '2027-09-06';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeLeadMinutes', () => {
  it('合法值原样保留（向下取整）', () => {
    expect(normalizeLeadMinutes(30)).toBe(30);
    expect(normalizeLeadMinutes(15)).toBe(15);
    expect(normalizeLeadMinutes(30.9)).toBe(30);
  });
  it('超过上限时封顶到 MAX_LEAD_MINUTES', () => {
    expect(normalizeLeadMinutes(200)).toBe(MAX_LEAD_MINUTES);
  });
  it('非法值回退默认', () => {
    expect(normalizeLeadMinutes(0)).toBe(DEFAULT_LEAD_MINUTES);
    expect(normalizeLeadMinutes(-5)).toBe(DEFAULT_LEAD_MINUTES);
    expect(normalizeLeadMinutes('abc')).toBe(DEFAULT_LEAD_MINUTES);
    expect(normalizeLeadMinutes(Number.NaN)).toBe(DEFAULT_LEAD_MINUTES);
    expect(normalizeLeadMinutes(null)).toBe(DEFAULT_LEAD_MINUTES);
  });
});

describe('默认节次规则（P0 回归：period-times 缺失时不得算成 00:00）', () => {
  it('第 1 节 = 08:00', () => {
    expect(getDefaultPeriodStartMinutes(1)).toBe(8 * 60);
  });
  it('第 5 节 = 11:20（每节 +50 分钟）', () => {
    expect(getDefaultPeriodStartMinutes(5)).toBe(11 * 60 + 20);
  });
  it('第 13 节 = 18:00', () => {
    expect(getDefaultPeriodStartMinutes(13)).toBe(18 * 60);
  });
  it('每节时长 = 45 分钟', () => {
    expect(getDefaultPeriodDuration()).toBe(45);
  });
});

describe('scheduleCourseNotification 时间计算', () => {
  it('默认节次回退：第 1 节周一 → 08:00 提前 15 分钟 = 07:45', async () => {
    await scheduleCourseNotification(makeCourse({ startPeriod: 1, endPeriod: 1 }), 1, SEMESTER, {}, {});
    const args = scheduleNotificationAsync.mock.calls[0][0];
    expect(args.trigger.date).toEqual(new Date(2027, 8, 6, 7, 45, 0));
  });

  it('默认节次回退：第 3 节 → 09:25', async () => {
    await scheduleCourseNotification(makeCourse({ startPeriod: 3, endPeriod: 3 }), 1, SEMESTER, {}, {});
    const args = scheduleNotificationAsync.mock.calls[0][0];
    expect(args.trigger.date).toEqual(new Date(2027, 8, 6, 9, 25, 0));
  });

  it('自定义节次时间优先：09:00 提前 15 分钟 = 08:45', async () => {
    await scheduleCourseNotification(makeCourse({ startPeriod: 1, endPeriod: 1 }), 1, SEMESTER, { 1: '09:00' }, {});
    const args = scheduleNotificationAsync.mock.calls[0][0];
    expect(args.trigger.date).toEqual(new Date(2027, 8, 6, 8, 45, 0));
  });

  it('自定义提前分钟数：lead 30 → 07:30', async () => {
    await scheduleCourseNotification(makeCourse({ startPeriod: 1, endPeriod: 1 }), 1, SEMESTER, {}, {}, 30);
    const args = scheduleNotificationAsync.mock.calls[0][0];
    expect(args.trigger.date).toEqual(new Date(2027, 8, 6, 7, 30, 0));
  });

  it('第 2 周 Monday → 2026-09-14', async () => {
    await scheduleCourseNotification(makeCourse({ startPeriod: 1, endPeriod: 1 }), 2, SEMESTER, {}, {});
    const args = scheduleNotificationAsync.mock.calls[0][0];
    expect(args.trigger.date).toEqual(new Date(2027, 8, 13, 7, 45, 0));
  });

  it('非周一课程按星期偏移：周三 week1 → 2026-09-09', async () => {
    await scheduleCourseNotification(makeCourse({ day: WeekDay.WEDNESDAY, startPeriod: 1, endPeriod: 1 }), 1, SEMESTER, {}, {});
    const args = scheduleNotificationAsync.mock.calls[0][0];
    expect(args.trigger.date).toEqual(new Date(2027, 8, 8, 7, 45, 0));
  });

  it('通知内容包含节次区间/地点/教师，identifier 含课程与周', async () => {
    await scheduleCourseNotification(makeCourse(), 3, SEMESTER, {}, {});
    const args = scheduleNotificationAsync.mock.calls[0][0];
    expect(args.identifier).toBe('class-reminder-c1-week-3');
    expect(args.content.title).toBe('高等数学');
    expect(args.content.body).toContain('08:00-09:35');
    expect(args.content.body).toContain('A101');
    expect(args.content.body).toContain('张老师');
    expect(args.content.data).toEqual({ type: 'class-reminder', courseId: 'c1', week: 3 });
  });

  it('通知时间已过（过去日期）时不调度', async () => {
    const past = '2020-09-07';
    await scheduleCourseNotification(makeCourse({ startPeriod: 1, endPeriod: 1 }), 1, past, {}, {});
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('非法学期开始日期不调度', async () => {
    await scheduleCourseNotification(makeCourse({ startPeriod: 1, endPeriod: 1 }), 1, 'not-a-date', {}, {});
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('scheduleAllCourseNotifications / scheduleAllNotifications', () => {
  it('全量：先 cancelAll，再按 每课×每周 调度', async () => {
    const course = makeCourse({ weekList: [1, 3] });
    await scheduleAllNotifications([course], SEMESTER, {}, {});
    expect(cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    // week1 + week3 共 2 次调度
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});

describe('增量：定向取消与重排', () => {
  it('cancelCourseNotifications 按 课程×周 定向取消，不动其他通知', async () => {
    await cancelCourseNotifications(makeCourse({ weekList: [1, 3, 5] }));
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
    expect(cancelScheduledNotificationAsync).toHaveBeenNthCalledWith(1, 'class-reminder-c1-week-1');
    expect(cancelScheduledNotificationAsync).toHaveBeenNthCalledWith(2, 'class-reminder-c1-week-3');
    expect(cancelScheduledNotificationAsync).toHaveBeenNthCalledWith(3, 'class-reminder-c1-week-5');
    // 定向取消不应触发全量 cancelAll
    expect(cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });

  it('rescheduleCourseNotifications = 定向取消 + 该课全部周重排', async () => {
    const course = makeCourse({ weekList: [1, 2] });
    await rescheduleCourseNotifications(course, SEMESTER, {}, {});
    // 定向取消 2 次 + 每次调度前的同名取消 2 次
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(4);
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });
});

describe('coursesScheduleEqual（增量 diff 依据）', () => {
  it('通知相关字段全部一致 → true', () => {
    expect(coursesScheduleEqual(makeCourse(), makeCourse())).toBe(true);
  });
  it('名称变化 → false', () => {
    expect(coursesScheduleEqual(makeCourse(), makeCourse({ name: '线性代数' }))).toBe(false);
  });
  it('节次变化 → false', () => {
    expect(coursesScheduleEqual(makeCourse(), makeCourse({ startPeriod: 2 }))).toBe(false);
  });
  it('周次变化 → false', () => {
    expect(coursesScheduleEqual(makeCourse(), makeCourse({ weekList: [1, 2] }))).toBe(false);
  });
  it('单双周标记变化 → false', () => {
    expect(coursesScheduleEqual(makeCourse(), makeCourse({ isOddEven: 'odd' }))).toBe(false);
  });
  it('与通知无关的字段（如 colorOverride）变化 → true', () => {
    const a = makeCourse();
    const b = makeCourse({ colorOverride: '#ff0000' });
    expect(coursesScheduleEqual(a, b)).toBe(true);
  });
});

describe('调度批次 epoch 防抖', () => {
  it('epoch 单调递增，最新批次保持 current', () => {
    const first = beginScheduleEpoch();
    expect(isCurrentScheduleEpoch(first)).toBe(true);
    const second = beginScheduleEpoch();
    expect(isCurrentScheduleEpoch(second)).toBe(true);
    expect(isCurrentScheduleEpoch(first)).toBe(false);
  });
});
