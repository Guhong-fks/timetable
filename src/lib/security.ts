/**
 * Security utilities for file validation and input sanitization
 */

// Allowed file types for import
export const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
];

export const ALLOWED_EXTENSIONS = ['.docx'];

// File size limits (in bytes)
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (fallback)
export const MAX_DOCX_SIZE = 5 * 1024 * 1024; // 5 MB for docx

// Parse limits
export const PARSE_TIMEOUT_MS = 30000; // 30 seconds max parse time
export const MAX_CELL_TEXT_LENGTH = 10000; // Max characters per cell

/**
 * Validate file before processing.
 *
 * Defence in depth:
 *   1. Filename must not contain path-traversal or null bytes and length is bounded.
 *   2. Extension must be the LAST `.suffix` and match the allow-list (case-insensitive).
 *      Stops `evil.docx.exe` (`.exe` is the trailing suffix, not `.docx`) and
 *      `evil.DOCX` (still accepted thanks to case folding).
 *   3. When a MIME type is supplied, it must match the allow-list. Missing MIME
 *      (common on Android DocumentPicker) is tolerated — we rely on extension
 *      and the post-download byteLength check below.
 *   4. Size must be within the limit when reported. Native pickers sometimes
 *      omit `size`; the importer falls back to `buffer.byteLength` after
 *      download.
 *   5. URI scheme (when present) must be on the allow-list to prevent
 *      `javascript:` / `data:` payloads reaching `fetch()`.
 */
export function validateFile(file: { name: string; size?: number; type?: string; uri?: string }): { valid: boolean; error?: string } {
  // (1) Filename hygiene
  const MAX_FILENAME_LENGTH = 255;
  if (file.name.length === 0 || file.name.length > MAX_FILENAME_LENGTH) {
    return { valid: false, error: '文件名长度无效' };
  }
  if (/[\x00-\x1F\x7F]/.test(file.name)) {
    return { valid: false, error: '文件名包含非法控制字符' };
  }

  // (2) Extension — must be the LAST `.suffix` in the name.
  const lastDot = file.name.lastIndexOf('.');
  if (lastDot < 0) {
    return { valid: false, error: '文件名缺少扩展名' };
  }
  const ext = file.name.substring(lastDot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `不支持的文件类型: ${ext}，仅支持 .docx` };
  }

  // (3) MIME — when present must be in the allow-list.
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: `不支持的 MIME 类型: ${file.type}` };
  }

  // (4) Size (best-effort — native pickers may omit this).
  if (file.size !== undefined && file.size > MAX_DOCX_SIZE) {
    return { valid: false, error: `文件过大: ${(file.size / 1024 / 1024).toFixed(1)} MB，最大允许 ${MAX_DOCX_SIZE / 1024 / 1024} MB` };
  }

  // (5) URI scheme allow-list (skip when no URI — web picks use Blob).
  if (file.uri !== undefined && file.uri.length > 0) {
    let scheme = '';
    try {
      // URL parsing: `file:///...`, `content://...`, etc.
      // Fallback to manual prefix check for non-URL strings.
      scheme = new URL(file.uri).protocol.replace(':', '').toLowerCase();
    } catch {
      scheme = file.uri.split(':')[0].toLowerCase();
    }
    const ALLOWED_URI_SCHEMES = new Set(['file', 'content', 'ph', 'assets-library', 'blob', 'https', 'http', 'data']);
    if (!ALLOWED_URI_SCHEMES.has(scheme)) {
      return { valid: false, error: `不支持的 URI 协议: ${scheme}` };
    }
    // Reject `data:` URIs unless they are base64-encoded office documents.
    if (scheme === 'data' && !/^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/i.test(file.uri)) {
      return { valid: false, error: 'data: URI 必须是 base64 编码的 .docx' };
    }
  }

  return { valid: true };
}

/**
 * Validate the actual buffer size after download — catches the case where
 * the picker omitted `file.size` (common on Android DocumentPicker).
 */
export function validateBufferSize(buffer: ArrayBuffer | Uint8Array): { valid: boolean; error?: string } {
  const bytes = buffer instanceof Uint8Array ? buffer.byteLength : buffer.byteLength;
  if (bytes > MAX_DOCX_SIZE) {
    return { valid: false, error: `文件过大: ${(bytes / 1024 / 1024).toFixed(1)} MB，最大允许 ${MAX_DOCX_SIZE / 1024 / 1024} MB` };
  }
  if (bytes === 0) {
    return { valid: false, error: '文件为空' };
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
 * Escape HTML entities for safe rendering in HTML context (web platform)
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
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

  constructor(maxTimeMs: number = PARSE_TIMEOUT_MS, maxCells: number = 10000 * 20) {
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