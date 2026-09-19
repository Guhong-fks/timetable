import { fallbackSlot } from '@/lib/engine/recognizer';
import type { ScheduledCourse, WeekDay } from '@/types/timetable';

interface CugbRow {
  name?: unknown;
  day?: unknown;
  periods?: unknown;
  weeks?: unknown;
  teacher?: unknown;
  location?: unknown;
  code?: unknown;
}

const DAYS: Record<string, WeekDay> = {
  '1': 'Monday' as WeekDay, '一': 'Monday' as WeekDay, '周一': 'Monday' as WeekDay, '星期一': 'Monday' as WeekDay,
  '2': 'Tuesday' as WeekDay, '二': 'Tuesday' as WeekDay, '周二': 'Tuesday' as WeekDay, '星期二': 'Tuesday' as WeekDay,
  '3': 'Wednesday' as WeekDay, '三': 'Wednesday' as WeekDay, '周三': 'Wednesday' as WeekDay, '星期三': 'Wednesday' as WeekDay,
  '4': 'Thursday' as WeekDay, '四': 'Thursday' as WeekDay, '周四': 'Thursday' as WeekDay, '星期四': 'Thursday' as WeekDay,
  '5': 'Friday' as WeekDay, '五': 'Friday' as WeekDay, '周五': 'Friday' as WeekDay, '星期五': 'Friday' as WeekDay,
  '6': 'Saturday' as WeekDay, '六': 'Saturday' as WeekDay, '周六': 'Saturday' as WeekDay, '星期六': 'Saturday' as WeekDay,
  '7': 'Sunday' as WeekDay, '日': 'Sunday' as WeekDay, '周日': 'Sunday' as WeekDay, '星期日': 'Sunday' as WeekDay,
};

function value(input: unknown): string {
  return typeof input === 'string' || typeof input === 'number' ? String(input).replace(/\s+/g, ' ').trim() : '';
}

function findRange(input: unknown): [number, number] | null {
  const numbers = value(input).match(/\d+/g)?.map(Number) ?? [];
  if (!numbers.length) return null;
  const start = numbers[0];
  const end = numbers[1] ?? start;
  return start >= 1 && end >= start && end <= 13 ? [start, end] : null;
}

function findDay(input: unknown): WeekDay | null {
  const raw = value(input);
  for (const [key, day] of Object.entries(DAYS)) if (raw.includes(key)) return day;
  return null;
}

function findWeeks(input: unknown): number[] {
  const raw = value(input).replace(/周次|星期/g, '');
  const result = new Set<number>();
  for (const part of raw.split(/[,，;；、]/)) {
    const numbers = part.match(/\d+/g)?.map(Number) ?? [];
    if (!numbers.length) continue;
    const end = numbers[1] ?? numbers[0];
    for (let week = numbers[0]; week <= end && week <= 25; week += 1) if (week >= 1) result.add(week);
  }
  return [...result].sort((a, b) => a - b);
}

function rows(payload: unknown): CugbRow[] {
  return Array.isArray(payload) ? payload as CugbRow[] : [];
}

export interface CugbParseResult {
  courses: ScheduledCourse[];
  totalRows: number;
  droppedRows: number;
}

export function parseCugbCourseRows(payload: unknown): CugbParseResult {
  const source = rows(payload);
  const usedIds = new Set<string>();
  const courses: ScheduledCourse[] = [];
  source.forEach((row, index) => {
    const name = value(row.name);
    const day = findDay(row.day);
    const periods = findRange(row.periods);
    const weekList = findWeeks(row.weeks);
    if (!name || !day || !periods || !weekList.length) return;
    const base = `cugb-${value(row.code) || name}-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    courses.push({
      id,
      name,
      day,
      timeSlot: fallbackSlot(periods[0]),
      startPeriod: periods[0],
      endPeriod: periods[1],
      duration: periods[1] - periods[0] + 1,
      location: { address: value(row.location) },
      teacher: { name: value(row.teacher) },
      weekList,
      isOddEven: weekList.every((week) => week % 2 === 1) ? 'odd' : weekList.every((week) => week % 2 === 0) ? 'even' : null,
    });
  });
  return { courses, totalRows: source.length, droppedRows: source.length - courses.length };
}

export const CUGB_PAGE_READER_SCRIPT = `
(function () {
  function clean(value) { return (value || '').replace(/\\s+/g, ' ').trim(); }
  function post(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
  function headerIndex(headers, names) {
    for (var i = 0; i < headers.length; i++) {
      for (var j = 0; j < names.length; j++) if (headers[i].indexOf(names[j]) >= 0) return i;
    }
    return -1;
  }
  try {
    var result = [];
    document.querySelectorAll('table').forEach(function (table) {
      var allRows = Array.from(table.querySelectorAll('tr'));
      if (allRows.length < 2) return;
      var headers = Array.from(allRows[0].querySelectorAll('th,td')).map(function (cell) { return clean(cell.innerText); });
      var nameAt = headerIndex(headers, ['课程名称', '课程名', '课程']);
      var dayAt = headerIndex(headers, ['星期', '周几', '上课日']);
      var periodsAt = headerIndex(headers, ['节次', '上课节次', '时间']);
      var weeksAt = headerIndex(headers, ['周次', '上课周次', '起止周']);
      var teacherAt = headerIndex(headers, ['教师', '任课教师']);
      var locationAt = headerIndex(headers, ['教室', '上课地点', '地点']);
      allRows.slice(1).forEach(function (tr) {
        var cells = Array.from(tr.querySelectorAll('td')).map(function (cell) { return clean(cell.innerText); });
        if (!cells.length) return;
        result.push({
          name: cells[nameAt >= 0 ? nameAt : 0] || '',
          day: cells[dayAt >= 0 ? dayAt : 1] || '',
          periods: cells[periodsAt >= 0 ? periodsAt : 2] || '',
          weeks: cells[weeksAt >= 0 ? weeksAt : 3] || '',
          teacher: cells[teacherAt >= 0 ? teacherAt : 4] || '',
          location: cells[locationAt >= 0 ? locationAt : 5] || '',
          code: cells[0] || ''
        });
      });
    });
    if (!result.length) throw new Error('当前页面没有识别到课表表格，请先打开课表详情页面');
    post({ type: 'cugb-page-data', rows: result });
  } catch (error) {
    post({ type: 'cugb-page-error', message: error && error.message ? error.message : '当前页面不是可识别的课表页面' });
  }
})();
true;
`;
