import type { ICourseCodeParser, ParsedCourseCode } from './ICourseCodeParser';

/**
 * "Default" parser — the original Chinese university course code:
 *   9 digits `-` 2 uppercase letters + 5 digits + `.` + 3 digits
 * e.g. `202420241-CS10101.001`.
 *
 * Matches anywhere in the line; returns the matched prefix trimmed from
 * `rest` so downstream parsers (week / location) don't re-process it.
 */
export class DefaultCodeParser implements ICourseCodeParser {
  readonly id = 'university-code';

  // Compiled once, reused across calls.
  // eslint-disable-next-line no-useless-escape
  private static readonly PATTERN = /(\d{9})-([A-Z]{2}\d{5}\.\d{3})/;

  parse(line: string): ParsedCourseCode {
    const match = line.match(DefaultCodeParser.PATTERN);
    if (!match || match.index === undefined) {
      return { code: null, rest: line };
    }
    return {
      code: match[0],
      rest: line.slice(match.index + match[0].length).trim(),
    };
  }
}