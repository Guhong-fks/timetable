/**
 * Pure scoring helpers for picking the most "timetable-like" table out of
 * an IR document. Kept in its own module so it can be unit-tested without
 * pulling in the native bridge or the importer's async pipeline.
 *
 * The scoring is intentionally simple — keyword coverage + a structural
 * bonus for tables wide/deep enough to plausibly be a course grid. Real
 * accuracy lives in the per-cell parsing downstream; this module only
 * picks a sensible winner when the document contains more than one table.
 */

// =============================================================================
// Input contract
// -----------------------------------------------------------------------------
// Loosely typed on purpose: this module only cares about the columns/rows
// shape and a way to pull text out of cells. Importers can adapt their IR
// type to `ScorableTable` via a structural cast.
// =============================================================================

export interface ScorableCell {
  /** Cell-level text in some flattened representation. */
  text: string;
}

export type ScorableRow = readonly ScorableCell[];

export interface ScorableTable {
  rows: readonly ScorableRow[];
}

// =============================================================================
// Helpers
// =============================================================================

const PERIOD_KEYWORDS = /(?:节次|Period|period|Class|节数)/;
const DAY_KEYWORDS = /(周一|周二|周三|周四|周五|周六|周日|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/gi;

/**
 * Flatten every cell text in a table into a single newline-joined string.
 * The caller decides whether paragraphs should be joined; we use a simple
 * newline for now and let the score function key off substring matches.
 */
export function extractAllTextFromTable(table: ScorableTable): string {
  const lines: string[] = [];
  for (const row of table.rows) {
    for (const cell of row) {
      const text = (cell.text ?? '').trim();
      if (text) lines.push(text);
    }
  }
  return lines.join('\n');
}

/**
 * Score a single table for how likely it is to be a course schedule.
 *
 * Scoring (kept deliberately explainable):
 *   +10  contains an explicit period header ("节次", "Period", ...)
 *   +8   ≥5 day-keyword hits (周一..周日 / Mon..Sun) anywhere in the text
 *   +5   structural bonus: rowCount > 5 AND colCount > 4
 */
export function scoreTable(table: ScorableTable): number {
  let score = 0;
  const flatText = extractAllTextFromTable(table);

  if (PERIOD_KEYWORDS.test(flatText)) score += 10;

  const dayHits = flatText.match(DAY_KEYWORDS);
  if (dayHits && dayHits.length >= 5) score += 8;

  const rowCount = table.rows.length;
  const colCount = table.rows[0]?.length ?? 0;
  if (rowCount > 5 && colCount > 4) score += 5;

  return score;
}

/**
 * Pick the most timetable-like table from a list. Returns `null` only
 * when the input is empty. Tie-breaks favour the leftmost table.
 *
 * @param tables  at least one table, or null
 * @param scoreThreshold  scores below this trigger a "low confidence"
 *                        marker so the caller can prompt the user. Default 5.
 */
export interface SelectBestTableResult {
  selected: ScorableTable | null;
  /** The winning score. -Infinity when no tables were supplied. */
  score: number;
  /** True when the winning score is below `scoreThreshold`. */
  lowConfidence: boolean;
}

export function selectBestTable(
  tables: readonly ScorableTable[],
  scoreThreshold: number = 5,
): SelectBestTableResult {
  if (tables.length === 0) {
    return { selected: null, score: -Infinity, lowConfidence: true };
  }
  if (tables.length === 1) {
    const score = scoreTable(tables[0]);
    return {
      selected: tables[0],
      score,
      lowConfidence: score < scoreThreshold,
    };
  }

  let bestTable: ScorableTable = tables[0];
  let bestScore = -Infinity;
  for (const table of tables) {
    const score = scoreTable(table);
    if (score > bestScore) {
      bestScore = score;
      bestTable = table;
    }
  }

  return {
    selected: bestTable,
    score: bestScore,
    lowConfidence: bestScore < scoreThreshold,
  };
}