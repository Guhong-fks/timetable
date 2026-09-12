/**
 * period-format.ts 纯函数测试（P2：上轮抽取的 10 个 UI 日期/节次格式化函数，
 * 此前零测试）。
 */
import {
  createDefaultPeriodTimes,
  createDefaultPeriodDurations,
  formatMinutes,
  formatPeriodRange,
  formatPeriodTimeRange,
  formatWeekDisplay,
  parseLocalDate,
  startOfLocalDay,
  formatDayDate,
  formatMonth,
} from '@/lib/period-format';
import { WeekDay } from '@/types/timetable';

describe('createDefaultPeriodTimes / createDefaultPeriodDurations', () => {
  it('第 1 节 08:00，第 5 节 11:20，每节 +50 分钟', () => {
    const times = createDefaultPeriodTimes(5);
    expect(times[1]).toBe('08:00');
    expect(times[2]).toBe('08:50');
    expect(times[3]).toBe('09:40');
    expect(times[4]).toBe('10:30');
    expect(times[5]).toBe('11:20');
  });
  it('每节时长 45 分钟', () => {
    const durations = createDefaultPeriodDurations(3);
    expect(durations[1]).toBe(45);
    expect(durations[2]).toBe(45);
    expect(durations[3]).toBe(45);
  });
  it('与 notifications 默认规则一致（第 1 节 480 分钟）', () => {
    expect(formatMinutes(8 * 60)).toBe('08:00');
  });
});

describe('formatMinutes / formatPeriodRange', () => {
  it('分钟数 → HH:mm', () => {
    expect(formatMinutes(0)).toBe('00:00');
    expect(formatMinutes(8 * 60)).toBe('08:00');
    expect(formatMinutes(11 * 60 + 20)).toBe('11:20');
    expect(formatMinutes(24 * 60 + 5)).toBe('00:05'); // 跨天归零
  });
  it('start + duration → 区间两行', () => {
    expect(formatPeriodRange('08:00', 45)).toBe('08:00\n08:45');
    expect(formatPeriodRange('10:30', 45)).toBe('10:30\n11:15');
  });
  it('无开始时间 → 空串（防御）', () => {
    expect(formatPeriodRange(undefined, 45)).toBe('');
  });
});

describe('formatPeriodTimeRange', () => {
  it('第 1-2 节：45+45+间隔5 = 95 分钟 → 08:00-09:35', () => {
    const times = { 1: '08:00', 2: '08:50' };
    const durations = { 1: 45, 2: 45 };
    expect(formatPeriodTimeRange(1, 2, times, durations)).toBe('(第1-2节 08:00\n09:35)');
  });
  it('单节：第 3 节 09:40 + 45 = 10:25', () => {
    const times = { 3: '09:40' };
    const durations = { 3: 45 };
    expect(formatPeriodTimeRange(3, 3, times, durations)).toBe('(第3-3节 09:40\n10:25)');
  });
  it('缺时长配置时回退 45 分钟', () => {
    const times = { 1: '08:00' };
    expect(formatPeriodTimeRange(1, 2, times, {})).toBe('(第1-2节 08:00\n09:35)');
  });
});

describe('formatWeekDisplay', () => {
  it('空周次 → 未指定', () => {
    expect(formatWeekDisplay([], undefined)).toBe('未指定');
  });
  it('连续 1-18 → 全周', () => {
    const full = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(formatWeekDisplay(full, undefined)).toBe('全周');
  });
  it('18 周以下连续不视为全周', () => {
    const short = Array.from({ length: 8 }, (_, i) => i + 1);
    expect(formatWeekDisplay(short, undefined)).toBe('指定周: 1-8');
  });
  it('单周标记 → 单周 列表', () => {
    expect(formatWeekDisplay([1, 3, 5], 'odd')).toBe('单周 1, 3, 5');
  });
  it('双周标记 → 双周 列表', () => {
    expect(formatWeekDisplay([2, 4], 'even')).toBe('双周 2, 4');
  });
  it('指定周压缩为区间：1,2,3,5,7,8 → 1-3, 5, 7-8', () => {
    expect(formatWeekDisplay([1, 2, 3, 5, 7, 8], undefined)).toBe('指定周: 1-3, 5, 7-8');
  });
  it('单点与区间混合：1,3,4,5 → 1, 3-5', () => {
    expect(formatWeekDisplay([1, 3, 4, 5], undefined)).toBe('指定周: 1, 3-5');
  });
});

describe('parseLocalDate / startOfLocalDay', () => {
  it('合法 ISO 解析为本地日期（不含时区漂移）', () => {
    const date = parseLocalDate('2026-09-07');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(7);
  });
  it('畸形日期（2 月 30 日）→ null', () => {
    expect(parseLocalDate('2026-02-30')).toBeNull();
  });
  it('格式不合法 → null', () => {
    expect(parseLocalDate('20260907')).toBeNull();
    expect(parseLocalDate('2026/09/07')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
  });
  it('startOfLocalDay 归零时分秒', () => {
    const date = startOfLocalDay(new Date(2026, 8, 7, 14, 30, 0));
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });
});

describe('formatDayDate / formatMonth', () => {
  // 2026-09-07 是周一；week 1 周一 = 9/7，week 1 周三 = 9/9，week 2 周一 = 9/14
  const START = '2026-09-07';
  it('第 1 周周一 → 9/7', () => {
    expect(formatDayDate(START, 1, WeekDay.MONDAY)).toBe('9/7');
  });
  it('第 1 周周三 → 9/9', () => {
    expect(formatDayDate(START, 1, WeekDay.WEDNESDAY)).toBe('9/9');
  });
  it('第 2 周周一 → 9/14', () => {
    expect(formatDayDate(START, 2, WeekDay.MONDAY)).toBe('9/14');
  });
  it('第 18 周周日 → 1/10（跨月）', () => {
    expect(formatDayDate(START, 18, WeekDay.SUNDAY)).toBe('1/10');
  });
  it('formatMonth：第 1 周 → 9月，第 5 周 → 10月', () => {
    expect(formatMonth(START, 1)).toBe('9月');
    expect(formatMonth(START, 5)).toBe('10月');
  });
  it('无效开始日期 → 空串', () => {
    expect(formatDayDate('bad', 1, WeekDay.MONDAY)).toBe('');
    expect(formatMonth('bad', 1)).toBe('');
  });
});
