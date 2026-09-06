export enum WeekDay { MONDAY='Monday', TUESDAY='Tuesday', WEDNESDAY='Wednesday', THURSDAY='Thursday', FRIDAY='Friday', SATURDAY='Saturday', SUNDAY='Sunday' }
export enum TimeSlot { ONE_TWO='1-2', THREE_FOUR='3-4', FIVE_SIX='5-6', SIX_SEVEN='6-7', EIGHT='8', NINE='9', TEN='10', ELEVEN='11-13', EVENING='evening' }

export const TIME_SLOT_ORDER: TimeSlot[] = [
  TimeSlot.ONE_TWO,
  TimeSlot.THREE_FOUR,
  TimeSlot.FIVE_SIX,
  TimeSlot.SIX_SEVEN,
  TimeSlot.EIGHT,
  TimeSlot.NINE,
  TimeSlot.TEN,
  TimeSlot.ELEVEN,
  TimeSlot.EVENING,
];

export const TIME_SLOT_META: Record<TimeSlot, {label: string; start: number; end: number; duration: number}> = {
  '1-2': {label: '1-2 节', start: 1, end: 2, duration: 2},
  '3-4': {label: '3-4 节', start: 3, end: 4, duration: 2},
  '5-6': {label: '5-6 节', start: 5, end: 6, duration: 2},
  '6-7': {label: '6-7 节', start: 6, end: 7, duration: 2},
  '8': {label: '8 节', start: 8, end: 8, duration: 1},
  '9': {label: '9 节', start: 9, end: 9, duration: 1},
  '10': {label: '10 节', start: 10, end: 10, duration: 1},
  '11-13': {label: '11-13 节', start: 11, end: 13, duration: 3},
  'evening': {label: '晚上', start: 19, end: 21, duration: 2},
};

export const CLASS_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export const WEEK_DAYS = [WeekDay.MONDAY, WeekDay.TUESDAY, WeekDay.WEDNESDAY, WeekDay.THURSDAY, WeekDay.FRIDAY, WeekDay.SATURDAY, WeekDay.SUNDAY];
export const SEMESTER_WEEKS = 18;
export const WEEK_DAY_LABELS: Record<WeekDay, string> = { Monday: '周一', Tuesday: '周二', Wednesday: '周三', Thursday: '周四', Friday: '周五', Saturday: '周六', Sunday: '周日' };

export interface ScheduledCourse {
  id: string;
  name: string;
  code: string;
  day: WeekDay;
  timeSlot: TimeSlot;
  location: { campus: '磬苑校区' | '其他'; building: string; room: string };
  teacher: { name: string; title?: string };
  classes: { grade: string; major: string; classNumber?: string }[];
  weekPattern: 'full' | 'specific';
  specificWeeks?: number[];
  duration?: number; // 可选：解析时覆盖的实际节数
}
export type TimetableData = { [day in WeekDay]: ScheduledCourse[] };
export function createEmptyTimetable(): TimetableData {
  return WEEK_DAYS.reduce((result, day) => { result[day] = []; return result; }, {} as TimetableData);
}
export function coursesToTimetable(courses: ScheduledCourse[]): TimetableData {
  const result = createEmptyTimetable();
  courses.forEach(course => result[course.day].push(course));
  return result;
}
export function coursesForWeek(courses: ScheduledCourse[], week: number): ScheduledCourse[] {
  return courses.filter(course => course.weekPattern === 'full' || course.specificWeeks?.includes(week));
}