import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ScheduledCourse } from '@/types/timetable';
import { getStoredValue } from '@/lib/storage';
import {
  NOTIFICATION_ENABLED_KEY,
  PERIOD_TIMES_KEY,
  PERIOD_DURATIONS_KEY,
  NOTIFICATION_LEAD_MINUTES_KEY,
} from '@/constants/storage-keys';

// 配置通知行为：声音/震动由系统通知设置管理，这里仅放行前台横幅显示与声音播放
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// 调度批次防抖
// ---------------------------------------------------------------------------
// 通知调度有多个入口（TimetableContext 的课程变化 effect、设置页的手动重排），
// 每个入口都是一个 async 批次：读存储 → 查权限 → 取消 → 逐个调度。两个批次
// 并发执行时可能交错（旧批次在 await 之后覆盖新批次的结果）。用单调递增的
// epoch 做"最新批次获胜"：批次开始时领取 epoch，每个 await 之后检查自己是否
// 仍是最新，不是就立即中止，避免过期批次覆盖新状态。
let scheduleEpoch = 0;

/** 开始一个新调度批次，返回其 epoch。 */
export function beginScheduleEpoch(): number {
  return ++scheduleEpoch;
}

/** 当前批次仍是最近启动的批次吗？ */
export function isCurrentScheduleEpoch(epoch: number): boolean {
  return epoch === scheduleEpoch;
}

// ---------------------------------------------------------------------------
// 通知配置读取（共享：Context 与设置页使用同一份"读存储 → 归一化"逻辑）
// ---------------------------------------------------------------------------
interface PeriodSchedulePrefs {
  enabled: boolean;
  periodTimes: Record<number, string>;
  periodDurations: Record<number, number>;
  leadMinutes: number;
}

/** 并行读取通知开关 + 节次时间/时长 + 提前分钟数，并归一化。 */
export async function loadPeriodSchedule(): Promise<PeriodSchedulePrefs> {
  const [savedEnabled, savedTimes, savedDurations, savedLead] = await Promise.all([
    getStoredValue(NOTIFICATION_ENABLED_KEY),
    getStoredValue(PERIOD_TIMES_KEY),
    getStoredValue(PERIOD_DURATIONS_KEY),
    getStoredValue(NOTIFICATION_LEAD_MINUTES_KEY),
  ]);
  return {
    enabled: savedEnabled !== null ? JSON.parse(savedEnabled) : false,
    periodTimes: savedTimes ? JSON.parse(savedTimes) : {},
    periodDurations: savedDurations ? JSON.parse(savedDurations) : {},
    leadMinutes: savedLead !== null ? normalizeLeadMinutes(savedLead) : DEFAULT_LEAD_MINUTES,
  };
}

// ---------------------------------------------------------------------------
// 默认节次规则（与 index.tsx createDefaultPeriodTimes / 原生 widget 端完全一致）：
//   第 N 节开始 = 08:00 + (N-1) * 50 分钟，每节 45 分钟。
// 当用户未配置自定义节次时间（period-times.v2 为空）时，通知时间回退到该规则，
// 否则会把通知算成 00:00−15min（前一天深夜）或直接跳过。
// ---------------------------------------------------------------------------
const FIRST_PERIOD_MINUTES = 8 * 60;
const PERIOD_STEP_MINUTES = 50;
const DEFAULT_PERIOD_MINUTES = 45;

/** 默认提前提醒分钟数（用户未配置时使用）。 */
export const DEFAULT_LEAD_MINUTES = 15;

/** 自定义提前提醒分钟数的上限（3 小时）。 */
export const MAX_LEAD_MINUTES = 180;

/** 把存储值规范化为合法的提前分钟数，非法值回退默认。 */
export function normalizeLeadMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LEAD_MINUTES;
  return Math.min(Math.floor(parsed), MAX_LEAD_MINUTES);
}

/** 第 N 节的默认开始时间（分钟数，从 00:00 开始）。 */
export function getDefaultPeriodStartMinutes(period: number): number {
  return FIRST_PERIOD_MINUTES + (period - 1) * PERIOD_STEP_MINUTES;
}

/** 第 N 节的默认时长（分钟）。 */
export function getDefaultPeriodDuration(): number {
  return DEFAULT_PERIOD_MINUTES;
}

/** 请求通知权限 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
      android: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });
    finalStatus = status;
  }
  return finalStatus === 'granted';
}

/** 获取节次的开始时间（分钟数，从00:00开始），未配置时回退默认规则 */
function getPeriodStartMinutes(period: number, periodTimes: Record<number, string>, _periodDurations: Record<number, number>): number {
  const startTime = periodTimes[period];
  if (!startTime) return getDefaultPeriodStartMinutes(period);
  const [hours, minutes] = startTime.split(':').map(Number);
  return hours * 60 + minutes;
}

/** 获取节次的结束时间（分钟数，从00:00开始），未配置时回退默认规则 */
function getPeriodEndMinutes(period: number, periodTimes: Record<number, string>, periodDurations: Record<number, number>): number {
  const duration = periodDurations[period] ?? DEFAULT_PERIOD_MINUTES;
  const startTime = periodTimes[period];
  if (!startTime) return getDefaultPeriodStartMinutes(period) + duration;
  const [hours, minutes] = startTime.split(':').map(Number);
  return hours * 60 + minutes + duration;
}

/** 计算课程开始时间（分钟数，从00:00开始） */
function getCourseStartMinutes(course: ScheduledCourse, periodTimes: Record<number, string>, periodDurations: Record<number, number>): number {
  return getPeriodStartMinutes(course.startPeriod, periodTimes, periodDurations);
}

/** 计算课程结束时间（分钟数，从00:00开始） */
function getCourseEndMinutes(course: ScheduledCourse, periodTimes: Record<number, string>, periodDurations: Record<number, number>): number {
  return getPeriodEndMinutes(course.endPeriod, periodTimes, periodDurations);
}

/** 格式化时间为 HH:mm */
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** 根据学期开始日期、周次、星期几计算该课程的具体日期 */
function getCourseDate(semesterStartDate: string, week: number, day: ScheduledCourse['day']): Date | null {
  const start = new Date(semesterStartDate);
  if (isNaN(start.getTime())) return null;

  const dayIndex = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(day);
  if (dayIndex === -1) return null;

  const date = new Date(start);
  date.setDate(start.getDate() + (week - 1) * 7 + dayIndex);
  return date;
}

/** 生成通知的唯一标识符 */
function getNotificationIdentifier(course: ScheduledCourse, week: number): string {
  return `class-reminder-${course.id}-week-${week}`;
}

/** 取消所有课程通知 */
export async function cancelAllNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** 调度单个课程在特定周的通知（上课前 leadMinutes 分钟，默认 15 分钟） */
export async function scheduleCourseNotification(
  course: ScheduledCourse,
  week: number,
  semesterStartDate: string,
  periodTimes: Record<number, string>,
  periodDurations: Record<number, number>,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
): Promise<void> {
  if (Platform.OS === 'web') return;

  const courseDate = getCourseDate(semesterStartDate, week, course.day);
  if (!courseDate) return;

  const startMinutes = getCourseStartMinutes(course, periodTimes, periodDurations);
  const notificationTime = new Date(courseDate);
  notificationTime.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

  // 提前 leadMinutes 分钟
  notificationTime.setMinutes(notificationTime.getMinutes() - leadMinutes);

  // 如果通知时间已经过了，不调度
  if (notificationTime <= new Date()) return;

  const identifier = getNotificationIdentifier(course, week);

  // 先取消可能存在的同名通知
  await Notifications.cancelScheduledNotificationAsync(identifier);

  const endMinutes = getCourseEndMinutes(course, periodTimes, periodDurations);
  const timeRange = `${formatTime(startMinutes)}-${formatTime(endMinutes)}`;

  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: course.name,
      body: `${timeRange} · ${course.location.address || '未填写'} · ${course.teacher.name || '未填写'}`,
      // 使用系统默认声音，具体声音/震动由系统通知设置管理
      sound: 'default',
      data: {
        type: 'class-reminder',
        courseId: course.id,
        week,
      },
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: notificationTime,
      channelId: 'class-reminders',
    },
  });
}

/** 调度课程所有周的通知 */
export async function scheduleAllCourseNotifications(
  course: ScheduledCourse,
  semesterStartDate: string,
  periodTimes: Record<number, string>,
  periodDurations: Record<number, number>,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
): Promise<void> {
  for (const week of course.weekList) {
    await scheduleCourseNotification(course, week, semesterStartDate, periodTimes, periodDurations, leadMinutes);
  }
}

/** 取消某门课程所有周的通知（增量更新：删除/编辑课程时按 ID 定向清理）。 */
export async function cancelCourseNotifications(course: ScheduledCourse): Promise<void> {
  if (Platform.OS === 'web') return;
  for (const week of course.weekList) {
    await Notifications.cancelScheduledNotificationAsync(getNotificationIdentifier(course, week));
  }
}

/** 某门课程更新后定向重排（增量更新：编辑课程只重排该课，不触碰其他课程）。 */
export async function rescheduleCourseNotifications(
  course: ScheduledCourse,
  semesterStartDate: string,
  periodTimes: Record<number, string>,
  periodDurations: Record<number, number>,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
): Promise<void> {
  await cancelCourseNotifications(course);
  await scheduleAllCourseNotifications(course, semesterStartDate, periodTimes, periodDurations, leadMinutes);
}

/**
 * 两门课程的通知相关字段是否一致。用于 Context 的增量 diff：
 * 只有影响通知内容/触发时间的字段变化才需要重排。
 */
export function coursesScheduleEqual(a: ScheduledCourse, b: ScheduledCourse): boolean {
  if (a.id !== b.id) return false;
  if (a.name !== b.name || a.day !== b.day) return false;
  if (a.startPeriod !== b.startPeriod || a.endPeriod !== b.endPeriod) return false;
  if ((a.location.address ?? '') !== (b.location.address ?? '')) return false;
  if ((a.teacher.name ?? '') !== (b.teacher.name ?? '')) return false;
  if ((a.isOddEven ?? null) !== (b.isOddEven ?? null)) return false;
  if (a.weekList.length !== b.weekList.length) return false;
  for (let i = 0; i < a.weekList.length; i++) {
    if (a.weekList[i] !== b.weekList[i]) return false;
  }
  return true;
}

/** 为所有课程调度通知（全量：首次开启 / 学期开始日期变化 / 整表替换）。 */
export async function scheduleAllNotifications(
  courses: ScheduledCourse[],
  semesterStartDate: string,
  periodTimes: Record<number, string>,
  periodDurations: Record<number, number>,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
): Promise<void> {
  // 先取消所有现有通知（清理孤儿通知，如 replace 后旧 id 残留）
  await cancelAllNotifications();

  // 为每门课程的每一周调度通知
  for (const course of courses) {
    await scheduleAllCourseNotifications(course, semesterStartDate, periodTimes, periodDurations, leadMinutes);
  }
}

/**
 * 设置通知频道（Android）。
 * 声音/震动等属性交给系统通知设置管理：这里只指定名称与重要性，
 * 不设置 sound/vibrationPattern/enableVibrate，频道即使用系统默认，
 * 用户可在系统设置中自由调整（App 重启也不会覆盖用户修改）。
 */
async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('class-reminders', {
    name: '上课提醒',
    description: '上课提醒（声音、震动请在系统通知设置中管理）',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** 初始化通知系统。点击响应由根布局直接转为应用内状态。 */
export async function initializeNotifications(): Promise<void> {
  await setupNotificationChannel();
}
