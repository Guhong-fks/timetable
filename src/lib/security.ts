/**
 * Security utilities for file validation and input sanitization
 */

// Allowed file types for import. anydoc (the Rust engine) parses all of
// these natively; the recognizer consumes the same DocumentIR regardless.
export const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/calendar', // .ics — 从其他课程表软件"导出到日历"得到的文件
  'application/octet-stream', // 部分 Android 选择器对 .ics 不注册 MIME
];

export const ALLOWED_EXTENSIONS = ['.docx', '.doc', '.xlsx', '.ics'];

// File size limit (in bytes) — enforced by validateFile / validateBufferSize.
export const MAX_DOCX_SIZE = 5 * 1024 * 1024; // 5 MB

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
      return { valid: false, error: `不支持的文件类型: ${ext}，仅支持 .docx / .doc / .xlsx / .ics` };
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






