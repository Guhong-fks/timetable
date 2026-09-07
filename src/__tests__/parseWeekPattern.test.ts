import { parseWeekPattern } from '@/lib/importers/parsers';

describe('parseWeekPattern', () => {
  it('parses full semester "1-18周"', () => {
    const result = parseWeekPattern('1-18周');
    expect(result.weekPattern).toBe('full');
    expect(result.specificWeeks).toBeUndefined();
  });

  it('parses "1~18周" with tilde', () => {
    const result = parseWeekPattern('1~18周');
    expect(result.weekPattern).toBe('full');
  });

  it('parses single weeks "3,5,7周"', () => {
    const result = parseWeekPattern('3,5,7周');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([3, 5, 7]);
  });

  it('parses mixed "1,3-5,7周"', () => {
    const result = parseWeekPattern('1,3-5,7周');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([1, 3, 4, 5, 7]);
  });

  it('parses "3-10周"', () => {
    const result = parseWeekPattern('3-10周');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('handles empty string', () => {
    const result = parseWeekPattern('');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([]);
  });

  it('handles whitespace', () => {
    const result = parseWeekPattern(' 1 - 18 周 ');
    expect(result.weekPattern).toBe('full');
  });

  // Regression: chained ranges like "1-3-5周" used to drop 4 because
  // two-pass regex state machines conflicted. Must now expand fully.
  it('handles chained range "1-3-5周"', () => {
    const result = parseWeekPattern('1-3-5周');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([1, 2, 3, 4, 5]);
  });

  // Regression: "1-5,7-9周" should still dedupe across multiple ranges.
  it('handles multiple ranges without duplicates', () => {
    const result = parseWeekPattern('1-5,7-9周');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([1, 2, 3, 4, 5, 7, 8, 9]);
  });

  it('handles overlapping ranges without duplicates', () => {
    const result = parseWeekPattern('1-5,3-7周');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles a single number "5周"', () => {
    const result = parseWeekPattern('5周');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([5]);
  });

  it('handles reversed range "10-3周"', () => {
    const result = parseWeekPattern('10-3周');
    expect(result.weekPattern).toBe('specific');
    expect(result.specificWeeks).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });
});