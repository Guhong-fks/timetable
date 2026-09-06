/**
 * Security utilities for file validation and input sanitization
 */

// Allowed file types for import
export const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
];

export const ALLOWED_EXTENSIONS = ['.docx', '.xlsx'];

// File size limits (in bytes)
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_XLSX_ROWS = 10000; // Maximum rows in spreadsheet
export const MAX_DOCX_SIZE = 5 * 1024 * 1024; // 5 MB for docx

// Parse limits
export const PARSE_TIMEOUT_MS = 30000; // 30 seconds max parse time
export const MAX_CELL_TEXT_LENGTH = 10000; // Max characters per cell

/**
 * Validate file before processing
 */
export function validateFile(file: { name: string; size?: number; type?: string; uri?: string }): { valid: boolean; error?: string } {
  // Check extension
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `不支持的文件类型: ${ext}，仅支持 .docx 和 .xlsx` };
  }

  // Check MIME type if available
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: `不支持的 MIME 类型: ${file.type}` };
  }

  // Check file size
  if (file.size !== undefined && file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `文件过大: ${(file.size / 1024 / 1024).toFixed(1)} MB，最大允许 ${MAX_FILE_SIZE / 1024 / 1024} MB` };
  }

  return { valid: true };
}

/**
 * Sanitize text input to prevent injection attacks
 */
export function sanitizeText(text: string, maxLength: number = MAX_CELL_TEXT_LENGTH): string {
  if (!text) return '';
  
  // Trim and limit length
  let sanitized = text.trim().slice(0, maxLength);
  
  // Remove null bytes and control characters (except newlines and tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Normalize whitespace
  sanitized = sanitized.replace(/[\u00A0\u2000-\u200F\u2028-\u202F\u205F\u3000]/g, ' ');
  
  return sanitized;
}

/**
 * Sanitize filename to prevent path traversal
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[\\/:*?"<>|]/g, '_') // Replace invalid chars
    .replace(/\.\.+/g, '.') // Prevent directory traversal
    .slice(0, 255); // Max filename length
}

/**
 * Create a timeout promise
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: Error = new Error('Operation timed out')): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(timeoutError), ms)),
  ]);
}

/**
 * Validate parsed course data
 */
export interface ParsedCourse {
  name: string;
  code: string;
  day: string;
  timeSlot: string;
  duration: number;
  location: { campus: string; building: string; room: string };
  teacher: { name: string; title?: string };
  classes: { grade: string; major: string; classNumber?: string }[];
  weekPattern: 'full' | 'specific';
  specificWeeks?: number[];
}

export function validateCourse(course: Partial<ParsedCourse>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!course.name || course.name.trim().length === 0) {
    errors.push('课程名不能为空');
  }
  if (course.name && course.name.length > 200) {
    errors.push('课程名过长（最多200字符）');
  }
  
  if (!course.code || course.code.trim().length === 0) {
    errors.push('课程代码不能为空');
  }
  
  if (!course.day) {
    errors.push('上课日期不能为空');
  }
  
  if (!course.timeSlot) {
    errors.push('上课节次不能为空');
  }
  
  if (!course.duration || course.duration < 1 || course.duration > 20) {
    errors.push('课程节数异常');
  }
  
  if (!course.location?.building || !course.location?.room) {
    errors.push('教学楼和教室不能为空');
  }
  
  if (!course.teacher?.name) {
    errors.push('教师姓名不能为空');
  }
  
  if (course.weekPattern === 'specific' && (!course.specificWeeks || course.specificWeeks.length === 0)) {
    errors.push('指定周模式必须包含周次');
  }
  
  if (course.specificWeeks) {
    for (const week of course.specificWeeks) {
      if (week < 1 || week > 20) {
        errors.push(`周次超出范围: ${week} (1-20)`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Resource limit checker for parsing operations
 */
export class ParseResourceLimiter {
  private startTime: number;
  private maxTimeMs: number;
  private cellCount: number = 0;
  private maxCells: number;
  
  constructor(maxTimeMs: number = PARSE_TIMEOUT_MS, maxCells: number = MAX_XLSX_ROWS * 20) {
    this.startTime = Date.now();
    this.maxTimeMs = maxTimeMs;
    this.maxCells = maxCells;
  }
  
  checkCell(): void {
    this.cellCount++;
    if (this.cellCount > this.maxCells) {
      throw new Error(`解析单元格数量超过限制 (${this.maxCells})`);
    }
  }
  
  checkTime(): void {
    if (Date.now() - this.startTime > this.maxTimeMs) {
      throw new Error(`解析超时 (${this.maxTimeMs}ms)`);
    }
  }
  
  getStats() {
    return { cellCount: this.cellCount, elapsedMs: Date.now() - this.startTime };
  }
}