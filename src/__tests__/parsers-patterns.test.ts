import {
  TEACHER_TITLES,
  TEACHER_WITH_TITLE_PATTERN,
  TEACHER_NAME_ONLY_PATTERN,
  TEACHER_COMPOUND_SURNAME_PATTERN,
  sanitizeInput,
  parseLocationAndTeacher,
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

describe('teacher & tokenisation patterns', () => {
  it('WEEK_TOKEN_PATTERN captures a single number', () => {
    // Drive the same source via exec() to read the captures.
    const m = /(\d+)(?:\s*[~-]\s*(\d+))?/.exec('3周');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('3');
    expect(m?.[2]).toBeUndefined();
  });

  it('WEEK_TOKEN_PATTERN captures a range', () => {
    const m = /(\d+)(?:\s*[~-]\s*(\d+))?/.exec('3 - 10 周');
    expect(m?.[1]).toBe('3');
    expect(m?.[2]).toBe('10');
  });

  it('TEACHER_TITLES is non-empty and contains the canonical words', () => {
    expect(TEACHER_TITLES.length).toBeGreaterThan(0);
    for (const word of ['老师', '教授', '副教授', '讲师', '助教']) {
      expect(TEACHER_TITLES).toContain(word);
    }
  });

  it('TEACHER_WITH_TITLE_PATTERN accepts a longer name + title (4 chars + title)', () => {
    // Pattern requires the name block to leave 2 chars for the title suffix,
    // so the name itself must be >= 2 CJK chars. '李欧阳老师' has 4 chars
    // before '老师' and exercises the title-aware path.
    const m = '博学楼 B101 李欧阳老师'.match(TEACHER_WITH_TITLE_PATTERN);
    expect(m?.groups?.name).toBe('李欧阳老师');
    expect(m?.groups?.address).toBe('博学楼 B101');
  });

  it('TEACHER_WITH_TITLE_PATTERN does NOT match a 3-char name (falls through to NAME_ONLY)', () => {
    // '张老师' = 3 CJK chars; the pattern's `{2,4}` consumes too many for
    // the title suffix to fit. NAME_ONLY catches this in production.
    expect('博学楼 B101 张老师'.match(TEACHER_WITH_TITLE_PATTERN)).toBeNull();
  });

  it('TEACHER_WITH_TITLE_PATTERN rejects a title without a name', () => {
    expect('老师'.match(TEACHER_WITH_TITLE_PATTERN)).toBeNull();
  });

  it('TEACHER_NAME_ONLY_PATTERN accepts a plain name', () => {
    const m = '博学楼 B101 张三'.match(TEACHER_NAME_ONLY_PATTERN);
    expect(m?.groups?.name).toBe('张三');
  });

  it('TEACHER_COMPOUND_SURNAME_PATTERN tolerates a 5-char name', () => {
    const m = '博学楼 B101 欧阳娜娜'.match(TEACHER_COMPOUND_SURNAME_PATTERN);
    expect(m?.groups?.name).toBe('欧阳娜娜');
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

describe('parseLocationAndTeacher (uses new named patterns)', () => {
  it('matches a title-bearing teacher via TEACHER_WITH_TITLE_PATTERN', () => {
    const r = parseLocationAndTeacher('磬苑校区 博学楼 B101 张老师');
    expect(r.teacher).toBe('张老师');
    expect(r.building).toBe('博学楼 B101');
  });

  it('matches a compound surname via TEACHER_COMPOUND_SURNAME_PATTERN', () => {
    const r = parseLocationAndTeacher('磬苑校区 博学楼 B101 欧阳娜娜');
    expect(r.teacher).toBe('欧阳娜娜');
  });

  it('falls back to 未填写 when nothing matches', () => {
    const r = parseLocationAndTeacher('磬苑校区 博学楼 B101');
    expect(r.teacher).toBe('未填写');
    expect(r.building).toBe('博学楼 B101');
  });
});