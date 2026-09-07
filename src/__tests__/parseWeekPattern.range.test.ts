import {
  parseWeekPattern,
  DEFAULT_SEMESTER_TOTAL_WEEKS,
} from '@/lib/importers/parsers';

/**
 * Targeted coverage for the comma-separated range + odd/even matrix that
 * the original `parseWeekPattern.test.ts` only sketches. These cases pin
 * the v4 contract that downstream consumers (UI banner, week filtering)
 * rely on.
 */
describe('parseWeekPattern — comma-separated ranges', () => {
  it('expands "1-8,10-16周" into a contiguous union without dropping 9', () => {
    const r = parseWeekPattern('1-8,10-16周');
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]);
    expect(r.isOddEven).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it('deduplicates "1-5,3-7周" without sorting twice', () => {
    const r = parseWeekPattern('1-5,3-7周');
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles "1-8,10-16周 单周" → odd weeks across both ranges', () => {
    const r = parseWeekPattern('1-8,10-16周 单周');
    expect(r.isOddEven).toBe('odd');
    expect(r.weekList).toEqual([1, 3, 5, 7, 11, 13, 15]);
  });

  it('handles "1-8,10-16周 双周" → even weeks across both ranges', () => {
    const r = parseWeekPattern('1-8,10-16周 双周');
    expect(r.isOddEven).toBe('even');
    expect(r.weekList).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('treats "1-8,10-16周 单周 双周" as the full union with a warning', () => {
    const r = parseWeekPattern('1-8,10-16周 单周 双周');
    expect(r.isOddEven).toBeNull();
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]);
    expect(r.warnings.some((w) => w.message.includes('单双周'))).toBe(true);
  });

  it('clamps a range that exceeds MAX_WEEK (25) and warns', () => {
    const r = parseWeekPattern('1-8,30-40周');
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.warnings.some((w) => w.message.includes('上限'))).toBe(true);
  });
});

describe('parseWeekPattern — bare odd/even markers', () => {
  it('expands bare "单周" using DEFAULT_SEMESTER_TOTAL_WEEKS = 18', () => {
    const r = parseWeekPattern('单周');
    expect(r.isOddEven).toBe('odd');
    expect(r.weekList).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17]);
  });

  it('expands bare "双周" using DEFAULT_SEMESTER_TOTAL_WEEKS = 18', () => {
    const r = parseWeekPattern('双周');
    expect(r.isOddEven).toBe('even');
    expect(r.weekList).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it('honours an explicit totalWeeks (e.g. 10 weeks)', () => {
    const r = parseWeekPattern('单周', 10);
    expect(r.isOddEven).toBe('odd');
    expect(r.weekList).toEqual([1, 3, 5, 7, 9]);
  });

  it('exposes DEFAULT_SEMESTER_TOTAL_WEEKS = 18 for downstream math', () => {
    expect(DEFAULT_SEMESTER_TOTAL_WEEKS).toBe(18);
  });
});

describe('parseWeekPattern — input echo + isOddEven semantics', () => {
  it('echoes the original raw text on every result', () => {
    const r = parseWeekPattern('1-8,10-16周 单周');
    expect(r.rawText).toBe('1-8,10-16周 单周');
  });

  it('marks isOddEven = null (not undefined) when no marker is present', () => {
    const r = parseWeekPattern('1-8周');
    expect(r.isOddEven).toBeNull();
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('marks isOddEven = undefined when input is empty', () => {
    const r = parseWeekPattern('');
    expect(r.isOddEven).toBeUndefined();
    expect(r.weekList).toEqual([]);
  });
});