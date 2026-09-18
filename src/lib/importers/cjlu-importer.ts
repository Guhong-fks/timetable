import { fallbackSlot } from '@/lib/engine/recognizer';
import { ScheduledCourse, WeekDay } from '@/types/timetable';

interface CjluCourseRow {
  kcmc?: unknown;
  jcs?: unknown;
  xqj?: unknown;
  zcd?: unknown;
  cdmc?: unknown;
  xm?: unknown;
  kch?: unknown;
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

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function range(value: unknown): [number, number] | null {
  const numbers = text(value).match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length === 0) return null;
  const start = numbers[0];
  const end = numbers[1] ?? start;
  return start >= 1 && end >= start ? [start, end] : null;
}

function expandWeeks(value: unknown): number[] {
  const groups = text(value).split(/[,，;；]/);
  const result = new Set<number>();
  for (const group of groups) {
    const numbers = group.match(/\d+/g)?.map(Number) ?? [];
    if (numbers.length === 0) continue;
    const start = numbers[0];
    const end = numbers[1] ?? start;
    for (let week = start; week <= end && week <= 25; week += 1) {
      if (week >= 1) result.add(week);
    }
  }
  return [...result].sort((a, b) => a - b);
}

function rows(payload: unknown): CjluCourseRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const list = (payload as { kbList?: unknown }).kbList;
  return Array.isArray(list) ? list as CjluCourseRow[] : [];
}

export interface CjluParseResult {
  courses: ScheduledCourse[];
  totalActivities: number;
  droppedActivities: number;
}

export function parseCjluCoursePayload(payload: unknown): CjluParseResult {
  const source = rows(payload);
  const courses: ScheduledCourse[] = [];
  const usedIds = new Set<string>();
  source.forEach((row, index) => {
    const name = text(row.kcmc);
    const periods = range(row.jcs);
    const day = DAY_BY_NUMBER[Number(row.xqj)];
    const weekList = expandWeeks(row.zcd);
    if (!name || !periods || !day || weekList.length === 0) return;
    const base = `cjlu-${text(row.kch) || name}-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    courses.push({
      id,
      name,
      day,
      timeSlot: fallbackSlot(periods[0]),
      startPeriod: periods[0],
      endPeriod: periods[1],
      duration: periods[1] - periods[0] + 1,
      location: { address: text(row.cdmc) },
      teacher: { name: text(row.xm) },
      weekList,
      isOddEven: weekList.every((week) => week % 2 === 1) ? 'odd' : weekList.every((week) => week % 2 === 0) ? 'even' : null,
    });
  });
  return { courses, totalActivities: source.length, droppedActivities: source.length - courses.length };
}

export const CJLU_CREDENTIAL_CAPTURE_SCRIPT = `
(function () {
  if (window.__cjluCredentialCaptureInstalled) return true;
  window.__cjluCredentialCaptureInstalled = true;
  function findUsername() { return document.querySelector('#yhm, input[name="yhm"], input[name="username"], input[autocomplete="username"]'); }
  function findPassword() { return document.querySelector('#mm, input[name="mm"], input[name="password"], input[type="password"]'); }
  function sendCredentials() {
    var username = findUsername();
    var password = findPassword();
    if (!username || !password || !username.value || !password.value) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'cjlu-credentials', username: username.value, password: password.value }));
  }
  document.addEventListener('input', function (event) {
    var target = event.target;
    if (target && (target.type === 'password' || target.name === 'yhm' || target.name === 'username' || target.id === 'yhm')) {
      window.clearTimeout(window.__cjluCredentialCaptureTimer);
      window.__cjluCredentialCaptureTimer = window.setTimeout(sendCredentials, 0);
    }
  }, true);
  document.addEventListener('submit', sendCredentials, true);
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && target.closest && target.closest('button, input[type="submit"], .btn-login, #dl')) sendCredentials();
  }, true);
  return true;
})();
true;
`;

export function buildCjluAutoLoginScript(credentials: { username: string; password: string }): string {
  const serialized = JSON.stringify(credentials);
  return `
(function () {
  var credentials = ${serialized};
  function findUsername() { return document.querySelector('#yhm, input[name="yhm"], input[name="username"], input[autocomplete="username"]'); }
  function findPassword() { return document.querySelector('#mm, input[name="mm"], input[name="password"], input[type="password"]'); }
  var username = findUsername();
  var password = findPassword();
  if (!username || !password) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'cjlu-auto-login-error', message: '未找到登录表单，请手动登录' }));
    return true;
  }
  username.value = credentials.username;
  password.value = credentials.password;
  username.dispatchEvent(new Event('input', { bubbles: true }));
  password.dispatchEvent(new Event('input', { bubbles: true }));
  var form = password.form || username.form;
  var button = document.querySelector('#dl, button[type="submit"], input[type="submit"], .btn-login');
  if (button) button.click();
  else if (form) form.submit();
  else window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'cjlu-auto-login-error', message: '未找到登录按钮，请手动登录' }));
  return true;
})();
true;
`;
}

export const CJLU_COURSE_EXTRACTION_SCRIPT = `
(function () {
  function send(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
  function currentTerm() {
    var now = new Date();
    var year = String(now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1);
    var term = now.getMonth() >= 6 ? '3' : '12';
    var yearSelect = document.querySelector('select[name="xnm"]');
    var termSelect = document.querySelector('select[name="xqm"]');
    if (yearSelect && yearSelect.value) year = yearSelect.value;
    if (termSelect && termSelect.value) term = termSelect.value;
    return { xnm: year, xqm: term };
  }
  try {
    var params = currentTerm();
    var su = new URL(window.location.href).searchParams.get('su') || '';
    var body = 'xnm=' + encodeURIComponent(params.xnm) + '&xqm=' + encodeURIComponent(params.xqm) + '&kzlx=ck';
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 15000);
    fetch('/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151&su=' + encodeURIComponent(su), {
      method: 'POST', credentials: 'include', signal: controller.signal, headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      }, body: body
    }).then(function (response) {
      if (!response.ok) throw new Error('读取课表失败（HTTP ' + response.status + '）');
      return response.json();
    }).then(function (payload) {
      send({ type: 'cjlu-course-data', payload: payload });
    }).catch(function (error) {
      send({ type: 'cjlu-course-error', message: error && error.name === 'AbortError' ? '读取课表超时，请检查登录状态后重试' : (error && error.message ? error.message : '读取课表失败') });
    }).finally(function () { clearTimeout(timeout); });
  } catch (error) {
    send({ type: 'cjlu-course-error', message: error && error.message ? error.message : '读取课表失败' });
  }
})();
true;
`;
