import {
  mergeAhuCourseCustomizations,
  parseAhuCoursePayload,
  parseAhuCoursePayloadDetailed,
  parseCurrentSemester,
  summarizeAhuCourseChanges,
} from '@/lib/importers/ahu-importer';
import { TimeSlot, WeekDay } from '@/types/timetable';
import { CJLU_COURSE_EXTRACTION_SCRIPT, CJLU_CREDENTIAL_CAPTURE_SCRIPT, buildCjluAutoLoginScript, parseCjluCoursePayload } from '@/lib/importers/cjlu-importer';
import { CUGB_PAGE_READER_SCRIPT, parseCugbCourseRows } from '@/lib/importers/cugb-importer';

describe('安徽大学教务课表导入', () => {
  it('从教务页脚本中识别当前学期', () => {
    const html = `
      <script>
        var currentSemester = {'calendarAssoc': {'id': 1}, 'id': 123, 'name': '2026-2027学年第一学期'};
      </script>
    `;

    expect(parseCurrentSemester(html)).toEqual({
      id: 123,
      name: '2026-2027学年第一学期',
    });
  });

  it('把 print-data 活动转换为应用课程', () => {
    const payload = {
      studentTableVms: [{
        activities: [{
          lessonId: 987,
          courseName: '编译原理',
          teacherNames: ['张老师', '李老师'],
          room: '博学南楼 B201',
          weekIndexes: [1, 3, 5, 7],
          startUnit: 3,
          endUnit: 4,
          weekday: 2,
        }],
      }],
    };

    expect(parseAhuCoursePayload(payload)).toEqual([{
      id: 'ahu-987',
      name: '编译原理',
      day: WeekDay.TUESDAY,
      timeSlot: TimeSlot.THREE_FOUR,
      startPeriod: 3,
      endPeriod: 4,
      duration: 2,
      location: { address: '博学南楼 B201' },
      teacher: { name: '张老师、李老师' },
      weekList: [1, 3, 5, 7],
      isOddEven: 'odd',
    }]);
  });

  it('合并所有课表并跳过超出应用范围的活动', () => {
    const payload = {
      studentTableVms: [
        { activities: [{ lessonId: 'a', courseName: '实验课', teacherNames: '王老师', room: null, weekIndexes: [2, 2, 4], startUnit: 8, endUnit: 10, weekday: '7' }] },
        { activities: [{ lessonId: 'bad', courseName: '无效课', weekIndexes: [1], startUnit: 13, endUnit: 14, weekday: 1 }] },
      ],
    };

    expect(parseAhuCoursePayload(payload)).toEqual([expect.objectContaining({
      id: 'ahu-a',
      name: '实验课',
      day: WeekDay.SUNDAY,
      timeSlot: TimeSlot.EIGHT,
      startPeriod: 8,
      endPeriod: 10,
      duration: 3,
      location: { address: '' },
      teacher: { name: '王老师' },
      weekList: [2, 4],
      isOddEven: 'even',
    })]);
  });

  it('课表响应无活动时返回空数组', () => {
    expect(parseAhuCoursePayload({ studentTableVms: [] })).toEqual([]);
    expect(parseAhuCoursePayload({ message: '未登录' })).toEqual([]);
  });

  it('同一教学班的分周安排使用不同课程 ID', () => {
    const base = {
      lessonId: 987,
      courseName: '编译原理',
      teacherNames: ['张老师'],
      room: 'B201',
      startUnit: 3,
      endUnit: 4,
      weekday: 2,
    };
    const courses = parseAhuCoursePayload({
      studentTableVms: [{ activities: [
        { ...base, weekIndexes: [1, 3, 5] },
        { ...base, room: 'B202', weekIndexes: [7, 9, 11] },
      ] }],
    });

    expect(new Set(courses.map((course) => course.id)).size).toBe(2);
  });

  it('兼容 teachers 教师对象并报告被丢弃的活动', () => {
    const result = parseAhuCoursePayloadDetailed({
      studentTableVms: [{ activities: [
        {
          lessonId: 1,
          courseName: '数据结构',
          teachers: [{ name: '王老师' }, { name: '赵老师' }],
          room: 'B101',
          weekIndexes: [1, 2],
          startUnit: 1,
          endUnit: 2,
          weekday: 1,
        },
        { lessonId: 2, courseName: '无效课程', weekIndexes: [], startUnit: 1, endUnit: 2, weekday: 1 },
      ] }],
    });

    expect(result.courses[0].teacher.name).toBe('王老师、赵老师');
    expect(result.totalActivities).toBe(2);
    expect(result.droppedActivities).toBe(1);
  });

  it('刷新时识别新增、移除、调整并保留本地备注与颜色', () => {
    const before = parseAhuCoursePayload({ studentTableVms: [{ activities: [
      { lessonId: 1, courseName: '数据结构', weekIndexes: [1, 2], startUnit: 1, endUnit: 2, weekday: 1, room: 'B101' },
      { lessonId: 2, courseName: '大学英语', weekIndexes: [1, 2], startUnit: 3, endUnit: 4, weekday: 2, room: 'B102' },
    ] }] });
    before[0].note = '带教材';
    before[0].colorOverride = '#123456';

    const after = parseAhuCoursePayload({ studentTableVms: [{ activities: [
      { lessonId: 1, courseName: '数据结构', weekIndexes: [1, 2, 3], startUnit: 1, endUnit: 2, weekday: 1, room: 'B201' },
      { lessonId: 3, courseName: '操作系统', weekIndexes: [1, 2], startUnit: 5, endUnit: 6, weekday: 3, room: 'B103' },
    ] }] });

    expect(summarizeAhuCourseChanges(before, after)).toEqual({ added: 1, removed: 1, changed: 1 });
    const merged = mergeAhuCourseCustomizations(before, after);
    expect(merged[0]).toMatchObject({ note: '带教材', colorOverride: '#123456' });
  });

  it('教学班时间调整时保持来源 ID 并计为调整', () => {
    const activity = {
      lessonId: 88,
      courseName: '操作系统',
      weekday: 1,
      startUnit: 1,
      endUnit: 2,
      weekIndexes: [1, 2],
      room: '博学南楼201',
    };
    const before = parseAhuCoursePayload({ studentTableVms: [{ activities: [activity] }] });
    const after = parseAhuCoursePayload({
      studentTableVms: [{ activities: [{ ...activity, weekday: 3, startUnit: 3, endUnit: 4 }] }],
    });

    expect(after[0].id).toBe(before[0].id);
    expect(summarizeAhuCourseChanges(before, after)).toEqual({ added: 0, removed: 0, changed: 1 });
  });
});

describe('中国计量大学教务课表导入', () => {
  it('解析正方课表响应并展开周次', () => {
    const result = parseCjluCoursePayload({ kbList: [{
      kch: 'CS101', kcmc: '数据结构', jcs: '3-4', xqj: '2', zcd: '1-8周,10-12周', cdmc: '逸夫楼 201', xm: '王老师',
    }] });
    expect(result.droppedActivities).toBe(0);
    expect(result.courses[0]).toMatchObject({
      id: 'cjlu-CS101-1', name: '数据结构', day: WeekDay.TUESDAY,
      startPeriod: 3, endPeriod: 4, weekList: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12],
      location: { address: '逸夫楼 201' }, teacher: { name: '王老师' },
    });
  });

  it('统计无法识别的课程安排', () => {
    const result = parseCjluCoursePayload({ kbList: [{ kcmc: '缺少时间', xqj: '1', zcd: '1-2周' }] });
    expect(result.courses).toHaveLength(0);
    expect(result.droppedActivities).toBe(1);
  });

  it('生成的登录和读取脚本可编译', () => {
    expect(() => new Function(CJLU_CREDENTIAL_CAPTURE_SCRIPT)).not.toThrow();
    expect(() => new Function(buildCjluAutoLoginScript({ username: 'u', password: 'p' }))).not.toThrow();
    expect(() => new Function(CJLU_COURSE_EXTRACTION_SCRIPT)).not.toThrow();
  });
});

describe('中国地质大学（北京）教务插件', () => {
  it('解析当前页面表格行', () => {
    const result = parseCugbCourseRows([{ name: '地球科学概论', day: '周一', periods: '1-2节', weeks: '1-16周', teacher: '张老师', location: '教一楼101', code: 'C001' }]);
    expect(result.droppedRows).toBe(0);
    expect(result.courses[0]).toMatchObject({
      id: 'cugb-C001-1', name: '地球科学概论', day: WeekDay.MONDAY,
      startPeriod: 1, endPeriod: 2, weekList: Array.from({ length: 16 }, (_, index) => index + 1),
      teacher: { name: '张老师' }, location: { address: '教一楼101' },
    });
  });

  it('生成的页面读取脚本可编译', () => {
    expect(() => new Function(CUGB_PAGE_READER_SCRIPT)).not.toThrow();
  });
});
