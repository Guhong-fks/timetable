import type { ICourseCodeParser, ParsedCourseCode } from './ICourseCodeParser';

/**
 * Generic parser — picks up codes that don't follow the strict university
 * format. Two patterns run side-by-side:
 *
 *   1. Western: `[A-Z]{2,4}\s*\d{3,5}` (e.g. `CS101`, `MATH2042`,
 *      optionally with a space between letters and digits).
 *   2. CJK subject + number: `[\u4e00-\u9fa5]+\s*\d{3,5}` (e.g. `语文101`,
 *      `数学 203`).
 *
 * Used for primary/secondary school timetables and overseas universities
 * that don't emit the strict `NNNNNNNNN-XXXXX.XXX` shape.
 */
export class GenericCodeParser implements ICourseCodeParser {
  readonly id = 'generic-code';

  private static readonly PATTERNS: readonly RegExp[] = [
    // Western: 2-4 uppercase letters, optional whitespace, 3-5 digits.
    /\b[A-Z]{2,4}\s*\d{3,5}\b/,
    // CJK subject name (≥1 char) + 3-5 digits.
    /[\u4e00-\u9fa5]{1,8}\s*\d{3,5}/,
  ];

  parse(line: string): ParsedCourseCode {
    for (const pattern of GenericCodeParser.PATTERNS) {
      const match = line.match(pattern);
      if (match && match.index !== undefined) {
        return {
          code: match[0],
          rest: line.slice(match.index + match[0].length).trim(),
        };
      }
    }
    return { code: null, rest: line };
  }
}