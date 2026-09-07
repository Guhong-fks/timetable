/**
 * Course-code parser strategy contract.
 *
 * Implementations try to extract a course code (or, in the no-code case, a
 * course name) from a single line of cell text. Parsing is **synchronous**;
 * async work — like reading the user's regex from storage — happens in
 * {@link createParserChain} before the chain is handed to the importer.
 *
 * Return shape:
 *   - `code`:  the recognised identifier (e.g. `202420241-CS10101.001`), or
 *               `null` when this strategy didn't recognise anything.
 *   - `rest`:  the remainder of the line with the matched prefix trimmed,
 *               so downstream parsers (week pattern / location / teacher)
 *               don't re-scan the code.
 *   - `name`:  optional course-name hint. Only set by strategies that
 *               recognised enough surrounding context (FallbackParser uses
 *               it to surface a course-name even when no code matched).
 */
export interface ParsedCourseCode {
  code: string | null;
  rest: string;
  name?: string;
}

export interface ICourseCodeParser {
  /**
   * Strategy id used in warnings / debugging. Keep it short and stable —
   * changing it breaks log filters downstream.
   */
  readonly id: string;

  parse(line: string): ParsedCourseCode;
}