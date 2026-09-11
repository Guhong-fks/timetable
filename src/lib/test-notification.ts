import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ScheduledCourse } from '@/types/timetable';
import { scheduleCourseNotification, requestNotificationPermissions } from '@/lib/notifications';

/**
 * 测试专用：随机选取一门课程并调度 15 分钟后的测试通知
 * 仅用于开发调试，发版前请删除或注释掉调用处
 */
export async function sendTestNotification(
  courses: ScheduledCourse[],
  semesterStartDate: string | undefined,
  periodTimes: Record<number, string>,
  periodDurations: Record<number, number>
): Promise<{ success: boolean; message: string }> {
  if (Platform.OS === 'web') {
    return { success: false, message: 'Web 端不支持本地通知测试' };
  }

  if (!semesterStartDate) {
    return { success: false, message: '请先设置学期开始日期' };
  }

  if (courses.length === 0) {
    return { success: false, message: '课表为空，无法发送测试通知' };
  }

  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) {
    return { success: false, message: '未授予通知权限，请在设置中开启' };
  }

  // 随机选取一门课程
  const randomCourse = courses[Math.floor(Math.random() * courses.length)];
  
  // 取该课程的第一个周次
  const testWeek = randomCourse.weekList[0];
  if (!testWeek) {
    return { success: false, message: '该课程无有效周次' };
  }

  // 计算课程日期
  const dayIndex = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(randomCourse.day);
  if (dayIndex === -1) {
    return { success: false, message: '无效的星期' };
  }

  const start = new Date(semesterStartDate);
  if (isNaN(start.getTime())) {
    return { success: false, message: '学期开始日期格式错误' };
  }

  const courseDate = new Date(start);
  courseDate.setDate(start.getDate() + (testWeek - 1) * 7 + dayIndex);

  const startMinutes = (() => {
    const startTime = periodTimes[randomCourse.startPeriod];
    if (!startTime) return 0;
    const [hours, minutes] = startTime.split(':').map(Number);
    return hours * 60 + minutes;
  })();

  // 测试通知：15 秒后触发（而非上课前 15 分钟）
  const notificationTime = new Date();
  notificationTime.setSeconds(notificationTime.getSeconds() + 15);

  const identifier = `test-notification-${randomCourse.id}-${Date.now()}`;
  
  await Notifications.cancelScheduledNotificationAsync(identifier);

  const endMinutes = (() => {
    const startTime = periodTimes[randomCourse.endPeriod];
    if (!startTime) return 0;
    const [hours, minutes] = startTime.split(':').map(Number);
    const duration = periodDurations[randomCourse.endPeriod] ?? 45;
    return hours * 60 + minutes + duration;
  })();

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };
  const timeRange = `${formatTime(startMinutes)}-${formatTime(endMinutes)}`;

  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: `[测试] ${randomCourse.name}`,
      body: `${timeRange} · ${randomCourse.location.address || '未填写'} · ${randomCourse.teacher.name || '未填写'}`,
      data: {
        type: 'class-reminder',
        courseId: randomCourse.id,
        week: testWeek,
      },
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: notificationTime,
      channelId: 'class-reminders',
    },
  });

  return { 
    success: true, 
    message: `测试通知已调度：${randomCourse.name}（${testWeek}周 ${randomCourse.day} 第${randomCourse.startPeriod}-${randomCourse.endPeriod}节），15 秒后弹出` 
  };
}