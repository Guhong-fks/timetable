import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getStoredValue } from '@/lib/storage';
import { PERIOD_TIMES_KEY, PERIOD_DURATIONS_KEY } from '@/constants/storage-keys';

/**
 * 惰性获取 expo-widgets 原生模块。
 * 注意不能用顶层 import：库入口在加载时就会调用 requireNativeModule("ExpoWidgets")，
 * 而该原生模块只在 Android/iOS 存在，Web 端（npm run web 调试）会直接抛错。
 * 这里在函数内 require，并用 try/catch 兜底，保证非 Android 平台安全。
 */
function getWidgetsModule(): { setWidgetData: (json: string, packageName: string) => void } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@bittingz/expo-widgets');
    return mod && typeof mod.setWidgetData === 'function' ? mod : null;
  } catch {
    return null;
  }
}

export interface WidgetCourseData {
  id: string;
  name: string;
  day: string;
  timeSlot: string;
  startPeriod: number;
  endPeriod: number;
  location: { address: string };
  teacher: { name: string };
  weekList: number[];
  isOddEven?: 'odd' | 'even' | null;
}

/**
 * 读取用户在 App 里配置的节次时间表（无配置时返回空对象，原生端回退默认规则：
 * 第 N 节 = 08:00 + (N-1)*50min，每节 45 分钟）。
 * 导出供导入页使用：.ics 无节次标记的事件按该时间轴反推节次。
 */
export async function loadPeriodSchedule(): Promise<{
  periodTimes: Record<string, string>;
  periodDurations: Record<string, number>;
}> {
  try {
    const [savedTimes, savedDurations] = await Promise.all([
      getStoredValue(PERIOD_TIMES_KEY),
      getStoredValue(PERIOD_DURATIONS_KEY),
    ]);
    const periodTimes = savedTimes ? JSON.parse(savedTimes) : {};
    const periodDurations = savedDurations ? JSON.parse(savedDurations) : {};
    return { periodTimes, periodDurations };
  } catch {
    return { periodTimes: {}, periodDurations: {} };
  }
}

/**
 * 把课表数据同步给 Android 桌面小组件。
 *
 * 通过 @bittingz/expo-widgets 的 setWidgetData 写入 SharedPreferences
 * （<applicationId>.widgetdata / key=widgetdata），写入后库会立即广播
 * ACTION_APPWIDGET_UPDATE 触发 Provider 刷新。
 *
 * 写入的是“当前周”全量课程（不过滤星期），由原生端在每次 onUpdate 时按
 * “当天星期 + 周次”自行过滤，从而支持跨天/跨周自动更新（无需打开 App，
 * 依赖 widget_timetable_info.xml 的 updatePeriodMillis 系统级定时刷新）。
 *
 * 同时写入节次时间/时长表：原生端据此判断“下课时间”，下课后的课程不再
 * 显示，并在每个下课时刻用 AlarmManager 自动刷新小组件。
 */
export async function writeWidgetData(
  courses: WidgetCourseData[],
  currentWeek: number,
  semesterStartDate?: string
): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    const packageName = Constants.expoConfig?.android?.package;
    if (!packageName) {
      console.warn('Widget: android.package 未配置，跳过小组件数据写入');
      return;
    }

    const weekCourses = courses.filter(course => course.weekList.includes(currentWeek));
    const { periodTimes, periodDurations } = await loadPeriodSchedule();
    const payload = JSON.stringify({
      currentWeek,
      semesterStartDate: semesterStartDate ?? '',
      courses: weekCourses,
      periodTimes,
      periodDurations,
    });

    const mod = getWidgetsModule();
    if (!mod) {
      console.warn('Widget: expo-widgets 原生模块不可用，跳过小组件数据写入');
      return;
    }
    mod.setWidgetData(payload, packageName);
  } catch (error) {
    console.warn('Failed to write widget data:', error);
  }
}

/**
 * 按学期开始日期计算当前周；无基准时回退到第 1 周。
 * （不再用“年初”推算——9 月会被算成第 37 周，导致小组件永远“暂无课程”。）
 */
export function getCurrentWeek(semesterStartDate?: string): number {
  if (semesterStartDate) {
    try {
      const startDate = new Date(semesterStartDate);
      if (Number.isNaN(startDate.getTime())) return 1;
      const now = new Date();
      const diffInDays = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      // +1 修正边界：第 8 天起应为第 2 周
      return Math.max(1, Math.ceil((diffInDays + 1) / 7));
    } catch {
      // fall through
    }
  }
  return 1;
}