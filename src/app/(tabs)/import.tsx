import { AhuImportModal } from '@/components/AhuImportModal';
import { CjluImportModal } from '@/components/CjluImportModal';
import { ImportPreview } from '@/components/ImportPreview';
import { SchoolWebModal } from '@/components/SchoolWebModal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadAhuCredentials } from '@/lib/importers/ahu-credentials';
import { mergeAhuCourseCustomizations, summarizeAhuCourseChanges } from '@/lib/importers/ahu-importer';
import { loadCjluCredentials } from '@/lib/importers/cjlu-credentials';
import { ImportDiagnosticsError, isNativeBridgeAvailable, parseTimetableFile } from '@/lib/importers/timetable-importer';
import type { ReportWarning } from '@/lib/reporting/types';
import { loadPeriodSchedule } from '@/lib/widget-data';
import { useTimetable } from '@/state/timetable';
import type { ScheduledCourse } from '@/types/timetable';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface PendingImport {
  courses: ScheduledCourse[];
  report: { warnings: ReportWarning[]; suggestions: string[] };
  fileName: string;
  /** .ics only: earliest timed DTSTART (natural week-1 Monday). Adopted as
   * 学期开始日期 on commit when the user hasn't set one — without it the
   * grid header hides all dates and ICS week math is meaningless. */
  inferredSemesterStart?: string;
}

/** 模块级探测一次：Nitro require 幂等且无副作用（try/catch），
 * 放在 render 之外避免 hooks purity 误报。 */
let nativeProbeCache: boolean | null = null;
function probeNativeOnce(): boolean {
  if (nativeProbeCache === null) nativeProbeCache = isNativeBridgeAvailable();
  return nativeProbeCache;
}

function SchoolEntry({
  name,
  hint,
  iconColor,
  actionLabel,
  onPress,
}: {
  name: string;
  hint: string;
  iconColor: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.schoolRow}>
      <View style={[styles.schoolIcon, { backgroundColor: `${iconColor}1A` }]}>
        <Ionicons name="school-outline" size={22} color={iconColor} />
      </View>
      <View style={styles.schoolInfo}>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={[styles.schoolButton, { backgroundColor: iconColor }]}
      >
        <ThemedText style={styles.schoolButtonText}>{actionLabel}</ThemedText>
      </Pressable>
    </View>
  );
}

export default function ImportScreen() {
  const theme = useTheme();
  const input = useRef<HTMLInputElement | null>(null);
  const { replaceCourses, clearCourses, courses, importedFileName, semesterStartDate, setSemesterStartDate } = useTimetable();
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [ahuMode, setAhuMode] = useState<'import' | 'refresh' | null>(null);
  const [cjluMode, setCjluMode] = useState<'import' | 'refresh' | null>(null);
  const [hasAhuCredentials, setHasAhuCredentials] = useState(false);
  const [hasCjluCredentials, setHasCjluCredentials] = useState(false);
  const [schoolPickerVisible, setSchoolPickerVisible] = useState(false);
  const [schoolWeb, setSchoolWeb] = useState<'cugb' | 'cjlu' | null>(null);
  // 学期开始日期：年 / 月 / 日三个输入框。月份/日期支持单数字输入（如 9 月 7 日
  // 输 9、7），输入框保留用户原样（不强制补零）；只有三者拼出合法 ISO
  // 'YYYY-MM-DD' 时才写入 store（所有消费方——网格日期、ICS 周次锚点——
  // 都解析该格式），避免半输入态落库。
  const initialSemesterParts = (() => {
    const m = (semesterStartDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) } : null;
  })();
  const [dateYear, setDateYear] = useState(initialSemesterParts?.year ?? '');
  const [dateMonth, setDateMonth] = useState(initialSemesterParts?.month ?? '');
  const [dateDay, setDateDay] = useState(initialSemesterParts?.day ?? '');
  const [lastImportTime, setLastImportTime] = useState(0);
  /** Parsed-but-unconfirmed import; rendering this switches to the preview. */
  const [pending, setPending] = useState<PendingImport | null>(null);
  /** IR dump from the last failed parse (share button appears when set). */
  const [diagnosticsText, setDiagnosticsText] = useState<string | null>(null);
  // 初始化时探测一次：Expo Go 返回 false，Development / EAS Build 返回 true。
  const [nativeAvailable] = useState<boolean | null>(probeNativeOnce);
  const IMPORT_COOLDOWN_MS = 3000;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    void Promise.all([loadAhuCredentials(), loadCjluCredentials()])
      .then(([ahuCredentials, cjluCredentials]) => {
        if (!active) return;
        setHasAhuCredentials(ahuCredentials !== null);
        setHasCjluCredentials(cjluCredentials !== null);
      })
      .catch(() => {
        if (active) {
          setHasAhuCredentials(false);
          setHasCjluCredentials(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function choose(file?: { name: string; size?: number; type?: string; arrayBuffer: () => Promise<ArrayBuffer> } | { name: string; size?: number; type?: string; uri: string }) {
    if (!file) return;
    // Event-handler context: Date.now() is safe here (cooldown check).
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (now - lastImportTime < IMPORT_COOLDOWN_MS && !loading) {
      setStatus(`请等待 ${Math.ceil((IMPORT_COOLDOWN_MS - (now - lastImportTime)) / 1000)} 秒后再试`);
      return;
    }
    setLoading(true);
    setStatus('');
    setLastImportTime(now);
    try {
      // ICS 周次换算依赖学期开始日期（week-1 Monday）；docx/xlsx 不使用。
      // 传入 ISO 'YYYY-MM-DD'（weekAnchorFromIso 只认该格式；未填/不完整时
      // 传 undefined，ICS 退化为 1-18 周并给出提示）。
      const iso = buildSemesterIso(dateYear, dateMonth, dateDay) ?? undefined;
      // ICS 无节次标记的事件按 App 配置的节次时间轴反推节次（Tier B）。
      const periodSchedule = await loadPeriodSchedule();
      const result = await parseTimetableFile(file, iso, periodSchedule);
      // Route through the preview: the user confirms/fixes the recognized
      // list before anything touches the store.
      setPending({
        courses: result.courses,
        report: result.report,
        fileName: file.name,
        inferredSemesterStart: result.inferredSemesterStart,
      });
    } catch (error) {
      // A total-recognition failure carries the parse report; surface the
      // per-stage warnings inline and offer the IR dump for bug reports.
      if (error instanceof ImportDiagnosticsError) {
        const lines = [`· ${humanizeImportError(error)}`];
        for (const w of error.report.warnings.slice(0, 4)) lines.push(`· ${w.message}`);
        if (error.report.warnings.length > 4) lines.push(`…等 ${error.report.warnings.length} 条警告`);
        setDiagnosticsText(error.diagnostics ?? null);
        setStatus(lines.join('\n'));
        return;
      }
      setStatus(humanizeImportError(error));
    } finally {
      setLoading(false);
    }
  }

  /** Preview accepted → commit the (possibly edited) subset. */
  const commitPending = (kept: ScheduledCourse[]) => {
    if (!pending) return;
    // .ics carries its own calendar: adopt the earliest DTSTART as the
    // semester start when the user hasn't set one — otherwise the grid
    // header shows no dates and ICS weeks degrade to 1..18.
    const startDate = semesterStartDate ?? pending.inferredSemesterStart;
    replaceCourses(kept, pending.fileName, startDate, pending.report);
    if (!semesterStartDate && startDate) {
      const parts = startDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (parts) {
        setDateYear(parts[1]);
        setDateMonth(String(Number(parts[2])));
        setDateDay(String(Number(parts[3])));
      }
    }
    const statusParts = [`已导入 ${kept.length} 门课程`];
    if (pending.report.warnings.length) {
      statusParts.push(`（${pending.report.warnings.length} 条警告，请查看课表底部详情）`);
    }
    if (!semesterStartDate && startDate) {
      // .ics 无用户学期起点时采用了日历推断值 — 显式提示，避免用户误以为
      // 是自己填的日期导致周次错位。
      statusParts.push(`学期开始日期已按日历推断为 ${startDate}，请核对`);
    }
    statusParts.push('。');
    setStatus(statusParts.join(''));
    setPending(null);
  };

  /**
   * Translate any thrown value into a Chinese status string. The parser
   * already emits Chinese messages for known failures; this function only
   * catches the long-tail cases (storage exceptions, JSON parse errors,
   * native bridge failures, unknown throws).
   */
  function humanizeImportError(error: unknown): string {
    if (error instanceof Error) {
      // Known-localised messages from the parser — pass through verbatim
      // so we don't double-translate. (We test for Chinese characters to
      // avoid showing English tech errors like "Unexpected token …".)
      if (/[一-龥]/.test(error.message)) return error.message;
      // Bare technical message — wrap it with a "what to do" hint.
      console.warn('[import] underlying error:', error);
      return '导入失败：文件可能已损坏或不是有效的课表模板';
    }
    return '导入失败：未知错误';
  }

  async function chooseNativeFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        // anydoc parses .doc/.xlsx natively; .ics is the calendar export from
        // other schedule apps (纯 JS 解析，不依赖原生模块). Accept list must
        // match the validator's whitelist in security.ts.
        type: [
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/calendar',
          // Some pickers expose .ics only by extension (no MIME registered).
          'application/octet-stream',
        ],
        copyToCacheDirectory: false,
        multiple: false,
      });
      if (!result.canceled) {
        const file = result.assets[0];
        await choose({ name: file.name, size: file.size, type: file.mimeType, uri: file.uri });
      }
    } catch (err: any) {
      const msg = err?.message || '';
      console.warn('[import] chooseNativeFile error:', err, 'message:', msg);
      if (err?.code === 'ERR_CANCELED' || msg.includes('canceled') || msg.includes('cancelled')) return;
      if (msg.includes('no longer available') || msg.includes('current activity') || msg.includes('Activity')) return;
      setStatus(`文件选择失败，请重试 (${msg})`);
    }
  }

  /** 由年/月/日拼出 ISO 'YYYY-MM-DD'；任一不合法返回 null（不提交存储）。
   * 月份/日期允许 1-2 位（单数字自动补零），并按该月真实天数校验（含闰年）。 */
  const buildSemesterIso = (year: string, month: string, day: string): string | null => {
    if (!/^\d{4}$/.test(year)) return null;
    const y = Number(year);
    if (!/^\d{1,2}$/.test(month)) return null;
    const m = Number(month);
    if (m < 1 || m > 12) return null;
    if (!/^\d{1,2}$/.test(day)) return null;
    const d = Number(day);
    if (d < 1 || d > 31) return null;
    const daysInMonth = new Date(y, m, 0).getDate();
    if (d > daysInMonth) return null;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  // 三个输入框各自 onChange：剥离非数字并限长，三者拼出合法 ISO 才写入 store。
  const handleYearChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setDateYear(digits);
    const iso = buildSemesterIso(digits, dateMonth, dateDay);
    if (iso) setSemesterStartDate(iso);
  };
  const handleMonthChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 2);
    setDateMonth(digits);
    const iso = buildSemesterIso(dateYear, digits, dateDay);
    if (iso) setSemesterStartDate(iso);
  };
  const handleDayChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 2);
    setDateDay(digits);
    const iso = buildSemesterIso(dateYear, dateMonth, digits);
    if (iso) setSemesterStartDate(iso);
  };

  // ---- Preview mode: the parse succeeded; confirm before committing. ----
  if (pending) {
    return (
      <ImportPreview
        courses={pending.courses}
        report={pending.report}
        fileName={pending.fileName}
        onCommit={commitPending}
        onCancel={() => setPending(null)}
      />
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">导入课表</ThemedText>
          <ThemedText themeColor="textSecondary">
            选择你的课表文件（.docx / .doc / .xlsx / .ics），解析后可预览确认。建议导入word文件前先删除课表以外的无关信息。
          </ThemedText>

          {/* Surface the missing-native-module case early. On Expo Go the
              Nitro binary isn't bundled, so picking a file would only fail
              with a tech error inside the parser — much friendlier to show
              a single banner before the user goes through the picker. */}
          {nativeAvailable === false && (
            <ThemedView
              type="backgroundElement"
              style={[styles.section, styles.nativeMissingBanner]}
            >
              <ThemedText type="subtitle">
                              当前环境不支持本地解析
                            </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.hint}>
                Expo Go 不含原生模块，无法解析课表文件。请使用 Development Build 或 EAS
                Build 后再导入文件。课表底部其他设置仍可正常使用。
              </ThemedText>
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="subtitle">学期开始日期</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              填写课程第一周周一的日期，用于在课表上显示具体上课日期；不填则只按周次显示。
            </ThemedText>
            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <TextInput
                  value={dateYear}
                  onChangeText={handleYearChange}
                  inputMode="numeric"
                  placeholder="年"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={4}
                  accessibilityLabel="学期开始年份"
                  style={[styles.dateInput, { color: theme.text, borderColor: theme.textSecondary + '55', backgroundColor: theme.background }]}
                />
                <ThemedText themeColor="textSecondary" style={styles.dateLabel}>年</ThemedText>
              </View>
              <View style={styles.dateField}>
                <TextInput
                  value={dateMonth}
                  onChangeText={handleMonthChange}
                  inputMode="numeric"
                  placeholder="月"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={2}
                  accessibilityLabel="学期开始月份"
                  style={[styles.dateInput, { color: theme.text, borderColor: theme.textSecondary + '55', backgroundColor: theme.background }]}
                />
                <ThemedText themeColor="textSecondary" style={styles.dateLabel}>月</ThemedText>
              </View>
              <View style={styles.dateField}>
                <TextInput
                  value={dateDay}
                  onChangeText={handleDayChange}
                  inputMode="numeric"
                  placeholder="日"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={2}
                  accessibilityLabel="学期开始日"
                  style={[styles.dateInput, { color: theme.text, borderColor: theme.textSecondary + '55', backgroundColor: theme.background }]}
                />
                <ThemedText themeColor="textSecondary" style={styles.dateLabel}>日</ThemedText>
              </View>
            </View>
            {semesterStartDate && (
              <ThemedText themeColor="textSecondary" style={styles.currentDate}>
                当前设置：{semesterStartDate.replaceAll('-', '')} (第1周周一)
              </ThemedText>
            )}
          </ThemedView>

          {Platform.OS === 'android' && (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSchoolPickerVisible(true)}
                style={[styles.schoolPickerButton, { borderColor: theme.textSecondary + '44', backgroundColor: theme.backgroundSelected + '18' }]}
              >
                <Ionicons name="school-outline" size={22} color="#208AEF" />
                <View style={styles.schoolPickerInfo}>
                  <ThemedText type="smallBold">从教务系统导入</ThemedText>
                  <ThemedText themeColor="textSecondary" style={styles.hint}>选择学校后打开官方教务入口</ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </Pressable>
              <Modal visible={schoolPickerVisible} transparent animationType="slide" onRequestClose={() => setSchoolPickerVisible(false)}>
                <View style={styles.pickerBackdrop}>
                  <ThemedView style={styles.pickerCard}>
                    <View style={styles.pickerHeader}>
                      <ThemedText type="subtitle">选择教务系统</ThemedText>
                      <Pressable onPress={() => setSchoolPickerVisible(false)} hitSlop={10}>
                        <Ionicons name="close" size={24} color={theme.text} />
                      </Pressable>
                    </View>
                    <SchoolEntry
                      name="安徽大学"
                      hint="官方教务系统 · 支持自动读取和刷新"
                      iconColor="#208AEF"
                      actionLabel="登录导入"
                      onPress={() => { setSchoolPickerVisible(false); setAhuMode('import'); }}
                    />
                    {hasAhuCredentials && importedFileName?.startsWith('安徽大学教务系统') && (
                      <Pressable
                        onPress={() => { setSchoolPickerVisible(false); setAhuMode('refresh'); }}
                        style={[styles.schoolButton, styles.refreshButton, { borderColor: '#208AEF' }]}
                      >
                        <Ionicons name="refresh" size={14} color="#208AEF" />
                        <ThemedText style={styles.refreshButtonText}>刷新安徽大学课表</ThemedText>
                      </Pressable>
                    )}
                    <SchoolEntry
                      name="中国地质大学（北京）"
                      hint="统一身份认证：cas.cugb.edu.cn"
                      iconColor="#16A34A"
                      actionLabel="打开官网"
                      onPress={() => { setSchoolPickerVisible(false); setSchoolWeb('cugb'); }}
                    />
                    <SchoolEntry
                      name="中国计量大学"
                      hint="正方教务系统：jwxt.cjlu.edu.cn"
                      iconColor="#F59E0B"
                      actionLabel="登录导入"
                      onPress={() => { setSchoolPickerVisible(false); setCjluMode('import'); }}
                    />
                    {hasCjluCredentials && importedFileName?.startsWith('中国计量大学教务系统') && (
                      <Pressable
                        onPress={() => { setSchoolPickerVisible(false); setCjluMode('refresh'); }}
                        style={[styles.schoolButton, styles.refreshButton, { borderColor: '#F59E0B' }]}
                      >
                        <Ionicons name="refresh" size={14} color="#F59E0B" />
                        <ThemedText style={[styles.refreshButtonText, { color: '#F59E0B' }]}>刷新中国计量大学课表</ThemedText>
                      </Pressable>
                    )}
                    <ThemedText themeColor="textSecondary" style={styles.pickerHint}>
                      安徽大学和中国计量大学均支持登录后读取、加密保存账号，以及后续手动刷新；中国地质大学（北京）暂未实现。
                    </ThemedText>
                  </ThemedView>
                </View>
              </Modal>
            </>
          )}

          <ThemedText type="subtitle">选择课表文件</ThemedText>
          <Pressable
            onPress={() => Platform.OS === 'web' ? input.current?.click() : void chooseNativeFile()}
            style={[styles.button, { backgroundColor: '#208AEF' }]}
          >
            <Ionicons name="cloud-upload-outline" size={20} color="#FFFFFF" style={styles.buttonIcon} />
            <ThemedText style={[styles.buttonText, { color: '#FFFFFF' }]}>{loading ? '正在解析...' : '选择课表文件'}</ThemedText>
          </Pressable>
          {Platform.OS === 'web' && (
            <input
              ref={input}
              type="file"
              accept=".docx,.doc,.xlsx,.ics"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void choose({ name: file.name, size: file.size, type: file.type, arrayBuffer: () => file.arrayBuffer() });
              }}
            />
          )}
          {status && <ThemedView type="backgroundElement" style={styles.status}><ThemedText>{status}</ThemedText></ThemedView>}
          {diagnosticsText && (
            <Pressable
              onPress={() => {
                // RN's Share API: zero extra dependencies. The dump is the
                // exact device-side IR/grid/layout state for bug reports.
                void import('react-native').then(({ Share }) =>
                  Share.share({ message: diagnosticsText.slice(0, 20000) }),
                );
              }}
              style={[styles.button, { backgroundColor: theme.backgroundSelected, padding: Spacing.two }]}
            >
              <ThemedText style={[styles.buttonText, { color: theme.background }]}>导出解析诊断（供反馈）</ThemedText>
            </Pressable>
          )}
          {importedFileName && <ThemedText themeColor="textSecondary">当前文件：{importedFileName}</ThemedText>}
          <ThemedText type="subtitle">说明</ThemedText>
          <ThemedText themeColor="textSecondary">
            解析完成后会先展示课程列表供你确认和修正，确认后才写入课表。同一格的多门课程会自动拆分，数据保存在当前设备。
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            <ThemedText type="smallBold">导入 .ics 日历文件：</ThemedText>
            在其他课程表 App（WakeUp/超级课程表等）中打开课表 → 分享/更多 → “导出到日历文件”，得到
            .ics 文件后在这里导入。
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            <ThemedText type="smallBold">周次换算：</ThemedText>
            .ics 的周次按“学期开始日期”换算（第 1 节课所在那周的周一是第 1 周开始）。导入前请先在上方填写学期开始日期；
            未填写时所有课程按第 1-18 周导入，可再导一次对齐。各课程的上课节次、地点、教师从导出内容自动识别，
            个别课程的时间可能与原 App 有出入，导入后可逐条核对修改。
          </ThemedText>
          {!!courses.length && <Pressable onPress={clearCourses} style={[styles.clear, { borderColor: theme.textSecondary + '55' }]}><Ionicons name="trash-outline" size={16} color={theme.textSecondary} style={styles.clearIcon} /><ThemedText themeColor="textSecondary">清空当前课表</ThemedText></Pressable>}
        </ScrollView>
        {Platform.OS === 'android' && ahuMode && (
          <AhuImportModal
            visible
            mode={ahuMode}
            onCancel={() => setAhuMode(null)}
            onCredentialsSaved={() => setHasAhuCredentials(true)}
            onCredentialsMissing={() => setHasAhuCredentials(false)}
            onImported={(ahuCourses, semesterName, droppedActivities) => {
              const warnings: ReportWarning[] = [];
              if (droppedActivities > 0) {
                warnings.push({
                  category: 'system',
                  severity: 'warning',
                  message: `教务系统返回的 ${droppedActivities} 条课程安排格式异常，已跳过，请核对课程数量`,
                  at: Date.now(),
                });
              }
              if (semesterStartDate) {
                warnings.push({
                  category: 'system',
                  severity: 'warning',
                  message: `教务系统未提供开学日期，当前仍使用 ${semesterStartDate}，请确认它属于 ${semesterName}`,
                  at: Date.now(),
                });
              }
              const sourceName = `安徽大学教务系统 · ${semesterName}`;
              if (ahuMode === 'refresh') {
                const existingAhuCourses = courses.filter((course) => course.id.startsWith('ahu-'));
                const unrelatedCourses = courses.filter((course) => !course.id.startsWith('ahu-'));
                const changes = summarizeAhuCourseChanges(existingAhuCourses, ahuCourses);
                const totalChanges = changes.added + changes.removed + changes.changed;
                if (totalChanges > 0) {
                  const merged = mergeAhuCourseCustomizations(existingAhuCourses, ahuCourses);
                  replaceCourses([...unrelatedCourses, ...merged], sourceName, semesterStartDate, { warnings, suggestions: [] });
                  setStatus(`刷新完成：新增 ${changes.added} 门，移除 ${changes.removed} 门，调整 ${changes.changed} 门`);
                } else {
                  setStatus(droppedActivities > 0
                    ? `课表无调整；另有 ${droppedActivities} 条异常安排未导入`
                    : '刷新完成：课表无调整');
                }
                setAhuMode(null);
                return;
              }
              setAhuMode(null);
              setStatus('');
              setPending({
                courses: ahuCourses,
                report: { warnings, suggestions: [] },
                fileName: sourceName,
              });
            }}
          />
        )}
        {Platform.OS === 'android' && cjluMode && (
          <CjluImportModal
            visible
            mode={cjluMode}
            onCancel={() => setCjluMode(null)}
            onCredentialsSaved={() => setHasCjluCredentials(true)}
            onCredentialsMissing={() => setHasCjluCredentials(false)}
            onImported={(cjluCourses, semesterName, droppedActivities) => {
              const warnings: ReportWarning[] = droppedActivities > 0 ? [{
                category: 'system',
                severity: 'warning',
                message: `中国计量大学有 ${droppedActivities} 条课程安排格式异常，已跳过，请核对课程数量`,
                at: Date.now(),
              }] : [];
              const sourceName = `中国计量大学教务系统 · ${semesterName}`;
              if (cjluMode === 'refresh') {
                const existingCjluCourses = courses.filter((course) => course.id.startsWith('cjlu-'));
                const unrelatedCourses = courses.filter((course) => !course.id.startsWith('cjlu-'));
                const changes = summarizeAhuCourseChanges(existingCjluCourses, cjluCourses);
                const totalChanges = changes.added + changes.removed + changes.changed;
                if (totalChanges > 0) {
                  const merged = mergeAhuCourseCustomizations(existingCjluCourses, cjluCourses);
                  replaceCourses([...unrelatedCourses, ...merged], sourceName, semesterStartDate, { warnings, suggestions: [] });
                  setStatus(`刷新完成：新增 ${changes.added} 门，移除 ${changes.removed} 门，调整 ${changes.changed} 门`);
                } else {
                  setStatus(droppedActivities > 0 ? `课表无调整；另有 ${droppedActivities} 条异常安排未导入` : '刷新完成：课表无调整');
                }
                setCjluMode(null);
                return;
              }
              setCjluMode(null);
              setStatus('');
              setPending({ courses: cjluCourses, report: { warnings, suggestions: [] }, fileName: sourceName });
            }}
          />
        )}
        {Platform.OS === 'android' && schoolWeb === 'cugb' && (
          <SchoolWebModal
            visible
            name="中国地质大学（北京）"
            initialUrl="https://cas.cugb.edu.cn/"
            allowedHosts={['cas.cugb.edu.cn', 'jwglxt.cugb.edu.cn', 'portals.cugb.edu.cn', 'stu.cugb.edu.cn', 'cugb.edu.cn']}
            onClose={() => setSchoolWeb(null)}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  content: { padding: Spacing.four, gap: Spacing.three },
  section: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two, marginBottom: Spacing.two },
  schoolList: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.three, marginBottom: Spacing.two },
  schoolPickerButton: { padding: Spacing.three, borderRadius: Spacing.two, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  schoolPickerInfo: { flex: 1 },
  pickerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  pickerCard: { padding: Spacing.four, borderTopLeftRadius: Spacing.three, borderTopRightRadius: Spacing.three, gap: Spacing.three },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerHint: { fontSize: 12, lineHeight: 18 },
  nativeMissingBanner: { borderWidth: 1, borderColor: '#D6913A' },
  hint: { fontSize: 12, marginBottom: Spacing.one, opacity: 0.7 },
  dateInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    fontSize: 16,
    // Android: default includeFontPadding shifts text up inside the box;
    // center vertically like the week-input on the timetable header.
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  currentDate: { marginTop: Spacing.one, fontSize: 13 },
  dateRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  dateField: { flex: 1, minWidth: 0 },
  dateLabel: { textAlign: 'center', marginTop: Spacing.one, fontSize: 13 },
  button: { padding: Spacing.three, borderRadius: Spacing.two, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: Spacing.one },
  buttonIcon: { marginRight: Spacing.one },
  buttonText: { fontWeight: '700' },
  schoolRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  schoolIcon: { width: 42, height: 42, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  schoolInfo: { flex: 1, minWidth: 0 },
  schoolActions: { gap: Spacing.one, alignItems: 'stretch' },
  schoolButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two },
  schoolButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  refreshButton: { borderWidth: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  refreshButtonText: { color: '#208AEF', fontWeight: '700', fontSize: 13 },
  status: { padding: Spacing.three, borderRadius: Spacing.two },
  clear: { padding: Spacing.two, borderWidth: 1, alignItems: 'center', borderRadius: Spacing.two, flexDirection: 'row', gap: Spacing.one },
  clearIcon: {}
});
