// =============================================================================
// Golden-file regression: the position-first recognizer against two REAL
// university exports (fixtures converted from the original .docx files).
//
//   fixtures/ahau.json — 安徽大学教务导出（dialect A: one vMerge cell per
//     course, name/code/(weeks)(periods)campus room teacher/class paragraphs）
//   fixtures/cjlu.json — 中国计量大学正方导出（dialect B: name in a vMerge
//     cell, details hard-wrapped across SEPARATE cells below, weeks outside
//     parens, table split across two pages）
//
// If these tests fail, recognition of real-world timetables regressed.
// =============================================================================
import { WeekDay, type ScheduledCourse } from '@/types/timetable';
import { ParseReport } from '@/lib/reporting/ParseReport';
import { recognizeCourses, type IrTableBlock } from '@/lib/engine/recognizer';
import ahauFixture from './fixtures/ahau.json';
import cjluFixture from './fixtures/cjlu.json';

function recognize(fixture: unknown): { courses: ScheduledCourse[]; report: ParseReport } {
  const report = ParseReport.getInstance();
  report.clear();
  const courses = recognizeCourses(fixture as IrTableBlock[], report);
  return { courses, report };
}

describe('recognizer — real-fixture regression (position-first)', () => {
  it('ahau: recovers all 14 courses (incl. the second course stacked in the same cell) with correct day/period/teacher', () => {
    const { courses } = recognize(ahauFixture);

    expect(courses).toHaveLength(14);

    const monday = courses.filter((c) => c.day === WeekDay.MONDAY);
    expect(monday.map((c) => `${c.startPeriod}-${c.endPeriod}`)).toEqual(['1-2', '3-5', '11-13']);

    const byPeriod = (day: WeekDay, start: number): ScheduledCourse =>
      courses.find((c) => c.day === day && c.startPeriod === start)!;

    const wuli = byPeriod(WeekDay.MONDAY, 1);
    expect(wuli.name).toContain('大学物理A');
    expect(wuli.teacher?.name).toBe('何天博');
    expect(wuli.location.address).toContain('博学北楼B316');

    const shuzi = byPeriod(WeekDay.MONDAY, 3);
    expect(shuzi.name).toContain('数字电路');
    expect(shuzi.endPeriod).toBe(5); // rowSpan-derived
    expect(shuzi.teacher?.name).toBe('程鸿');

    const shiyan = byPeriod(WeekDay.WEDNESDAY, 8);
    expect(shiyan.name).toContain('电子线路实验');
    expect(shiyan.endPeriod).toBe(10);
    expect(shiyan.teacher?.name).toBe('方欣');
    expect(shiyan.location.address).toContain('笃行北楼A409');

    // Multi-teacher course (Friday 6-9): every teacher is preserved, joined
    // by '、' inside the single-string teacher.name model; the trailing
    // teacher chain is stripped OUT of the address.
    const wulishiyan = courses.find((c) => c.name.includes('大学物理实验'))!;
    expect(wulishiyan.teacher?.name).toBe('王章银、王蓉蓉、尹晓峰、张子云、谢传梅、谌正艮');
    expect(wulishiyan.location.address).toBe('磬苑  笃行北楼A楼[物理基础实验中心]');
    expect(wulishiyan.location.address).not.toContain('王章银');

    // The second course stacked in the SAME cell (形势与政策, 18周, 8-10节)
    // is split off and recognized as its own entry, with its own location
    // recovered from the unlabeled 安大 detail form.
    const xingshiA = courses.find((c) => c.name === '形势与政策' && c.day === WeekDay.FRIDAY)!;
    expect(xingshiA).toBeDefined();
    expect(`${xingshiA.startPeriod}-${xingshiA.endPeriod}`).toBe('8-10');
    expect(xingshiA.weekList).toEqual([18]);
    expect(xingshiA.teacher?.name).toBe('吴万运');
    expect(xingshiA.location.address).toContain('博学北楼B101');

    // Every course landed in a real period range.
    for (const c of courses) {
      expect(c.startPeriod).toBeGreaterThanOrEqual(1);
      expect(c.endPeriod).toBeGreaterThanOrEqual(c.startPeriod);
      expect(c.endPeriod).toBeLessThanOrEqual(13);
    }
  });

  it('cjlu: recovers all 15 courses incl. cross-page table merge', () => {
    const { courses } = recognize(cjluFixture);

    expect(courses).toHaveLength(15);

    const dianlu = courses.find((c) => c.name === '电路与模拟电子技术')!;
    expect(dianlu).toBeDefined();
    expect(`${dianlu.startPeriod}-${dianlu.endPeriod}`).toBe('1-2');
    expect(dianlu.teacher?.name).toBe('安斯光');
    expect(dianlu.location.address).toContain('环宇楼T202');

    // (3-5节) course whose periods come from text, spanning an odd range.
    // NOTE: the same cell also carries a second session '(3-4节)12周' — both
    // are recovered as separate entries sharing the name.
    const duomeiti = courses.find((c) => c.name === '多媒体技术' && c.endPeriod === 5)!;
    expect(duomeiti).toBeDefined();
    expect(duomeiti.startPeriod).toBe(3);
    expect(duomeiti.weekList).toEqual(expect.arrayContaining([1, 2, 3, 5, 11]));

    // Course living only in the SECOND (header-less) table = merge worked.
    const yujia = courses.find((c) => c.name === '瑜伽')!;
    expect(yujia).toBeDefined();
    expect(`${yujia.startPeriod}-${yujia.endPeriod}`).toBe('8-9');
    expect(yujia.teacher?.name).toBe('徐钰芳');

    // Weeks parsed from the outside-paren form '1-3周,5-17周'.
    expect(dianlu.weekList).toEqual(expect.arrayContaining([1, 2, 3, 5, 6, 7, 16, 17]));
    // '8周,14周' — discrete weeks.
    const xingshi = courses.find((c) => c.name === '形势与政策3')!;
    expect(xingshi.weekList).toEqual(expect.arrayContaining([8, 14]));
    expect(xingshi.weekList).not.toContain(9);

    // Wrapped-detail course: teacher recovered from the '名/教师:' prefix form.
    const yingmei = courses.find((c) => c.name === '英美概况')!;
    expect(yingmei.teacher?.name).toBe('程薇娟');
    expect(yingmei.location.address).toContain('D304');
  });
});
