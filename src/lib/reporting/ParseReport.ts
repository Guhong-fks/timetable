import type { ReportWarning, ReportCategory, ReportSeverity } from './types';

/**
 * Single source of truth for parse warnings emitted during one import run.
 *
 * The instance is reset at the start of every {@link import('@/lib/importers/timetable-importer').parseDocxFile}
 * call so a fresh import never inherits warnings from a previous one.
 *
 * Why a singleton and not function-scoped state:
 *   - The parser chain (`ParserChain`) and `normaliseBlock` are already
 *     deeply nested; passing a `report` argument through every call would
 *     explode the surface area. A shared instance is the lowest-friction
 *     way to collect from anywhere.
 *   - Consumers (the importer entry point) read the singleton exactly
 *     once per import, then snapshot it into the returned `ImportResult`.
 *
 * Threading caveat (jest): tests run the same module instance, so a test
 * that does not call `clear()` will leak warnings into the next test.
 * Production code always calls `clear()` at the entry of `parseDocxFile`.
 */
export class ParseReport {
  private static _instance: ParseReport | null = null;

  static getInstance(): ParseReport {
    if (!ParseReport._instance) ParseReport._instance = new ParseReport();
    return ParseReport._instance;
  }

  /** Test helper: drop the cached singleton. Production code uses `clear()`. */
  static resetInstance(): void {
    ParseReport._instance = null;
  }

  warnings: ReportWarning[] = [];
  /** Suggested actions the UI can show ("导出文件"、"重新导入"、"联系开发者"). */
  suggestions: string[] = [];

  /**
   * Clear the report. Called at the entry of every import so previous
   * runs don't pollute the current one.
   */
  clear(): void {
    this.warnings = [];
    this.suggestions = [];
  }

  /**
   * Add a single warning. `at` is stamped automatically so the UI can
   * sort / group by freshness if it ever needs to.
   */
  addWarning(input: Omit<ReportWarning, 'at'> & { at?: number }): void {
    this.warnings.push({ ...input, at: input.at ?? Date.now() });
  }

  /**
   * Convenience overload — mirrors the old `ctx.warnings.push(...)` shape
   * from the parsers so callers don't need to repeat the category /
   * severity boilerplate at every push site.
   */
  addWarningFromParts(
    category: ReportCategory,
    severity: ReportSeverity,
    message: string,
    ref?: ReportWarning['ref'],
    rawText?: string,
  ): void {
    this.addWarning({
      category,
      severity,
      message,
      ref,
      rawText,
    });
  }

  addSuggestion(message: string): void {
    if (!this.suggestions.includes(message)) this.suggestions.push(message);
  }

  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  hasErrors(): boolean {
    return this.warnings.some((w) => w.severity === 'error');
  }

  /** Filtered view for UI grouping. Returns a fresh array each call. */
  byCategory(category: ReportCategory): ReportWarning[] {
    return this.warnings.filter((w) => w.category === category);
  }

  /**
   * Snapshot the report so it can be attached to an `ImportResult`.
   * Returns a structurally-cloned object — mutating the snapshot later
   * does NOT mutate the singleton (which keeps accepting new entries).
   */
  snapshot(): { warnings: ReportWarning[]; suggestions: string[] } {
    return {
      warnings: this.warnings.map((w) => ({ ...w, ref: w.ref ? { ...w.ref } : undefined })),
      suggestions: [...this.suggestions],
    };
  }
}

/**
 * Build a ParseReport-shaped object from arrays of warnings. Used by the
 * importer to assemble the final report from the local `warnings[]`
 * accumulator (kept inside `parseDocxFile` so unit tests can run without
 * touching the singleton).
 */
export function buildReportFromLists(
  warnings: ReportWarning[],
  suggestions: string[] = [],
): { warnings: ReportWarning[]; suggestions: string[] } {
  return { warnings, suggestions };
}