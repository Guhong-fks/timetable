import mammoth from 'mammoth';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { Element as HtmlElement } from 'domhandler';
import { ScheduledCourse, TimetableData, WeekDay, coursesToTimetable } from '@/types/timetable';
import { validateFile, validateBufferSize, ParseResourceLimiter } from '../security';
import { slot, parseWeekPattern, sanitizeInput, parseLocationAndTeacher } from './parsers';

export type ImportResult = { courses: ScheduledCourse[]; timetable: TimetableData; warnings: string[] };

const DAYS = [WeekDay.MONDAY, WeekDay.TUESDAY, WeekDay.WEDNESDAY, WeekDay.THURSDAY, WeekDay.FRIDAY, WeekDay.SATURDAY, WeekDay.SUNDAY];

/** Parse a cell's text content into scheduled courses */
function parseCell(text: string, day: WeekDay, row: number): ScheduledCourse[] {
  const courses: ScheduledCourse[] = [];
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  // Course code line acts as an anchor to locate the course block — it is
  // not stored in the result.
  const codePattern = /(\d{9})-([A-Z]{2}\d{5}\.\d{3})/;

  for (let index = 0; index < lines.length; index++) {
    const codeMatch = lines[index].match(codePattern);
    if (!codeMatch) continue;

    const schedule = lines[index + 1]?.match(/\(([^)]*周)\)\s*\((\d+)-(\d+)节\)/);
    if (!schedule) continue;

    const name = sanitizeInput(lines[index - 1] ?? '未命名课程');
    const [, weeks, start, end] = schedule;

    const scheduleLine = lines[index + 1];
    const locationLine = scheduleLine.slice((schedule.index ?? 0) + schedule[0].length).trim();
    const { building: address, teacher } = parseLocationAndTeacher(locationLine);

    const { weekPattern, specificWeeks } = parseWeekPattern(weeks);
    const startPeriod = Number(start);
    const endPeriod = Number(end);
    const duration = endPeriod - startPeriod + 1;

    courses.push({
      id: `${day}-${row}-${courses.length}`,
      name,
      day,
      timeSlot: slot(startPeriod, endPeriod),
      startPeriod,
      endPeriod,
      duration,
      location: { address },
      teacher: { name: sanitizeInput(teacher) },
      weekPattern,
      specificWeeks,
    });
  }
  return courses;
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

/** Detect which column holds the period number (1..13). Scans every data row
 * for a column whose text is a number in [1, 13], then picks the column that
 * appears most often — robust to template variants where the period lives in
 * col 0 or col 1. Returns -1 if no consistent period column exists. */
function detectPeriodColumn(grid: { text: string; anchorRow: number }[][]): number {
  const counts = new Map<number, number>();
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;
    for (let col = 0; col <= 1; col++) {
      const text = row[col]?.text.trim() ?? '';
      if (/^\d+$/.test(text)) {
        const n = Number(text);
        if (n >= 1 && n <= 13) {
          counts.set(col, (counts.get(col) ?? 0) + 1);
        }
      }
    }
  }
  if (counts.size === 0) return -1;
  // Pick the column with the highest count.
  let best = -1;
  let bestCount = 0;
  for (const [col, count] of counts) {
    if (count > bestCount) {
      best = col;
      bestCount = count;
    }
  }
  return best;
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

    const periodCol = detectPeriodColumn(grid);
    if (periodCol < 0) {
      throw new Error('未识别到课程，请确认文件是固定课表模板。');
    }
    // Day columns start immediately to the right of the period column.
    const dayColStart = periodCol + 1;

    grid.forEach((row, originalIndex) => {
      // Skip the header row (always row 0 in the source grid).
      if (originalIndex === 0) return;
      resourceLimiter.checkTime();
      resourceLimiter.checkCell();

      // Validate this row has the period number we expect (colPeriod, anchorRow=this row).
      const periodCell = row[periodCol];
      if (!periodCell || periodCell.anchorRow !== originalIndex) return;
      const periodText = periodCell.text.trim();
      if (!/^\d+$/.test(periodText)) return;
      const period = Number(periodText);
      if (period < 1 || period > 13) return;

      DAYS.forEach((day, dayIndex) => {
        const cell = row[dayColStart + dayIndex];
        // Only parse cells that originate from this row (skip those filled in
        // by an earlier rowSpan from above).
        if (cell?.anchorRow !== originalIndex) return;
        courses.push(...parseCell(cell.text, day, originalIndex - 1));
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

type TimetableFile = { name: string; size?: number; type?: string; arrayBuffer: () => Promise<ArrayBuffer> } | { name: string; size?: number; type?: string; uri: string };

export async function parseTimetableFile(file: TimetableFile) {
  // Validate file metadata (extension, MIME, size if reported, URI scheme).
  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const buffer = 'arrayBuffer' in file
    ? await file.arrayBuffer()
    : await readNativeFile(file);

  // Defence in depth: when the picker omitted `file.size` (common on Android
  // DocumentPicker) we re-check the actual buffer size after download.
  const sizeValidation = validateBufferSize(buffer);
  if (!sizeValidation.valid) {
    throw new Error(sizeValidation.error);
  }

  if (file.name.toLowerCase().endsWith('.docx')) return parseDocxTimetable(buffer);
  if (file.name.toLowerCase().endsWith('.xlsx')) throw new Error('暂不支持 .xlsx 格式，请转换为 .docx 格式导入');
  throw new Error('暂仅支持 .docx 文件。');
}

async function readNativeFile(file: { name: string; size?: number; uri: string }): Promise<ArrayBuffer> {
  const response = await fetch(file.uri);
  return response.arrayBuffer();
}