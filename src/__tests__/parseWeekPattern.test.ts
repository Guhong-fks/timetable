import {
  parseWeekPattern,
  DEFAULT_SEMESTER_TOTAL_WEEKS,
} from '@/lib/importers/parsers';

/**
 * Helpers used across the v4-shape assertions.
 *
 *   - `expectFull(result)` — the parser produced a full-semester list
 *     (contiguous from 1, length ≥ 18, no odd/even marker).
 *   - `expectSpecific(result, expected)` — produced exactly `expected`.
 */
function expectFull(result: ReturnType<typeof parseWeekPattern>) {
  expect(result.isOddEven).toBeNull();
  expect(result.weekList[0]).toBe(1);
  expect(result.weekList.length).toBeGreaterThanOrEqual(18);
  expect(
    result.weekList.every((w, i) => i === 0 || w === result.weekList[i - 1] + 1),
  ).toBe(true);
}

function expectSpecific(
  result: ReturnType<typeof parseWeekPattern>,
  expected: number[],
) {
  expect(result.weekList).toEqual(expected);
  expect(result.isOddEven).toBeNull();
}

describe('parseWeekPattern — v4 shape (weekList + isOddEven)', () => {
  it('parses full semester "1-18周"', () => {
    const r = parseWeekPattern('1-18周');
    expectFull(r);
    expect(r.weekList.length).toBe(18);
  });

  it('parses "1~18周" with tilde', () => {
    const r = parseWeekPattern('1~18周');
    expectFull(r);
  });

  it('parses single weeks "3,5,7周"', () => {
    const r = parseWeekPattern('3,5,7周');
    expectSpecific(r, [3, 5, 7]);
  });

  it('parses mixed "1,3-5,7周"', () => {
    const r = parseWeekPattern('1,3-5,7周');
    expectSpecific(r, [1, 3, 4, 5, 7]);
  });

  it('parses "3-10周"', () => {
    const r = parseWeekPattern('3-10周');
    expectSpecific(r, [3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('handles empty string', () => {
    const r = parseWeekPattern('');
    expect(r.weekList).toEqual([]);
    expect(r.isOddEven).toBeUndefined();
  });

  it('handles whitespace', () => {
    const r = parseWeekPattern(' 1 - 18 周 ');
    expectFull(r);
  });

  // Regression: chained ranges like "1-3-5周" used to drop 4 because
  // two-pass regex state machines conflicted. Must now expand fully.
  it('handles chained range "1-3-5周"', () => {
    const r = parseWeekPattern('1-3-5周');
    expectSpecific(r, [1, 2, 3, 4, 5]);
  });

  // Regression: "1-5,7-9周" should still dedupe across multiple ranges.
  it('handles multiple ranges without duplicates', () => {
    const r = parseWeekPattern('1-5,7-9周');
    expectSpecific(r, [1, 2, 3, 4, 5, 7, 8, 9]);
  });

  it('handles overlapping ranges without duplicates', () => {
    const r = parseWeekPattern('1-5,3-7周');
    expectSpecific(r, [1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles a single number "5周"', () => {
    const r = parseWeekPattern('5周');
    expectSpecific(r, [5]);
  });

  it('handles reversed range "10-3周"', () => {
    const r = parseWeekPattern('10-3周');
    expectSpecific(r, [3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // ---- New v4 capabilities ----

  it('expands "单周" alone into all odd weeks for a 18-week semester', () => {
    const r = parseWeekPattern('单周');
    expect(r.isOddEven).toBe('odd');
    expect(r.weekList).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17]);
  });

  it('expands "双周" alone into all even weeks for a 18-week semester', () => {
    const r = parseWeekPattern('双周');
    expect(r.isOddEven).toBe('even');
    expect(r.weekList).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it('intersects "1-8周 单周" → odd weeks within 1..8', () => {
    const r = parseWeekPattern('1-8周 单周');
    expect(r.isOddEven).toBe('odd');
    expect(r.weekList).toEqual([1, 3, 5, 7]);
  });

  it('intersects "1-8周 双周" → even weeks within 1..8', () => {
    const r = parseWeekPattern('1-8周 双周');
    expect(r.isOddEven).toBe('even');
    expect(r.weekList).toEqual([2, 4, 6, 8]);
  });

  it('treats "1-8周 单周 双周" as full range + warning', () => {
    const r = parseWeekPattern('1-8周 单周 双周');
    expect(r.isOddEven).toBeNull();
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.warnings.some((w) => w.message.includes('单双周'))).toBe(true);
  });

  it('honours a custom totalWeeks for bare "单周"', () => {
    const r = parseWeekPattern('单周', 10);
    expect(r.isOddEven).toBe('odd');
    expect(r.weekList).toEqual([1, 3, 5, 7, 9]);
  });

  it('exposes DEFAULT_SEMESTER_TOTAL_WEEKS = 18', () => {
    expect(DEFAULT_SEMESTER_TOTAL_WEEKS).toBe(18);
  });
});