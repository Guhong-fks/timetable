import { parseLocationAndTeacher } from '@/lib/importers/parsers';

describe('parseLocationAndTeacher', () => {
  it('returns full address as `building` and extracts teacher', () => {
    const result = parseLocationAndTeacher('磬苑校区 博学楼 B101 张老师');
    expect(result.campus).toBe('磬苑校区');
    expect(result.building).toBe('博学楼 B101');
    expect(result.teacher).toBe('张老师');
  });

  it('handles building glued to room', () => {
    const result = parseLocationAndTeacher('磬苑校区 博学楼B101 李教授');
    expect(result.campus).toBe('磬苑校区');
    expect(result.building).toBe('博学楼B101');
    expect(result.teacher).toBe('李教授');
  });

  it('normalises 其他校区 to 其他', () => {
    const result = parseLocationAndTeacher('其他校区 图书馆 A202 王副教授');
    expect(result.campus).toBe('其他');
    expect(result.building).toBe('图书馆 A202');
    expect(result.teacher).toBe('王副教授');
  });

  it('handles missing teacher', () => {
    const result = parseLocationAndTeacher('磬苑校区 博学楼 B101');
    expect(result.campus).toBe('磬苑校区');
    expect(result.building).toBe('博学楼 B101');
    expect(result.teacher).toBe('未填写');
  });

  it('handles address with no room, just teacher', () => {
    const result = parseLocationAndTeacher('磬苑校区 博学楼 张老师');
    expect(result.building).toBe('博学楼');
    expect(result.teacher).toBe('张老师');
  });

  it('handles empty string', () => {
    const result = parseLocationAndTeacher('');
    expect(result.campus).toBe('磬苑校区');
    expect(result.building).toBe('未填写');
    expect(result.room).toBe('未填写');
    expect(result.teacher).toBe('未填写');
  });

  it('handles only campus', () => {
    const result = parseLocationAndTeacher('磬苑校区');
    expect(result.campus).toBe('磬苑校区');
    expect(result.building).toBe('未填写');
    expect(result.room).toBe('未填写');
    expect(result.teacher).toBe('未填写');
  });

  it('keeps long room numbers intact (no greedy split)', () => {
    // B101101 must NOT be split into B101 + 101.
    const result = parseLocationAndTeacher('磬苑校区 博学楼 B101101 张老师');
    expect(result.building).toBe('博学楼 B101101');
    expect(result.teacher).toBe('张老师');
  });

  it('trims leading separators from the address', () => {
    const result = parseLocationAndTeacher('磬苑校区、博学楼 B101 张老师');
    expect(result.building).toBe('博学楼 B101');
    expect(result.teacher).toBe('张老师');
  });

  it('recognises 望岳校区 and 翠园校区 as valid campus prefixes', () => {
    const result = parseLocationAndTeacher('望岳校区 笃行楼 C303 王老师');
    expect(result.campus).toBe('磬苑校区'); // legacy field still defaults
    expect(result.building).toBe('笃行楼 C303');
    expect(result.teacher).toBe('王老师');
  });

  it('handles compound surnames like 欧阳娜娜老师', () => {
    const result = parseLocationAndTeacher('磬苑校区 博学楼 B101 欧阳娜娜老师');
    expect(result.building).toBe('博学楼 B101');
    expect(result.teacher).toBe('欧阳娜娜老师');
  });

  it('handles middle-dot names like 买买提·艾力老师', () => {
    const result = parseLocationAndTeacher('磬苑校区 博学楼 B101 买买提·艾力老师');
    expect(result.teacher).toBe('买买提·艾力老师');
    expect(result.building).toBe('博学楼 B101');
  });

  it('handles additional title words like 工程师 / 研究员', () => {
    const result = parseLocationAndTeacher('其他校区 实验楼 Z001 李工程师');
    expect(result.teacher).toBe('李工程师');
    expect(result.building).toBe('实验楼 Z001');
  });
});