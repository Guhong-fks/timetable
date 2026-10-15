import { fallbackSlot } from '@/lib/engine/recognizer';
import { MAX_PERIOD, parseWeekPattern } from '@/lib/importers/parsers';
import { WeekDay, type ScheduledCourse } from '@/types/timetable';

export interface WakeupCsvIssue {
  /** CSV record number, including the header as row 1. */
  row: number;
  category: 'cell' | 'week';
  message: string;
  raw: string;
}

export interface WakeupCsvParseResult {
  courses: ScheduledCourse[];
  totalRows: number;
  droppedRows: number;
  diagnostics: WakeupCsvIssue[];
}

type Column = 'name' | 'day' | 'start' | 'end' | 'teacher' | 'location' | 'weeks';

const HEADER_ALIASES: Record<Column, string[]> = {
  name: ['课程名称', '课程名', '课程'],
  day: ['星期', '星期几', '上课星期'],
  start: ['开始节数', '开始节次', '起始节数'],
  end: ['结束节数', '结束节次'],
  teacher: ['老师', '教师', '任课教师'],
  location: ['地点', '教室', '上课地点'],
  weeks: ['周数', '周次', '上课周次'],
};

const REQUIRED_COLUMNS: Column[] = ['name', 'day', 'start', 'end', 'weeks'];

const DAY_BY_NUMBER: Record<number, WeekDay> = {
  1: WeekDay.MONDAY,
  2: WeekDay.TUESDAY,
  3: WeekDay.WEDNESDAY,
  4: WeekDay.THURSDAY,
  5: WeekDay.FRIDAY,
  6: WeekDay.SATURDAY,
  7: WeekDay.SUNDAY,
};

/** Parse RFC-4180-style comma-separated records, including quoted commas/newlines. */
function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoteClosed = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      quoteClosed = false;
      continue;
    }
    if (char === '\r' || char === '\n') {
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      quoteClosed = false;
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      continue;
    }
    if (char === '"') {
      if (field.length !== 0 || quoteClosed) {
        throw new Error('CSV 格式错误：引号未转义或位置不正确');
      }
      inQuotes = true;
      continue;
    }
    if (quoteClosed) {
      if (/\s/.test(char)) continue;
      throw new Error('CSV 格式错误：引号后存在多余字符');
    }
    field += char;
  }

  if (inQuotes) throw new Error('CSV 格式错误：存在未闭合的引号');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/[\s\u3000]+/g, '').trim();
}

function readColumns(header: string[]): Partial<Record<Column, number>> {
  const normalized = header.map(normalizeHeader);
  const result: Partial<Record<Column, number>> = {};
  for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [Column, string[]][]) {
    const index = normalized.findIndex((value) => aliases.includes(value));
    if (index >= 0) result[column] = index;
  }
  const missing = REQUIRED_COLUMNS.filter((column) => result[column] === undefined);
  if (missing.length > 0) {
    const labels = missing.map((column) => HEADER_ALIASES[column][0]).join('、');
    throw new Error(`CSV 表头不完整，缺少必需列：${labels}`);
  }
  return result;
}

function cell(row: string[], columns: Partial<Record<Column, number>>, column: Column): string {
  const index = columns[column];
  return index === undefined ? '' : (row[index] ?? '').trim();
}

function optionalText(value: string): string {
  return value === '无' ? '' : value;
}

function normalizeSpreadsheetDateRange(value: string): string {
  const compact = value.trim().replaceAll(' ', '').replaceAll('　', '');
  const suffix = /([单双])$/.exec(compact)?.[1] ?? '';
  const core = suffix ? compact.slice(0, -1) : compact;
  const chineseDate = /^(?:[0-9]{4}年)?([0-9]{1,2})月([0-9]{1,2})日?$/.exec(core);
  if (chineseDate) {
    const month = Number(chineseDate[1]);
    const day = Number(chineseDate[2]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31
      ? `${month}-${day}${suffix}`
      : '';
  }

  const yearFirstDate = /^[0-9]{4}[./-]([0-9]{1,2})[./-]([0-9]{1,2})$/.exec(core);
  if (yearFirstDate) {
    const month = Number(yearFirstDate[1]);
    const day = Number(yearFirstDate[2]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31
      ? `${month}-${day}${suffix}`
      : '';
  }

  const monthDayDate = /^([0-9]{1,2})([/-])([0-9]{1,2})(?:[/-][0-9]{4})?$/.exec(core);
  if (!monthDayDate) return value.trim();
  const month = Number(monthDayDate[1]);
  const day = Number(monthDayDate[3]);
  // A hyphenated value with month > 12 is a legitimate week range (e.g. 13-18).
  if (monthDayDate[2] === '-' && month > 12) return value.trim();
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${month}-${day}${suffix}`;
}

function parseWeekSpec(value: string): ReturnType<typeof parseWeekPattern> {
  // WakeUp's CSV template uses a trailing 单/双 (without 周), while the
  // shared parser recognizes the equivalent Chinese phrase 单周/双周. Some
  // spreadsheet apps also auto-format M-D week ranges as calendar dates; map
  // that documented round-trip format back to the original week range.
  const dateNormalized = normalizeSpreadsheetDateRange(value);
  const normalized = dateNormalized.endsWith('单') || dateNormalized.endsWith('双')
    ? `${dateNormalized}周`
    : dateNormalized;
  return parseWeekPattern(normalized);
}

export function parseWakeupCsv(text: string): WakeupCsvParseResult {
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ''));
  if (records.length < 2) throw new Error('CSV 文件为空或只有表头');

  const columns = readColumns(records[0]);
  const dataRows = records.slice(1);
  const courses: ScheduledCourse[] = [];
  const diagnostics: WakeupCsvIssue[] = [];

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = cell(row, columns, 'name');
    const dayRaw = cell(row, columns, 'day');
    const startRaw = cell(row, columns, 'start');
    const endRaw = cell(row, columns, 'end');
    const teacher = optionalText(cell(row, columns, 'teacher'));
    const location = optionalText(cell(row, columns, 'location'));
    const weeksRaw = cell(row, columns, 'weeks');
    const issues: string[] = [];

    const dayNumber = /^\d+$/.test(dayRaw) ? Number(dayRaw) : NaN;
    const day = DAY_BY_NUMBER[dayNumber];
    const startPeriod = /^\d+$/.test(startRaw) ? Number(startRaw) : NaN;
    const endPeriod = /^\d+$/.test(endRaw) ? Number(endRaw) : NaN;

    if (!name) issues.push('课程名称为空');
    if (!day) issues.push('星期必须是 1-7');
    if (!Number.isInteger(startPeriod) || !Number.isInteger(endPeriod)
      || startPeriod < 1 || endPeriod < startPeriod || endPeriod > MAX_PERIOD) {
      issues.push(`节次必须是 1-${MAX_PERIOD} 且开始节次不晚于结束节次`);
    }

    const weekResult = weeksRaw ? parseWeekSpec(weeksRaw) : null;
    if (!weekResult || weekResult.weekList.length === 0) issues.push('周数格式无法识别');

    if (issues.length > 0 || !day || !weekResult || weekResult.weekList.length === 0) {
      diagnostics.push({
        row: rowNumber,
        category: 'cell',
        message: issues.join('；'),
        raw: row.join(','),
      });
      return;
    }

    for (const warning of weekResult.warnings) {
      diagnostics.push({
        row: rowNumber,
        category: 'week',
        message: warning.message,
        raw: weeksRaw,
      });
    }

    courses.push({
      id: `wakeup-csv-${rowNumber}`,
      name,
      day,
      timeSlot: fallbackSlot(startPeriod),
      startPeriod,
      endPeriod,
      duration: endPeriod - startPeriod + 1,
      location: { address: location },
      teacher: { name: teacher },
      weekList: weekResult.weekList,
      isOddEven: weekResult.isOddEven,
    });
  });

  return {
    courses,
    totalRows: dataRows.length,
    droppedRows: diagnostics.filter((issue) => issue.category === 'cell').length,
    diagnostics,
  };
}
