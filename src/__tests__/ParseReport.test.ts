import { ParseReport } from '@/lib/reporting/ParseReport';

/**
 * Isolating the singleton in tests is critical: jest runs every test in
 * the same module graph, so without `resetInstance()` warnings from one
 * suite leak into the next.
 */
describe('ParseReport', () => {
  beforeEach(() => {
    ParseReport.resetInstance();
  });

  describe('singleton lifecycle', () => {
    it('returns the same instance on repeated getInstance()', () => {
      const a = ParseReport.getInstance();
      const b = ParseReport.getInstance();
      expect(a).toBe(b);
    });

    it('produces a fresh instance after resetInstance()', () => {
      const a = ParseReport.getInstance();
      a.addWarning({ category: 'system', severity: 'info', message: 'stale' });
      ParseReport.resetInstance();
      const b = ParseReport.getInstance();
      expect(a).not.toBe(b);
      expect(b.warnings).toHaveLength(0);
    });
  });

  describe('addWarning', () => {
    it('stamps `at` automatically when not supplied', () => {
      const before = Date.now();
      const r = ParseReport.getInstance();
      r.addWarning({ category: 'week', severity: 'warning', message: 'x' });
      const after = Date.now();
      expect(r.warnings[0]!.at).toBeGreaterThanOrEqual(before);
      expect(r.warnings[0]!.at).toBeLessThanOrEqual(after);
    });

    it('respects an explicit `at` timestamp', () => {
      const r = ParseReport.getInstance();
      r.addWarning({ category: 'cell', severity: 'error', message: 'y', at: 12345 });
      expect(r.warnings[0]!.at).toBe(12345);
    });

    it('accumulates across multiple calls', () => {
      const r = ParseReport.getInstance();
      r.addWarning({ category: 'header', severity: 'info', message: 'a' });
      r.addWarning({ category: 'header', severity: 'info', message: 'b' });
      r.addWarning({ category: 'week', severity: 'warning', message: 'c' });
      expect(r.warnings).toHaveLength(3);
      expect(r.byCategory('header')).toHaveLength(2);
    });
  });

  describe('addWarningFromParts convenience', () => {
    it('maps (category, severity, message, ref, rawText) into a full warning', () => {
      const r = ParseReport.getInstance();
      r.addWarningFromParts(
        'period',
        'error',
        '节次 14-15 越界',
        { rowIndex: 1, colIndex: 3, day: 'Monday' },
        '14-15节',
      );
      const w = r.warnings[0]!;
      expect(w.category).toBe('period');
      expect(w.severity).toBe('error');
      expect(w.message).toBe('节次 14-15 越界');
      expect(w.ref).toEqual({ rowIndex: 1, colIndex: 3, day: 'Monday' });
      expect(w.rawText).toBe('14-15节');
      expect(typeof w.at).toBe('number');
    });
  });

  describe('addSuggestion', () => {
    it('deduplicates identical suggestions', () => {
      const r = ParseReport.getInstance();
      r.addSuggestion('建议手动选择课表');
      r.addSuggestion('建议手动选择课表');
      r.addSuggestion('建议压缩文件后重试');
      expect(r.suggestions).toEqual(['建议手动选择课表', '建议压缩文件后重试']);
    });
  });

  describe('clear()', () => {
    it('empties warnings AND suggestions in one call', () => {
      const r = ParseReport.getInstance();
      r.addWarning({ category: 'system', severity: 'info', message: 'x' });
      r.addSuggestion('y');
      r.clear();
      expect(r.warnings).toHaveLength(0);
      expect(r.suggestions).toHaveLength(0);
    });
  });

  describe('hasWarnings / hasErrors / byCategory', () => {
    it('hasWarnings() reflects the warnings array', () => {
      const r = ParseReport.getInstance();
      expect(r.hasWarnings()).toBe(false);
      r.addWarning({ category: 'header', severity: 'info', message: 'h' });
      expect(r.hasWarnings()).toBe(true);
    });

    it('hasErrors() is true only when severity=error is present', () => {
      const r = ParseReport.getInstance();
      r.addWarning({ category: 'week', severity: 'warning', message: 'w' });
      expect(r.hasErrors()).toBe(false);
      r.addWarning({ category: 'period', severity: 'error', message: 'p' });
      expect(r.hasErrors()).toBe(true);
    });

    it('byCategory() returns only matching entries', () => {
      const r = ParseReport.getInstance();
      r.addWarning({ category: 'week', severity: 'warning', message: '1' });
      r.addWarning({ category: 'period', severity: 'warning', message: '2' });
      r.addWarning({ category: 'week', severity: 'warning', message: '3' });
      expect(r.byCategory('week').map((w) => w.message)).toEqual(['1', '3']);
    });
  });

  describe('snapshot()', () => {
    it('returns a deep copy — mutating the snapshot does not affect the singleton', () => {
      const r = ParseReport.getInstance();
      r.addWarning({ category: 'system', severity: 'info', message: 'orig' });
      const snap = r.snapshot();
      snap.warnings[0]!.message = 'mutated';
      expect(r.warnings[0]!.message).toBe('orig');
      // Re-snapshot should not see the mutation either.
      expect(r.snapshot().warnings[0]!.message).toBe('orig');
    });

    it('returns a deep copy of `ref` as well', () => {
      const r = ParseReport.getInstance();
      r.addWarning({
        category: 'period',
        severity: 'error',
        message: 'x',
        ref: { rowIndex: 1 },
      });
      const snap = r.snapshot();
      snap.warnings[0]!.ref!.rowIndex = 999;
      expect(r.warnings[0]!.ref!.rowIndex).toBe(1);
    });
  });
});