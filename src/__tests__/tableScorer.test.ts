import {
  scoreTable,
  selectBestTable,
  extractAllTextFromTable,
  type ScorableTable,
} from '@/lib/utils/tableScorer';

// =============================================================================
// Test fixtures
// -----------------------------------------------------------------------------
// We hand-build minimal `ScorableTable` shapes so the tests stay focused on
// the scoring/selection logic and don't need the full IR type.
// =============================================================================

const headerCells = (cells: string[]): { text: string }[] =>
  cells.map((text) => ({ text }));

const courseTable: ScorableTable = {
  rows: [
    headerCells(['节次', '周一', '周二', '周三', '周四', '周五', '周六', '周日']),
    headerCells(['1-2', '高等数学', '', '', '', '', '', '']),
    headerCells(['3-4', '英语', '', '', '', '', '', '']),
    headerCells(['5-6', '', '', '', '', '', '', '']),
    headerCells(['7-8', '物理', '', '', '', '', '', '']),
    headerCells(['9-10', '', '', '', '', '', '', '']),
    headerCells(['11-12', '化学', '', '', '', '', '', '']),
    // 8 rows × 8 cols → rowCount=8 (>5), colCount=8 (>4)
  ],
};

// Small notices table — typical "before the timetable" notice.
const noticeTable: ScorableTable = {
  rows: [
    headerCells(['公告', '请同学们注意...']),
    headerCells(['日期', '2024-09-01']),
  ],
};

// Decorative / kitchen-sink table: 3 rows × 3 cols.
const kitchenTable: ScorableTable = {
  rows: [
    headerCells(['姓名', '张三', '李四']),
    headerCells(['学号', '001', '002']),
    headerCells(['成绩', 'A', 'B']),
  ],
};

// =============================================================================
// extractAllTextFromTable
// =============================================================================

describe('extractAllTextFromTable', () => {
  it('joins every cell text with newlines, skipping empties', () => {
    const text = extractAllTextFromTable(courseTable);
    expect(text).toContain('节次');
    expect(text).toContain('周一');
    expect(text).toContain('高等数学');
    // Empty cells produce no blank-line artefacts in the joined output.
    expect(text).not.toMatch(/\n\n/);
  });

  it('returns an empty string for a table with no text', () => {
    expect(extractAllTextFromTable({ rows: [[{ text: '' }, { text: '' }]] })).toBe('');
  });
});

// =============================================================================
// scoreTable
// =============================================================================

describe('scoreTable', () => {
  it('scores the canonical course table high (period + days + structure)', () => {
    const score = scoreTable(courseTable);
    // 10 (period header) + 8 (≥5 day hits) + 5 (8×8 structure) = 23
    expect(score).toBe(23);
  });

  it('scores a small notice table low (no day keys, only 2 rows)', () => {
    const score = scoreTable(noticeTable);
    expect(score).toBe(0);
  });

  it('awards +5 only when both structure thresholds are met', () => {
    // 3 rows × 3 cols → fails both structure thresholds (rows > 5 AND cols > 4)
    const score = scoreTable(kitchenTable);
    expect(score).toBe(0);
  });

  it('scores partial keyword coverage below the period-keyword tier', () => {
    const partialTable: ScorableTable = {
      rows: [
        headerCells(['Time', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']),
        headerCells(['1', 'a', '', '', '', '']),
      ],
    };
    // No "节次/Period/Class" keyword → 0 points
    // 5 day hits → 8 points
    // 2 rows × 6 cols → fails structure (rows > 5 is false) → 0
    expect(scoreTable(partialTable)).toBe(8);
  });
});

// =============================================================================
// selectBestTable
// =============================================================================

describe('selectBestTable', () => {
  it('returns null + lowConfidence for empty input', () => {
    const r = selectBestTable([]);
    expect(r.selected).toBeNull();
    expect(r.lowConfidence).toBe(true);
    expect(r.score).toBe(-Infinity);
  });

  it('returns the only table for a single-element list', () => {
    const r = selectBestTable([courseTable]);
    expect(r.selected).toBe(courseTable);
    expect(r.score).toBe(23);
    expect(r.lowConfidence).toBe(false);
  });

  it('picks the most timetable-like table when several are present', () => {
    // Order matters here — the "wrong" tables come first to prove the
    // scorer actually walks the list rather than just returning [0].
    const r = selectBestTable([noticeTable, kitchenTable, courseTable]);
    expect(r.selected).toBe(courseTable);
    expect(r.score).toBe(23);
    expect(r.lowConfidence).toBe(false);
  });

  it('marks the pick as low-confidence when nothing scores high enough', () => {
    // All three tables score 0; threshold default is 5 → lowConfidence.
    const r = selectBestTable([noticeTable, kitchenTable, noticeTable]);
    expect(r.selected).toBe(noticeTable);
    expect(r.score).toBe(0);
    expect(r.lowConfidence).toBe(true);
  });

  it('breaks ties by returning the leftmost table', () => {
    const leftTable: ScorableTable = {
      rows: [
        headerCells(['Period', '周一', '周二', '周三', '周四', '周五']),
        headerCells(['1', 'x', '', '', '', '']),
      ],
    };
    const rightTable: ScorableTable = {
      rows: [
        headerCells(['Class', '周一', '周二', '周三', '周四', '周五']),
        headerCells(['1', 'x', '', '', '', '']),
      ],
    };
    const r = selectBestTable([leftTable, rightTable]);
    // Both score 10 + 8 = 18 (no structural bonus). Strict `>` in the
    // scorer means leftTable wins on a tie.
    expect(r.selected).toBe(leftTable);
  });

  it('honours a custom scoreThreshold', () => {
    const r = selectBestTable([partialTableForThreshold()], 100);
    expect(r.lowConfidence).toBe(true);
  });

  function partialTableForThreshold(): ScorableTable {
    return {
      rows: [
        headerCells(['节次', '周一', '周二', '周三', '周四', '周五']),
        headerCells(['1', 'x', '', '', '', '']),
      ],
    };
  }
});