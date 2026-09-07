import type { ICourseCodeParser, ParsedCourseCode } from './ICourseCodeParser';

/**
 * Final fallback — accepts the entire line as a self-contained
 * `name + schedule` payload. Used when no regex-based strategy matched a
 * course code, so primary-school style rows like
 *   `高等数学 1-8周 教101`
 * still get a name out instead of being dropped.
 *
 * Splitting rules:
 *   - The first whitespace-separated token becomes the course `name`.
 *   - Everything after the first space is left in `rest` so the importer
 *     can run the schedule / location parsers on it.
 *
 * This strategy **never** reports `code !== null`; it exists purely to
 * salvage a course name. The importer's normaliser is responsible for
 * deciding whether the line produced a usable `RawCourseBlock`.
 */
export class FallbackParser implements ICourseCodeParser {
  readonly id = 'no-code-fallback';

  parse(line: string): ParsedCourseCode {
    const trimmed = line.trim();
    if (!trimmed) return { code: null, rest: line };

    const firstSpace = trimmed.search(/\s/);
    if (firstSpace < 0) {
      // Single token: treat the whole line as the course name; nothing to
      // hand to the schedule / location parsers.
      return { code: null, rest: '', name: trimmed };
    }
    const name = trimmed.slice(0, firstSpace);
    const rest = trimmed.slice(firstSpace + 1).trim();
    return { code: null, rest, name };
  }
}