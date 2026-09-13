// =============================================================================
// decodeIcsText — encoding robustness (P0)
// -----------------------------------------------------------------------------
// BOM sniffing (UTF-8 / UTF-16LE / UTF-16BE) + strict UTF-8 with a clear
// localised error for legacy encodings (GBK) instead of silent U+FFFD garbage.
// =============================================================================
import { decodeIcsText } from '@/lib/importers/timetable-importer';

/** UTF-8 bytes → ArrayBuffer (no BOM). */
function utf8(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

/** UTF-16LE with BOM (Windows 日历/Outlook 导出常见). */
function utf16Le(s: string): ArrayBuffer {
  const bytes: number[] = [0xff, 0xfe];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    bytes.push(code & 0xff, code >> 8);
  }
  return new Uint8Array(bytes).buffer;
}

/** UTF-16BE with BOM. */
function utf16Be(s: string): ArrayBuffer {
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    bytes.push(code >> 8, code & 0xff);
  }
  return new Uint8Array(bytes).buffer;
}

/** '大学物理A（下）第1 - 2节' encoded as GBK (Windows 课表导出的常见编码). */
const GBK_BYTES = new Uint8Array([
  0xb4, 0xf3, 0xd1, 0xa7, 0xce, 0xef, 0xc0, 0xed, 0x41, 0xa3, 0xa8, 0xcf,
  0xc2, 0xa3, 0xa9, 0xb5, 0xda, 0x31, 0x20, 0x2d, 0x20, 0x32, 0xbd, 0xda,
]).buffer;

describe('decodeIcsText', () => {
  it('decodes plain UTF-8 (no BOM)', () => {
    const { text, encoding } = decodeIcsText(utf8('BEGIN:VCALENDAR\r\nSUMMARY:大学物理A\r\nEND:VCALENDAR'));
    expect(encoding).toBe('utf-8');
    expect(text).toContain('SUMMARY:大学物理A');
  });

  it('strips a UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...Array.from(new TextEncoder().encode('SUMMARY:高等数学'))]).buffer;
    const { text, encoding } = decodeIcsText(withBom);
    expect(encoding).toBe('utf-8');
    expect(text.startsWith('SUMMARY:高等数学')).toBe(true);
  });

  it('decodes UTF-16LE with BOM', () => {
    const { text, encoding } = decodeIcsText(utf16Le('BEGIN:VEVENT\r\nSUMMARY:大学物理'));
    expect(encoding).toBe('utf-16le');
    expect(text).toContain('SUMMARY:大学物理');
  });

  it('decodes UTF-16BE with BOM via the manual decoder', () => {
    const { text, encoding } = decodeIcsText(utf16Be('BEGIN:VEVENT\r\nSUMMARY:数字电路'));
    expect(encoding).toBe('utf-16be');
    expect(text).toContain('SUMMARY:数字电路');
  });

  it('rejects GBK with a clear localised error instead of importing garbage', () => {
    expect(() => decodeIcsText(GBK_BYTES)).toThrow(/文件编码无法识别/);
  });
});
