import mammoth from 'mammoth';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { Element as HtmlElement } from 'domhandler';
import { ScheduledCourse, TimeSlot, TimetableData, WeekDay, coursesToTimetable, DEFAULT_SEMESTER_WEEKS } from '@/types/timetable';
import { validateFile, sanitizeText, ParseResourceLimiter } from '../security';

export type ImportResult = { courses: ScheduledCourse[]; timetable: TimetableData; warnings: string[] };

const DAYS = [WeekDay.MONDAY, WeekDay.TUESDAY, WeekDay.WEDNESDAY, WeekDay.THURSDAY, WeekDay.FRIDAY, WeekDay.SATURDAY, WeekDay.SUNDAY];

/** Convert period start number to TimeSlot enum */
function slot(start: number): TimeSlot {
  if (start === 1) return TimeSlot.ONE_TWO;
  if (start === 3) return TimeSlot.THREE_FOUR;
  if (start === 6) return TimeSlot.SIX_SEVEN;
  if (start >= 11) return TimeSlot.ELEVEN;
  if (start === 8) return TimeSlot.EIGHT;
  if (start === 9) return TimeSlot.NINE;
  return TimeSlot.TEN;
}

/** Parse week pattern string into structured data.
 * Supports: "1-18周", "1~18周", "3,5,7周", "3-10周", "1,3-5,7周"
 * Returns full-semester flag or specific week numbers. */
function parseWeekPattern(weeksStr: string): { weekPattern: 'full' | 'specific'; specificWeeks?: number[] } {
  const rangePattern = /(\d+)\s*[~-]\s*(\d+)/g;
  const singlePattern = /(?<![~-]\d)(\d+)(?!\s*[~-])/g;

  const weeks: number[] = [];
  const ranges: [number, number][] = [];

  let match: RegExpExecArray | null;
  while ((match = rangePattern.exec(weeksStr)) !== null) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    ranges.push([start, end]);
    for (let w = start; w <= end; w++) weeks.push(w);
  }

  const singleMatches = weeksStr.match(singlePattern);
  if (singleMatches) {
    for (const s of singleMatches) {
      const num = Number(s);
      const inRange = ranges.some(([start, end]) => num >= start && num <= end);
      if (!inRange) weeks.push(num);
    }
  }

  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  if (sorted.length === 0) return { weekPattern: 'specific', specificWeeks: [] };

  const isContinuous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  const isFullSemester = isContinuous && sorted[0] === 1 && sorted[sorted.length - 1] >= DEFAULT_SEMESTER_WEEKS;

  return isFullSemester
    ? { weekPattern: 'full', specificWeeks: undefined }
    : { weekPattern: 'specific', specificWeeks: sorted };
}

/** Parse class info text into grade and major */
function parseClassInfo(classText: string): { grade: string; major: string } {
  const normalized = classText.replace(/\s+/g, ' ').trim();
  const grade = normalized.match(/^(\d{2,4}级|全校)/)?.[1] ?? '其他';
  const gradePrefix = new RegExp(`^(?:${grade.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*)+`);
  const major = normalized.replace(gradePrefix, '').trim();
  return { grade, major };
}

/** Sanitize user input to prevent injection - 使用统一的清理函数 */
function sanitizeInput(input: string): string {
  return sanitizeText(input, 1000);
}

/** Parse a cell's text content into scheduled courses */
function parseCell(text: string, day: WeekDay, row: number): ScheduledCourse[] {
  const courses: ScheduledCourse[] = [];
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const codePattern = /(\d{9})-([A-Z]{2}\d{5}\.\d{3})/;

  for (let index = 0; index < lines.length; index++) {
    const codeMatch = lines[index].match(codePattern);
    if (!codeMatch) continue;

    const schedule = lines[index + 1]?.match(/\(([^)]*周)\)\s*\((\d+)-(\d+)节\)/);
    if (!schedule) continue;

    const name = sanitizeInput(lines[index - 1] ?? '未命名课程');
    const [, term, code] = codeMatch;
    const [, weeks, start, end] = schedule;

    const nextCodeIndex = lines.slice(index + 2).findIndex(line => codePattern.test(line));
    const detailEnd = nextCodeIndex < 0 ? lines.length : index + 2 + nextCodeIndex - 1;
    const detailLines = lines.slice(index + 2, detailEnd);

    const scheduleLine = lines[index + 1];
    const locationLine = scheduleLine.slice((schedule.index ?? 0) + schedule[0].length).trim();

    const { campus, building, room, teacher } = parseLocationAndTeacher(locationLine);

    const classText = detailLines.join(';');
    const classInfo = parseClassInfo(classText);
    const { weekPattern, specificWeeks } = parseWeekPattern(weeks);

    courses.push({
      id: `${term}-${code}-${day}-${row}-${courses.length}`,
      name,
      code: `${term}-${code}`,
      day,
      timeSlot: slot(Number(start)),
      duration: Number(end) - Number(start) + 1,
      location: { campus, building, room },
      teacher: { name: sanitizeInput(teacher) },
      classes: [{ grade: classInfo.grade, major: sanitizeInput(classInfo.major) }],
      weekPattern,
      specificWeeks,
    });
  }
  return courses;
}

/** Parse location line into campus, building, room, teacher.
 * Handles formats like: "磬苑校区 博学楼 B101 张老师", "磬苑校区 博学楼B101 李教授" */
function parseLocationAndTeacher(line: string): { campus: '磬苑校区' | '其他'; building: string; room: string; teacher: string } {
  const campusMatch = line.match(/^(磬苑校区|其他校区)\s*/);
  const campus = (campusMatch?.[1] as '磬苑校区' | '其他') ?? '磬苑校区';
  const afterCampus = line.replace(/^(磬苑校区|其他校区)\s*/, '').trim();

  if (!afterCampus) {
    return { campus, building: '未填写', room: '未填写', teacher: '未填写' };
  }

  let building = '未填写';
  let room = '未填写';
  let teacher = '未填写';

  // Extract teacher from the end
  const teacherPatterns = [
    /^(.+?)\s+([\u4e00-\u9fa5]{2,4}(?:老师|教授|副教授|讲师|助教))$/,
    /^(.+?)\s+([\u4e00-\u9fa5]{2,4})$/,
  ];

  let locationPart = afterCampus;
  for (const pattern of teacherPatterns) {
    const match = locationPart.match(pattern);
    if (match) {
      locationPart = match[1].trim();
      teacher = sanitizeInput(match[2].trim());
      break;
    }
  }

  // Extract room from locationPart
  const roomPatterns = [
    /^(.+?)\s+([A-Za-z]?\d+[A-Za-z]?(?:室)?)$/,
    /^(.+?)\s+([A-Za-z]-\d+)$/,
    /^(.+?)\s+(\d+室?)$/,
    /^(.+?)([A-Za-z]\d+[A-Za-z]?(?:室)?)$/,
    /^(.+?)([A-Za-z]-\d+)$/,
    /^(.+?)(\d+室?)$/,
    /^(.+?)([\u4e00-\u9fa5]+楼(?:\[[^\]]+\])?)$/,
    /^(.+?)([\u4e00-\u9fa5]+(?:楼|馆|厅|场|室|中心|实验室|机房))$/,
  ];

  for (const pattern of roomPatterns) {
    const match = locationPart.match(pattern);
    if (match) {
      building = sanitizeInput(match[1].trim().replace(/[\s、，,；;]+$/, '') || '未填写');
      room = sanitizeInput(match[2].trim());
      return { campus, building, room, teacher };
    }
  }

  building = sanitizeInput(locationPart.replace(/[\s、，,；;]+$/, '') || '未填写');
  return { campus, building, room: '未填写', teacher };
}

function docxCellText(cell: HtmlElement): string {
  const paragraphs = DomUtils.getElementsByTagName('p', cell.children, true)
    .map(paragraph => DomUtils.textContent(paragraph).trim())
    .filter(Boolean);
  return paragraphs.length ? paragraphs.join('\n') : DomUtils.textContent(cell).trim();
}

function readDocxGrid(table: HtmlElement): { text: string; anchorRow: number }[][] {
  const grid: { text: string; anchorRow: number }[][] = [];
  DomUtils.getElementsByTagName('tr', table.children, true).forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let column = 0;
    row.children
      .filter((child): child is HtmlElement => child.type === 'tag' && (child.name === 'th' || child.name === 'td'))
      .forEach(cell => {
        while (grid[rowIndex][column]) column++;
        const rowSpan = Number(cell.attribs.rowspan ?? 1);
        const columnSpan = Number(cell.attribs.colspan ?? 1);
        const value = { text: docxCellText(cell), anchorRow: rowIndex };
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
          grid[rowIndex + rowOffset] ??= [];
          for (let columnOffset = 0; columnOffset < columnSpan; columnOffset++) {
            grid[rowIndex + rowOffset][column + columnOffset] = value;
          }
        }
        column += columnSpan;
      });
  });
  return grid;
}

function result(courses: ScheduledCourse[], warnings: string[] = []): ImportResult {
  return { courses, timetable: coursesToTimetable(courses), warnings };
}

export async function parseDocxTimetable(buffer: ArrayBuffer): Promise<ImportResult> {
  const resourceLimiter = new ParseResourceLimiter();
  
  try {
    const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const document = parseDocument(value);
    const table = DomUtils.getElementsByTagName('table', document.children, true)[0];
    if (!table) throw new Error('Word 文件没有找到课表。');
    const grid = readDocxGrid(table);
    const courses: ScheduledCourse[] = [];
    
    grid.slice(1).forEach((row, rowIndex) => {
      resourceLimiter.checkTime();
      resourceLimiter.checkCell();
      
      if (!/^\d+$/.test(row[1]?.text.trim() ?? '')) return;
      DAYS.forEach((day, index) => {
        const cell = row[index + 2];
        if (cell?.anchorRow === rowIndex + 1) courses.push(...parseCell(cell.text, day, rowIndex));
      });
    });
    
    if (!courses.length) throw new Error('未识别到课程，请确认文件是固定课表模板。');
    return result(courses);
  } catch (error) {
    if (error instanceof Error && error.message.includes('解析超时')) {
      throw new Error('文件解析超时，文件可能过于复杂或损坏');
    }
    if (error instanceof Error && error.message.includes('解析单元格数量超过限制')) {
      throw new Error('文件内容过多，无法处理');
    }
    throw error;
  }
}

export function parseXlsxTimetable(buffer: ArrayBuffer): ImportResult {
  // XLSX support removed due to security vulnerabilities
  throw new Error('暂不支持 .xlsx 格式，请转换为 .docx 格式导入');
}

type TimetableFile = { name: string; size?: number; arrayBuffer: () => Promise<ArrayBuffer> } | { name: string; size?: number; uri: string };

export async function parseTimetableFile(file: TimetableFile) {
  // Validate file
  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const buffer = 'arrayBuffer' in file
    ? await file.arrayBuffer()
    : await readNativeFile(file);

  if (file.name.toLowerCase().endsWith('.docx')) return parseDocxTimetable(buffer);
  if (file.name.toLowerCase().endsWith('.xlsx')) throw new Error('暂不支持 .xlsx 格式，请转换为 .docx 格式导入');
  throw new Error('暂仅支持 .docx 文件。');
}

async function readNativeFile(file: { name: string; size?: number; uri: string }): Promise<ArrayBuffer> {
  const response = await fetch(file.uri);
  return response.arrayBuffer();
}