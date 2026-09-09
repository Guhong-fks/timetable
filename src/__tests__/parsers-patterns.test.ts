import {
  sanitizeInput,
  parseWeekPattern,
  tokenizeWeekSpec,
} from '@/lib/importers/parsers';

// The old ParserChain (Default/Generic/Fallback code parsers) was removed with
// the position-first recognizer. The canonical university code shape is kept
// here as a regression pin for documentation purposes.
const UNIVERSITY_CODE_PATTERN = /(\d{9})-([A-Z]{2}\d{5}\.\d{3})/;

describe('university course code shape (legacy pin)', () => {
  it('matches the documented format', () => {
    expect('202420241-CS10101.001'.match(UNIVERSITY_CODE_PATTERN)?.[0]).toBe('202420241-CS10101.001');
  });

  it('rejects malformed codes', () => {
    expect('2024-CS10101.001'.match(UNIVERSITY_CODE_PATTERN)).toBeNull();
    expect('202420241-CS101.001'.match(UNIVERSITY_CODE_PATTERN)).toBeNull();
    expect('202420241CS10101.001'.match(UNIVERSITY_CODE_PATTERN)).toBeNull();
    expect('20242024x-CS10101.001'.match(UNIVERSITY_CODE_PATTERN)).toBeNull();
  });
});

describe('tokenizeWeekSpec (state machine)', () => {
  it('emits a single token for "5周"', () => {
    expect(tokenizeWeekSpec('5周')).toEqual([{ type: 'single', n: 5 }]);
  });

  it('emits a range for "3-10周"', () => {
    expect(tokenizeWeekSpec('3-10周')).toEqual([{ type: 'range', from: 3, to: 10 }]);
  });

  it('emits a range with tilde "1~18周"', () => {
    expect(tokenizeWeekSpec('1~18周')).toEqual([{ type: 'range', from: 1, to: 18 }]);
  });

  it('emits three singles for "3,5,7周"', () => {
    expect(tokenizeWeekSpec('3,5,7周')).toEqual([
      { type: 'single', n: 3 },
      { type: 'single', n: 5 },
      { type: 'single', n: 7 },
    ]);
  });

  it('emits range + singles for "1,3-5,7周"', () => {
    expect(tokenizeWeekSpec('1,3-5,7周')).toEqual([
      { type: 'single', n: 1 },
      { type: 'range', from: 3, to: 5 },
      { type: 'single', n: 7 },
    ]);
  });

  it('expands chained "1-3-5周" into a single range 1..5', () => {
    // The state machine recognises the `3-5` chain as an extension of the
    // first range and widens `to` in place — so the emitted token is the
    // single range [1..5] that `parseWeekPattern` then expands into weeks.
    expect(tokenizeWeekSpec('1-3-5周')).toEqual([{ type: 'range', from: 1, to: 5 }]);
  });

  it('handles a reversed range "10-3周"', () => {
    expect(tokenizeWeekSpec('10-3周')).toEqual([{ type: 'range', from: 10, to: 3 }]);
  });

  it('handles surrounding whitespace', () => {
    expect(tokenizeWeekSpec(' 1 - 18 周 ')).toEqual([{ type: 'range', from: 1, to: 18 }]);
  });

  it('returns [] for empty input', () => {
    expect(tokenizeWeekSpec('')).toEqual([]);
  });

  it('skips stray separators and unknown chars', () => {
    expect(tokenizeWeekSpec(',,,,')).toEqual([]);
    expect(tokenizeWeekSpec('XYZ')).toEqual([]);
  });
});

describe('parseWeekPattern (regression coverage unchanged)', () => {
  // These mirror the cases in parseWeekPattern.test.ts; we keep them here
  // to prove the new state machine preserves the documented behaviour.
  // The `warnings` field is always present; we don't pin it here because
  // there's a dedicated suite covering warning emission.
  it('parses "1-18周" as full semester', () => {
    const r = parseWeekPattern('1-18周');
    expect(r.weekList.length).toBe(18);
    expect(r.isOddEven).toBeNull();
  });

  it('parses "3,5,7周" as specific', () => {
    const r = parseWeekPattern('3,5,7周');
    expect(r.weekList).toEqual([3, 5, 7]);
    expect(r.isOddEven).toBeNull();
  });

  it('parses chained "1-3-5周" without dropping 4', () => {
    const r = parseWeekPattern('1-3-5周');
    expect(r.weekList).toEqual([1, 2, 3, 4, 5]);
    expect(r.isOddEven).toBeNull();
  });

  it('parses "1-5,7-9周" without duplicates', () => {
    const r = parseWeekPattern('1-5,7-9周');
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 7, 8, 9]);
    expect(r.isOddEven).toBeNull();
  });

  it('parses reversed "10-3周"', () => {
    const r = parseWeekPattern('10-3周');
    expect(r.weekList).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.isOddEven).toBeNull();
  });
});

describe('sanitizeInput (merged regex + new guards)', () => {
  it('strips bidi and zero-width characters', () => {
    const raw = '\u202E博学\u200B\uFEFF楼';
    expect(sanitizeInput(raw)).toBe('博学楼');
  });

  it('strips control characters but keeps \t and \n', () => {
    const raw = 'a\x00b\x07c\td\ne\x01f';
    expect(sanitizeInput(raw)).toBe('a b c\td\ne f');
  });

  it('normalises exotic whitespace to plain space', () => {
    expect(sanitizeInput('foo\u00A0bar\u3000baz')).toBe('foo bar baz');
  });

  it('folds multi-line runs to a single \n', () => {
    expect(sanitizeInput('a\n\n\nb\r\n\r\nc')).toBe('a\nb\nc');
  });

  it('respects maxLength', () => {
    expect(sanitizeInput('abcdef', 3)).toBe('abc');
  });

  it('drops content if preserveWhitespace=false', () => {
    expect(sanitizeInput('  abc  ', 100, false)).toBe('abc');
  });

  it('returns "" for empty input', () => {
    expect(sanitizeInput('')).toBe('');
  });
});
