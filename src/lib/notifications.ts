import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ScheduledCourse, getTimeSlotMeta } from '@/types/timetable';

// 配置通知行为
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
        allowSound: false,
      },
      android: {
        allowAlert: true,
        allowBadge: false,
        allowSound: false,
      },
    });
    finalStatus = status;
  }
  return finalStatus === 'granted';
}

/** 获取节次的开始时间（分钟数，从00:00开始） */
function getPeriodStartMinutes(period: number, periodTimes: Record<number, string>, periodDurations: Record<number, number>): number {
  const startTime = periodTimes[period];
  if (!startTime) return 0;
  const [hours, minutes] = startTime.split(':').map(Number);
  return hours * 60 + minutes;
}

/** 获取节次的结束时间（分钟数，从00:00开始） */
function getPeriodEndMinutes(period: number, periodTimes: Record<number, string>, periodDurations: Record<number, number>): number {
  const startTime = periodTimes[period];
  if (!startTime) return 0;
  const [hours, minutes] = startTime.split(':').map(Number);
  const duration = periodDurations[period] ?? 45;
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

/** 格式化日期为 YYYY-MM-DD */
function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

/** 取消单个课程在特定周的通知 */
export async function cancelCourseNotification(course: ScheduledCourse, week: number): Promise<void> {
  if (Platform.OS === 'web') return;
  const identifier = getNotificationIdentifier(course, week);
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

/** 取消课程所有周的通知 */
export async function cancelAllCourseNotifications(course: ScheduledCourse): Promise<void> {
  if (Platform.OS === 'web') return;
  for (const week of course.weekList) {
    await cancelCourseNotification(course, week);
  }
}

/** 取消所有课程通知 */
export async function cancelAllNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** 调度单个课程在特定周的通知（上课前15分钟） */
export async function scheduleCourseNotification(
  course: ScheduledCourse,
  week: number,
  semesterStartDate: string,
  periodTimes: Record<number, string>,
  periodDurations: Record<number, number>
): Promise<void> {
  if (Platform.OS === 'web') return;
  
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  const courseDate = getCourseDate(semesterStartDate, week, course.day);
  if (!courseDate) return;

  const startMinutes = getCourseStartMinutes(course, periodTimes, periodDurations);
  const notificationTime = new Date(courseDate);
  notificationTime.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  
  // 提前15分钟
  notificationTime.setMinutes(notificationTime.getMinutes() - 15);

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
  periodDurations: Record<number, number>
): Promise<void> {
  for (const week of course.weekList) {
    await scheduleCourseNotification(course, week, semesterStartDate, periodTimes, periodDurations);
  }
}

/** 为所有课程调度通知 */
export async function scheduleAllNotifications(
  courses: ScheduledCourse[],
  semesterStartDate: string,
  periodTimes: Record<number, string>,
  periodDurations: Record<number, number>
): Promise<void> {
  // 先取消所有现有通知
  await cancelAllNotifications();
  
  // 为每门课程的每一周调度通知
  for (const course of courses) {
    await scheduleAllCourseNotifications(course, semesterStartDate, periodTimes, periodDurations);
  }
}

/** 更新课程通知（课程更新时调用） */
export async function updateCourseNotifications(
  course: ScheduledCourse,
  semesterStartDate: string,
  periodTimes: Record<number, string>,
  periodDurations: Record<number, number>
): Promise<void> {
  // 取消旧通知
  await cancelAllCourseNotifications(course);
  // 重新调度
  await scheduleAllCourseNotifications(course, semesterStartDate, periodTimes, periodDurations);
}

/** 删除课程通知（课程删除时调用） */
export async function deleteCourseNotifications(course: ScheduledCourse): Promise<void> {
  await cancelAllCourseNotifications(course);
}

/** 设置通知频道（Android） */
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  
  await Notifications.setNotificationChannelAsync('class-reminders', {
    name: '上课提醒',
    description: '上课前15分钟提醒',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [],
    lightColor: '#4A90D9',
    enableVibrate: false,
    showBadge: false,
  });
}

/** 初始化通知系统 */
export async function initializeNotifications(): Promise<void> {
  await setupNotificationChannel();
  
  // 设置通知点击监听器
  Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.type === 'class-reminder' && data.courseId) {
      // 通过深度链接跳转到特定课程
      const url = `coursetableapp://course/${data.courseId}?week=${data.week}`;
      if (Platform.OS !== 'web') {
        import('expo-linking').then(Linking => {
          Linking.openURL(url).catch(() => {});
        });
      }
    }
  });
}