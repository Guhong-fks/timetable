import type { ICourseCodeParser, ParsedCourseCode } from './ICourseCodeParser';
import { DefaultCodeParser } from './DefaultParser';
import { GenericCodeParser } from './GenericParser';
import { FallbackParser } from './FallbackParser';

/**
 * User-defined parser — top of the chain. Holds a single `RegExp` that
 * the user configured in app settings. When `pattern` is `null`, the
 * strategy short-circuits and the chain falls through to the next parser.
 *
 * Constructed synchronously; the caller (typically `createParserChain`)
 * reads AsyncStorage once up front and passes the resulting `RegExp`
 * here.
 */
export class UserDefinedParser implements ICourseCodeParser {
  readonly id = 'user-defined';

  constructor(private readonly pattern: RegExp | null) {}

  parse(line: string): ParsedCourseCode {
    if (!this.pattern) return { code: null, rest: line };
    const match = line.match(this.pattern);
    if (!match || match.index === undefined) return { code: null, rest: line };
    return {
      code: match[0],
      rest: line.slice(match.index + match[0].length).trim(),
    };
  }
}

/**
 * Sequential strategy chain. Order matters — the first parser that
 * recognises the line wins. Add user-defined strategies first so user
 * config beats any built-in.
 */
export class ParserChain {
  private readonly parsers: ICourseCodeParser[] = [];

  addParser(parser: ICourseCodeParser): this {
    this.parsers.push(parser);
    return this;
  }

  /**
   * Run the chain. Always returns a `ParsedCourseCode` — at minimum the
   * terminal FallbackParser produces one with `code: null` and a `name`.
   */
  parse(line: string): ParsedCourseCode {
    for (const parser of this.parsers) {
      const result = parser.parse(line);
      if (result.code !== null) return result;
    }
    // Should be unreachable: the chain must end with a FallbackParser.
    // If a caller forgets to install one, default-include it here so we
    // never silently lose a line.
    return new FallbackParser().parse(line);
  }
}

export const USER_REGEX_STORAGE_KEY = 'user_course_code_regex';

/**
 * Async factory — loads the user's regex from storage exactly once and
 * returns a fully-wired chain. The chain is then reused synchronously
 * for every `extractBlocksFromCell` invocation in the import.
 */
export async function createParserChain(): Promise<ParserChain> {
  const { getStoredValue } = await import('@/lib/storage');
  const userRegexStr = await getStoredValue(USER_REGEX_STORAGE_KEY);
  let userPattern: RegExp | null = null;
  if (userRegexStr) {
    try {
      userPattern = new RegExp(userRegexStr);
    } catch (error) {
      // Invalid user-supplied regex — log and skip; fall through to the
      // built-in strategies instead of breaking the whole import.
      console.warn(`[ParserChain] invalid user regex "${userRegexStr}":`, error);
      userPattern = null;
    }
  }

  const chain = new ParserChain();
  chain.addParser(new UserDefinedParser(userPattern));
  chain.addParser(new DefaultCodeParser());
  chain.addParser(new GenericCodeParser());
  chain.addParser(new FallbackParser());
  return chain;
}

// Convenience for tests / non-storage callers that want the
// built-in-only chain without touching AsyncStorage.
export function createBuiltInParserChain(): ParserChain {
  const chain = new ParserChain();
  chain.addParser(new DefaultCodeParser());
  chain.addParser(new GenericCodeParser());
  chain.addParser(new FallbackParser());
  return chain;
}