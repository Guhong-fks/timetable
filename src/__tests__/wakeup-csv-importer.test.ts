import { parseWakeupCsv } from '@/lib/importers/wakeup-csv-importer';
import { parseTimetableFile } from '@/lib/importers/timetable-importer';
import { validateFile } from '@/lib/security';
import { WeekDay } from '@/types/timetable';

const WAKEUP_CSV = [
  '课程名称,星期,开始节数,结束节数,老师,地点,周数',
  '"高等数学,甲",1,1,2,张三,"逸夫楼,101","1-5、7-11单"',
  '大学计算机,5,1,2,李四,无,1-16',
  '有机化学,4,3,4,无,逸夫楼108,1-5',
].join('\r\n');

describe('WakeUp CSV importer', () => {
  it('parses the documented template, quoted fields, ranges and odd weeks', () => {
    const result = parseWakeupCsv(WAKEUP_CSV);

    expect(result).toMatchObject({ totalRows: 3, droppedRows: 0 });
    expect(result.courses).toHaveLength(3);
    expect(result.courses[0]).toMatchObject({
      name: '高等数学,甲',
      day: WeekDay.MONDAY,
      startPeriod: 1,
      endPeriod: 2,
      duration: 2,
      teacher: { name: '张三' },
      location: { address: '逸夫楼,101' },
      weekList: [1, 3, 5, 7, 9, 11],
      isOddEven: 'odd',
    });
  });

  it('maps columns by header, tolerates extra columns and normalizes 无', () => {
    const csv = [
      '周数,地点,课程名称,星期,教师,结束节数,开始节数,备注',
      '1-4双,"A楼, 101",数据结构,2,李老师,4,3,实验课',
    ].join('\n');
    const result = parseWakeupCsv(csv);

    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]).toMatchObject({
      name: '数据结构',
      day: WeekDay.TUESDAY,
      startPeriod: 3,
      endPeriod: 4,
      teacher: { name: '李老师' },
      location: { address: 'A楼, 101' },
      weekList: [2, 4],
      isOddEven: 'even',
    });
  });

  it('skips malformed rows with row diagnostics but keeps valid courses', () => {
    const csv = [
      '课程名称,星期,开始节数,结束节数,老师,地点,周数',
      '有效课程,1,1,2,老师,教室,1-16',
      '错误课程,周一,1,2,老师,教室,1-16',
      '无周次课程,2,3,4,老师,教室,未知',
    ].join('\n');
    const result = parseWakeupCsv(csv);

    expect(result.courses).toHaveLength(1);
    expect(result.totalRows).toBe(3);
    expect(result.droppedRows).toBe(2);
    expect(result.diagnostics.map((issue) => issue.row)).toEqual([3, 4]);
  });

  it('rejects a file without the required WakeUp template headers', () => {
    expect(() => parseWakeupCsv('课程,星期,节数\n数学,1,1')).toThrow(/表头/);
  });

  it('accepts CSV files and routes them through the preview-ready importer', async () => {
    const bytes = new TextEncoder().encode(WAKEUP_CSV);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(validateFile({ name: 'WakeUp.csv', type: 'text/csv' })).toEqual({ valid: true });

    const result = await parseTimetableFile({
      name: 'WakeUp.csv',
      type: 'text/csv',
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    });

    expect(result.courses).toHaveLength(3);
    expect(result.report.warnings).toHaveLength(0);
  });

  it('decodes spreadsheet UTF-16LE CSV exports with a BOM', async () => {
    const bytes = new Uint8Array(2 + WAKEUP_CSV.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let index = 0; index < WAKEUP_CSV.length; index += 1) {
      const codeUnit = WAKEUP_CSV.charCodeAt(index);
      bytes[2 + index * 2] = codeUnit & 0xff;
      bytes[3 + index * 2] = codeUnit >> 8;
    }
    const buffer = bytes.buffer;
    const result = await parseTimetableFile({
      name: 'WakeUp.csv',
      type: 'text/csv',
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    });

    expect(result.courses).toHaveLength(3);
  });

  it('recovers week ranges that WPS/Excel auto-formatted as dates', () => {
    const csv = [
      '课程名称,星期,开始节数,结束节数,老师,地点,周数',
      '第一周次,1,1,2,老师,教室,1月5日',
      '第二周次,2,1,2,老师,教室,2026年9月13日',
      '第三周次,3,1,2,老师,教室,9/13/2026',
    ].join('\n');
    const result = parseWakeupCsv(csv);

    expect(result.courses.map((course) => course.weekList)).toEqual([
      [1, 2, 3, 4, 5],
      [9, 10, 11, 12, 13],
      [9, 10, 11, 12, 13],
    ]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('rejects malformed quoted CSV rather than silently shifting columns', () => {
    expect(() => parseWakeupCsv(
      '课程名称,星期,开始节数,结束节数,老师,地点,周数\n"未闭合课程,1,1,2,老师,教室,1-16',
    )).toThrow(/引号/);
  });
});
