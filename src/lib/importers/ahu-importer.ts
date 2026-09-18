import { fallbackSlot } from '@/lib/engine/recognizer';
import { ScheduledCourse, WeekDay } from '@/types/timetable';

export interface AhuSemester {
  id: number;
  name: string;
}

interface AhuActivity {
  lessonId?: unknown;
  courseName?: unknown;
  teacherNames?: unknown;
  teachers?: unknown;
  room?: unknown;
  weekIndexes?: unknown;
  startUnit?: unknown;
  endUnit?: unknown;
  weekday?: unknown;
}

const DAY_BY_NUMBER: Record<number, WeekDay> = {
  1: WeekDay.MONDAY,
  2: WeekDay.TUESDAY,
  3: WeekDay.WEDNESDAY,
  4: WeekDay.THURSDAY,
  5: WeekDay.FRIDAY,
  6: WeekDay.SATURDAY,
  7: WeekDay.SUNDAY,
};

function extractObjectLiteral(html: string): string | null {
  const startMatch = /(?:var|let|const)\s+currentSemester\s*=\s*/.exec(html);
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;
  if (html[start] !== '{') return null;

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

export function parseCurrentSemester(html: string): AhuSemester | null {
  const literal = extractObjectLiteral(html);
  if (!literal) return null;
  const id = matchAtObjectDepth(literal, /['"]?id['"]?\s*:\s*(\d+)/g);
  const name = matchAtObjectDepth(literal, /['"]?name['"]?\s*:\s*['"]([^'"]+)['"]/g);
  if (!id) return null;
  return { id: Number(id[1]), name: name?.[1]?.trim() || '当前学期' };
}

function matchAtObjectDepth(literal: string, pattern: RegExp): RegExpExecArray | null {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(literal)) !== null) {
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let i = 0; i < match.index; i += 1) {
      const char = literal[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
    if (depth === 1) return match;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function teacherName(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((teacher) => {
      if (teacher && typeof teacher === 'object') {
        return text((teacher as { name?: unknown }).name);
      }
      return text(teacher);
    }).filter(Boolean).join('、');
  }
  return text(value);
}

function weeks(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((week) => Number.isInteger(week) && week >= 1 && week <= 25))]
    .sort((a, b) => a - b);
}

function oddEven(weekList: number[]): 'odd' | 'even' | null {
  if (weekList.length === 0) return null;
  if (weekList.every((week) => week % 2 === 1)) return 'odd';
  if (weekList.every((week) => week % 2 === 0)) return 'even';
  return null;
}

function activities(payload: unknown): AhuActivity[] {
  if (!payload || typeof payload !== 'object') return [];
  const tables = (payload as { studentTableVms?: unknown }).studentTableVms;
  if (!Array.isArray(tables)) return [];
  return tables.flatMap((table) => {
    if (!table || typeof table !== 'object') return [];
    const rows = (table as { activities?: unknown }).activities;
    return Array.isArray(rows) ? rows as AhuActivity[] : [];
  });
}

export interface AhuCourseParseResult {
  courses: ScheduledCourse[];
  totalActivities: number;
  droppedActivities: number;
}

export function parseAhuCoursePayloadDetailed(payload: unknown): AhuCourseParseResult {
  const result: ScheduledCourse[] = [];
  const sourceActivities = activities(payload);
  const usedIds = new Set<string>();
  const lessonOccurrences = new Map<string, number>();
  for (const activity of sourceActivities) {
    const name = text(activity.courseName);
    const weekday = Number(activity.weekday);
    const startPeriod = Number(activity.startUnit);
    const endPeriod = Number(activity.endUnit);
    const weekList = weeks(activity.weekIndexes);
    const day = DAY_BY_NUMBER[weekday];
    if (!name || !day || !Number.isInteger(startPeriod) || !Number.isInteger(endPeriod)) continue;
    if (startPeriod < 1 || endPeriod < startPeriod || endPeriod > 13 || weekList.length === 0) continue;

    const lessonId = text(activity.lessonId) || name;
    const occurrence = (lessonOccurrences.get(lessonId) ?? 0) + 1;
    lessonOccurrences.set(lessonId, occurrence);
    const baseId = `ahu-${lessonId}${occurrence > 1 ? `-${occurrence}` : ''}`;
    let id = baseId;
    let suffix = occurrence + 1;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    result.push({
      id,
      name,
      day,
      timeSlot: fallbackSlot(startPeriod),
      startPeriod,
      endPeriod,
      duration: endPeriod - startPeriod + 1,
      location: { address: text(activity.room) },
      teacher: { name: teacherName(activity.teacherNames) || teacherName(activity.teachers) },
      weekList,
      isOddEven: oddEven(weekList),
    });
  }
  return {
    courses: result,
    totalActivities: sourceActivities.length,
    droppedActivities: sourceActivities.length - result.length,
  };
}

/** Compatibility wrapper for callers that only need valid courses. */
export function parseAhuCoursePayload(payload: unknown): ScheduledCourse[] {
  return parseAhuCoursePayloadDetailed(payload).courses;
}

export interface AhuCourseChanges {
  added: number;
  removed: number;
  changed: number;
}

function courseScheduleSignature(course: ScheduledCourse): string {
  return JSON.stringify({
    name: course.name,
    day: course.day,
    startPeriod: course.startPeriod,
    endPeriod: course.endPeriod,
    location: course.location.address,
    teacher: course.teacher.name,
    weekList: course.weekList,
    isOddEven: course.isOddEven ?? null,
  });
}

export function summarizeAhuCourseChanges(
  before: ScheduledCourse[],
  after: ScheduledCourse[],
): AhuCourseChanges {
  const previous = new Map(before.map((course) => [course.id, course]));
  const next = new Map(after.map((course) => [course.id, course]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, course] of next) {
    const old = previous.get(id);
    if (!old) added += 1;
    else if (courseScheduleSignature(old) !== courseScheduleSignature(course)) changed += 1;
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) removed += 1;
  }
  return { added, removed, changed };
}

export function mergeAhuCourseCustomizations(
  before: ScheduledCourse[],
  after: ScheduledCourse[],
): ScheduledCourse[] {
  const previous = new Map(before.map((course) => [course.id, course]));
  return after.map((course) => {
    const old = previous.get(course.id);
    if (!old) return course;
    return {
      ...course,
      note: old.note,
      colorOverride: old.colorOverride,
    };
  });
}

export const AHU_CREDENTIAL_CAPTURE_SCRIPT = `
(function () {
  if (window.__ahuCredentialCaptureInstalled) return true;
  window.__ahuCredentialCaptureInstalled = true;
  function sendCredentials() {
    var username = document.getElementById('un');
    var password = document.getElementById('pd');
    if (!username || !password || !username.value || !password.value) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'ahu-credentials',
      username: username.value,
      password: password.value
    }));
  }
  document.addEventListener('input', function (event) {
    var target = event.target;
    if (target && (target.id === 'un' || target.id === 'pd')) {
      window.clearTimeout(window.__ahuCredentialCaptureTimer);
      window.__ahuCredentialCaptureTimer = window.setTimeout(sendCredentials, 0);
    }
  }, true);
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && target.closest && target.closest('#index_login_btn')) sendCredentials();
  }, true);
  document.addEventListener('submit', function () {
    sendCredentials();
  }, true);
  return true;
})();
true;
`;

export function buildAhuAutoLoginScript(credentials: { username: string; password: string }): string {
  const serialized = JSON.stringify(credentials);
  return `
(function () {
  if (window.__ahuAutoLoginStarted) return true;
  window.__ahuAutoLoginStarted = true;
  var credentials = ${serialized};
  var username = document.getElementById('un');
  var password = document.getElementById('pd');
  var button = document.getElementById('index_login_btn');
  if (!username || !password || !button) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ahu-auto-login-error', message: '未找到教务登录表单' }));
    return true;
  }
  username.value = credentials.username;
  password.value = credentials.password;
  username.dispatchEvent(new Event('input', { bubbles: true }));
  password.dispatchEvent(new Event('input', { bubbles: true }));
  button.click();
  return true;
})();
true;
`;
}

/** Runs only after WebView reaches the authenticated AHU student home page. */
export const AHU_COURSE_EXTRACTION_SCRIPT = `
(async function () {
  function requestWithTimeout(url, label) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    return fetch(url, { credentials: 'include', signal: controller.signal })
      .then(function (response) {
        clearTimeout(timer);
        return response;
      })
      .catch(function (error) {
        clearTimeout(timer);
        if (error && error.name === 'AbortError') throw new Error(label + '超时（12秒）');
        throw error;
      });
  }
  try {
    var infoResponse = await requestWithTimeout('/student/for-std/course-table', '读取学期');
    if (!infoResponse.ok) throw new Error('读取学期失败（HTTP ' + infoResponse.status + '）');
    var html = await infoResponse.text();
    var marker = html.match(/(?:var|let|const)\\s+currentSemester\\s*=\\s*/);
    if (!marker) throw new Error('未识别到当前学期');
    var start = marker.index + marker[0].length;
    var depth = 0, quote = '', escaped = false, end = -1;
    for (var i = start; i < html.length; i += 1) {
      var char = html[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\\\') escaped = true;
        else if (char === quote) quote = '';
      } else if (char === '\"' || char === "'") quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) throw new Error('当前学期数据格式异常');
    var literal = html.slice(start, end);
    function topLevelMatch(pattern) {
      var match;
      while ((match = pattern.exec(literal)) !== null) {
        var d = 0, q = '', e = false;
        for (var j = 0; j < match.index; j += 1) {
          var c = literal[j];
          if (q) {
            if (e) e = false;
            else if (c === '\\\\') e = true;
            else if (c === q) q = '';
          } else if (c === '\"' || c === "'") q = c;
          else if (c === '{') d += 1;
          else if (c === '}') d -= 1;
        }
        if (d === 1) return match;
      }
      return null;
    }
    var idMatch = topLevelMatch(/['\"]?id['\"]?\\s*:\\s*(\\d+)/g);
    var nameMatch = topLevelMatch(/['\"]?name['\"]?\\s*:\\s*['\"]([^'\"]+)['\"]/g);
    if (!idMatch) throw new Error('未识别到当前学期编号');
    var semesterId = Number(idMatch[1]);
    var dataResponse = await requestWithTimeout('/student/for-std/course-table/semester/' + semesterId + '/print-data?semesterId=' + semesterId + '&hasExperiment=false', '读取课表');
    if (!dataResponse.ok) throw new Error('读取课表失败（HTTP ' + dataResponse.status + '）');
    var payload = await dataResponse.json();
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ahu-course-data', semesterName: nameMatch ? nameMatch[1] : '当前学期', payload: payload }));
  } catch (error) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ahu-course-error', message: error && error.message ? error.message : '读取课表失败' }));
  }
})();
true;
`;
