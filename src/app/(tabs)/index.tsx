import { startTransition, useState, useMemo, useEffect, useCallback } from 'react';
import { AppState, Modal, ScrollView, StyleSheet, View, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTimetable } from '@/state/timetable-context';
import { useTheme } from '@/hooks/use-theme';
import { getStoredValue, setStoredValue } from '@/lib/storage';
import { coursesForWeek, coursesToTimetable, periodsArray, DEFAULT_MAX_PERIODS, getTimeSlotMeta, WEEK_DAYS, WEEK_DAY_LABELS, type ScheduledCourse } from '@/types/timetable';
import type { ReportWarning } from '@/lib/reporting/types';
import type { ImportReport } from '@/state/timetable-context';

// Compact layout constants for mobile timetable
const DAY_WIDTH = 52;
const TIME_COL_WIDTH = 28;
const SLOT_BASE_HEIGHT = 72;
const GAP = 2;
const PERIOD_TIMES_KEY = 'course-table-app.period-times.v2';
const PERIOD_DURATIONS_KEY = 'course-table-app.period-durations.v1';

// Short day labels: 一、二、三、四、五、六、日
const SHORT_DAY_LABELS: Record<typeof WEEK_DAYS[number], string> = {
  Monday: '一', Tuesday: '二', Wednesday: '三',
  Thursday: '四', Friday: '五', Saturday: '六', Sunday: '日'
};

export default function TimetableScreen() {
  const theme = useTheme();
  const { courses, isHydrated, semesterStartDate, semesterWeeks, maxPeriods, lastReport, dismissReport } = useTimetable();
    const [selectedWeek, setSelectedWeek] = useState(1);
    const [weekInput, setWeekInput] = useState('1');
    const [selectedCourse, setSelectedCourse] = useState<ScheduledCourse | null>(null);
    const [periodTimes, setPeriodTimes] = useState<Record<number, string>>(() => createDefaultPeriodTimes());
    const [periodDurations, setPeriodDurations] = useState<Record<number, number>>(() => createDefaultPeriodDurations());
    const [periodStorageLoaded, setPeriodStorageLoaded] = useState(false);
    const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
    const [periodTimeInput, setPeriodTimeInput] = useState('');
    const [periodDurationInput, setPeriodDurationInput] = useState('45');
    /** Controls the "解析详情" modal. */
    const [reportDetailOpen, setReportDetailOpen] = useState(false);

  // Auto-jump to current week based on today's date
  const jumpToCurrentWeek = useCallback(() => {
    if (!semesterStartDate) return;
    const start = parseLocalDate(semesterStartDate);
    if (!start) return;
    const today = startOfLocalDay(new Date());
    const elapsedDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
    // Before semester starts -> week 1; after semester ends -> last week
    const currentWeek = Math.min(Math.max(Math.floor(elapsedDays / 7) + 1, 1), semesterWeeks);
    startTransition(() => {
      setSelectedWeek(currentWeek);
      setWeekInput(String(currentWeek));
    });
  }, [semesterStartDate, semesterWeeks]);

  // Jump on mount and when semester start date changes
  useEffect(() => { jumpToCurrentWeek(); }, [jumpToCurrentWeek]);

  // Jump when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') jumpToCurrentWeek();
    });
    return () => subscription.remove();
  }, [jumpToCurrentWeek]);

  // Load persisted period times and durations
  useEffect(() => {
    void (async () => {
      try {
        const saved = await getStoredValue(PERIOD_TIMES_KEY);
        if (saved) setPeriodTimes({ ...createDefaultPeriodTimes(), ...JSON.parse(saved) });
        const savedDurations = await getStoredValue(PERIOD_DURATIONS_KEY);
        if (savedDurations) setPeriodDurations({ ...createDefaultPeriodDurations(), ...JSON.parse(savedDurations) });
      } catch {
        // Keep calculated defaults on parse failure
      } finally {
        setPeriodStorageLoaded(true);
      }
    })();
  }, []);

  // Persist period times
  useEffect(() => {
    if (periodStorageLoaded) void setStoredValue(PERIOD_TIMES_KEY, JSON.stringify(periodTimes));
  }, [periodTimes, periodStorageLoaded]);

  // Persist period durations
  useEffect(() => {
    if (periodStorageLoaded) void setStoredValue(PERIOD_DURATIONS_KEY, JSON.stringify(periodDurations));
  }, [periodDurations, periodStorageLoaded]);

  const selectedCourses = useMemo(() => coursesForWeek(courses, selectedWeek), [courses, selectedWeek]);
  const timetable = useMemo(() => coursesToTimetable(selectedCourses), [selectedCourses]);

  const handleCoursePress = (course: ScheduledCourse) => {
    setSelectedCourse(course);
  };

  const selectWeek = (week: number) => {
    const nextWeek = Math.min(Math.max(week, 1), semesterWeeks);
    setSelectedWeek(nextWeek);
    setWeekInput(String(nextWeek));
  };

  const commitWeekInput = () => {
    const parsedWeek = Number.parseInt(weekInput, 10);
    selectWeek(Number.isNaN(parsedWeek) ? selectedWeek : parsedWeek);
  };

  const openPeriodEditor = (period: number) => {
    setSelectedPeriod(period);
    setPeriodTimeInput(periodTimes[period]);
    setPeriodDurationInput(String(periodDurations[period]));
  };

  const savePeriodTime = () => {
    const duration = Number.parseInt(periodDurationInput, 10);
    if (selectedPeriod === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(periodTimeInput) || !Number.isInteger(duration) || duration < 1 || duration > 240) return;
    setPeriodTimes(current => ({ ...current, [selectedPeriod]: periodTimeInput }));
    setPeriodDurations(current => ({ ...current, [selectedPeriod]: duration }));
    setSelectedPeriod(null);
  };

  const renderCourseCard = (course: ScheduledCourse, duration: number) => (
      <Pressable
        key={course.id}
        onPress={() => handleCoursePress(course)}
        style={[
          styles.card,
          { height: Math.max(duration * SLOT_BASE_HEIGHT - GAP * 2, 58) },
          { borderColor: theme.textSecondary + '33' },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${course.name}，${course.location.address}`}
      >
        <ThemedView type="backgroundElement" style={styles.cardContent}>
          <ThemedText type="smallBold" style={styles.courseName} numberOfLines={5}>{course.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.courseLocation} numberOfLines={4}>
                      {course.location.address || '未填写'}
                    </ThemedText>
        </ThemedView>
      </Pressable>
    );

  // Build positioned courses per day for absolute layout
  const positionedCourses = useMemo(() => {
    const result: Record<string, { top: number; height: number; course: ScheduledCourse }[]> = {};
    WEEK_DAYS.forEach(day => {
      const dayCourses = timetable[day];
      const positioned = dayCourses
              .map(course => {
                const meta = getTimeSlotMeta(course.timeSlot);
                if (!meta) return null;
                // Use the authoritative startPeriod / duration written by
                // the importer so non-standard spans (e.g. `5-7节`) render at
                // the right row and don't overlap adjacent courses.
                const startPeriod = course.startPeriod ?? meta.start;
                const duration = course.duration ?? meta.duration;
                const top = (startPeriod - 1) * SLOT_BASE_HEIGHT + GAP;
                const height = duration * SLOT_BASE_HEIGHT - GAP * 2;
                return { top, height: Math.max(height, 56), course };
              })
              .filter((v): v is { top: number; height: number; course: ScheduledCourse } => v !== null);
      result[day] = positioned;
    });
    return result;
  }, [timetable]);

  if (!isHydrated) return <ThemedView style={styles.center}><ThemedText>正在读取课表...</ThemedText></ThemedView>;

  // Calculate month for top-left display
  const monthStr = semesterStartDate ? formatMonth(semesterStartDate, selectedWeek) : '';

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safe} edges={['right', 'left', 'bottom']}>
        {/* Compact header: week info + week selector */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <ThemedText themeColor="textSecondary" style={styles.summaryText}>
              {courses.length ? `${selectedCourses.length} 门课程 · 第 ${selectedWeek} 周` : '还没有导入课程'}
            </ThemedText>
          </View>
          <View style={styles.weekControls}>
            <Pressable
              onPress={() => selectWeek(selectedWeek - 1)}
              disabled={selectedWeek === 1}
              style={[styles.weekNavBtn, { backgroundColor: theme.backgroundElement }, selectedWeek === 1 && styles.disabledBtn]}
              accessibilityRole="button"
              accessibilityLabel="上一周"
            >
              <ThemedText style={{ color: theme.text }}>‹</ThemedText>
            </Pressable>
            <TextInput
              value={weekInput}
              onChangeText={value => setWeekInput(value.replace(/[^0-9]/g, ''))}
              onBlur={commitWeekInput}
              onSubmitEditing={commitWeekInput}
              keyboardType="number-pad"
              maxLength={2}
              style={[styles.weekInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.backgroundElement }]}
              accessibilityLabel="当前周次"
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.weekTotal}>/ {semesterWeeks}</ThemedText>
            <Pressable
              onPress={() => selectWeek(selectedWeek + 1)}
              disabled={selectedWeek === semesterWeeks}
              style={[styles.weekNavBtn, { backgroundColor: theme.backgroundElement }, selectedWeek === semesterWeeks && styles.disabledBtn]}
              accessibilityRole="button"
              accessibilityLabel="下一周"
            >
              <ThemedText style={{ color: theme.text }}>›</ThemedText>
            </Pressable>
          </View>
        </View>

        {!courses.length ? (
          <ThemedView type="backgroundElement" style={styles.empty}>
                      <ThemedText type="subtitle">从真实课表开始</ThemedText>
                      <ThemedText themeColor="textSecondary">打开“导入课表”，选择 .docx 文件。</ThemedText>
                    </ThemedView>
        ) : (
          <ScrollView style={styles.scrollVertical} contentContainerStyle={styles.scrollVerticalContent} showsVerticalScrollIndicator>
            <ScrollView horizontal style={styles.scrollHorizontal} contentContainerStyle={styles.scrollContent} showsHorizontalScrollIndicator={false}>
              <View style={styles.grid}>
                {/* Time column header with month at top-left */}
                <View style={styles.timeHeader}>
                  <View style={[styles.timeHead, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.textSecondary + '33' }]}>
                    {monthStr && <ThemedText type="small" style={styles.monthLabel}>{monthStr}</ThemedText>}
                  </View>
                  {WEEK_DAYS.map(day => (
                    <View key={day} style={[styles.dayHead, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.textSecondary + '33' }]}>
                      <ThemedText type="smallBold" style={styles.dayLabel}>{SHORT_DAY_LABELS[day]}</ThemedText>
                      {semesterStartDate && <ThemedText type="small" themeColor="textSecondary" style={styles.dateLabel}>{formatDayDate(semesterStartDate, selectedWeek, day)}</ThemedText>}
                    </View>
                  ))}
                </View>

                <View style={styles.gridBody}>
                  {/* Time slots column - compact period numbers with times */}
                  <View style={[styles.timeColumn, { borderRightColor: theme.textSecondary + '33', backgroundColor: theme.backgroundElement }]}>
                    {periodsArray(maxPeriods).map(period => (
                      <View key={period} style={[styles.periodRow, { height: SLOT_BASE_HEIGHT, borderBottomColor: theme.textSecondary + '22' }]}>
                        <Pressable style={styles.timeCell} onPress={() => openPeriodEditor(period)} accessibilityRole="button" accessibilityLabel={`修改第${period}节上课时间`}>
                          <ThemedText type="smallBold" style={styles.periodNumber}>{period}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" style={styles.periodTime}>{formatPeriodRange(periodTimes[period], periodDurations[period])}</ThemedText>
                        </Pressable>
                      </View>
                    ))}
                  </View>

                  {/* Day columns with absolutely positioned course cards */}
                  {WEEK_DAYS.map(day => (
                    <View key={day} style={[styles.dayColumn, { borderRightColor: theme.textSecondary + '22' }]}>
                      {/* Grid lines */}
                      {periodsArray(maxPeriods).map(period => (
                        <View key={period} style={[styles.gridLine, { height: SLOT_BASE_HEIGHT, borderBottomColor: theme.textSecondary + '15', backgroundColor: theme.background }]} />
                      ))}
                      {/* Courses */}
                      {positionedCourses[day].map(({ top, height, course }) => (
                        <View
                          key={course.id}
                          style={[
                            styles.positionedCard,
                            { top, height },
                          ]}
                        >
                          {renderCourseCard(course, course.duration ?? (getTimeSlotMeta(course.timeSlot)?.duration ?? 1))}
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>
          </ScrollView>
        )}
                {lastReport && lastReport.warnings.length > 0 && (
                          <ReportBanner
                            report={lastReport}
                            onPress={() => setReportDetailOpen(true)}
                            onDismiss={dismissReport}
                          />
                        )}

                      </SafeAreaView>

                      {selectedCourse && (
                        <CourseDetailModal course={selectedCourse} periodTimes={periodTimes} periodDurations={periodDurations} onClose={() => setSelectedCourse(null)} />
                      )}
                      {reportDetailOpen && lastReport && (
                        <ReportDetailModal
                          report={lastReport}
                          onClose={() => setReportDetailOpen(false)}
                        />
                      )}
                      {selectedPeriod !== null && (
                        <PeriodTimeModal
                          period={selectedPeriod}
                          value={periodTimeInput}
                          duration={periodDurationInput}
                          onChange={setPeriodTimeInput}
                          onDurationChange={setPeriodDurationInput}
                          onSave={savePeriodTime}
                          onClose={() => setSelectedPeriod(null)}
                        />
                      )}
    </ThemedView>
      );
    }

    // =============================================================================
    // Parse-report UI: a compact banner pinned to the bottom of the timetable
    // plus a full-detail modal. Visible only while `lastReport` has warnings.
    // =============================================================================

    const REPORT_CATEGORY_LABELS: Record<ReportWarning['category'], string> = {
      header: '表头',
      period: '节次',
      cell: '单元格',
      week: '周次',
      teacher: '教师',
      address: '地址',
      system: '系统',
    };

    const REPORT_SEVERITY_COLORS: Record<ReportWarning['severity'], string> = {
      info: '#5B9BD5',
      warning: '#D6913A',
      error: '#C0392B',
    };

    function ReportBanner({ report, onPress, onDismiss }: {
      report: ImportReport;
      onPress: () => void;
      onDismiss: () => void;
    }) {
      const count = report.warnings.length;
      const hasErrors = report.warnings.some((w) => w.severity === 'error');
      const accent = hasErrors ? REPORT_SEVERITY_COLORS.error : REPORT_SEVERITY_COLORS.warning;
      return (
        <View style={[reportBannerStyles.wrap, { borderColor: accent }]}>
          <Pressable onPress={onPress} style={reportBannerStyles.body} accessibilityRole="button" accessibilityLabel="查看解析详情">
            <ThemedText style={[reportBannerStyles.icon, { color: accent }]}>⚠</ThemedText>
            <ThemedText style={reportBannerStyles.text} numberOfLines={2}>
              解析存在 {count} 条警告，点击查看详情
            </ThemedText>
          </Pressable>
          <Pressable onPress={onDismiss} style={reportBannerStyles.dismissBtn} accessibilityRole="button" accessibilityLabel="关闭警告横幅">
            <ThemedText style={reportBannerStyles.dismiss}>×</ThemedText>
          </Pressable>
        </View>
      );
    }

    const reportBannerStyles = StyleSheet.create({
      wrap: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: Spacing.two,
        marginBottom: Spacing.one,
        paddingVertical: Spacing.one,
        paddingHorizontal: Spacing.two,
        borderWidth: 1,
        borderRadius: Spacing.one,
        backgroundColor: 'rgba(214,145,58,0.08)',
      },
      body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
      icon: { fontSize: 18, marginRight: Spacing.one },
      text: { flex: 1, fontSize: 13 },
      dismissBtn: { paddingHorizontal: Spacing.one },
      dismiss: { fontSize: 18, fontWeight: '700', color: '#888' },
    });

    function ReportDetailModal({ report, onClose }: { report: ImportReport; onClose: () => void }) {
      const theme = useTheme();
      // Group warnings by category for readability.
      const grouped = new Map<ReportWarning['category'], ReportWarning[]>();
      for (const w of report.warnings) {
        const arr = grouped.get(w.category) ?? [];
        arr.push(w);
        grouped.set(w.category, arr);
      }
      return (
        <Modal visible={true} onRequestClose={onClose} animationType="slide" transparent={true}>
          <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement, maxHeight: '85%' }]}>
              <View style={styles.modalHeader}>
                <ThemedText type="title" style={styles.modalTitle}>解析详情</ThemedText>
                <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="关闭">
                  <ThemedText type="smallBold" themeColor="textSecondary">×</ThemedText>
                </Pressable>
              </View>
              <ScrollView style={reportDetailStyles.body}>
                <ThemedText themeColor="textSecondary" style={reportDetailStyles.summary}>
                  共 {report.warnings.length} 条警告{report.suggestions.length ? `，${report.suggestions.length} 条建议` : ''}
                </ThemedText>
                {[...grouped.entries()].map(([category, items]) => (
                  <View key={category} style={reportDetailStyles.section}>
                    <ThemedText type="subtitle" style={reportDetailStyles.sectionTitle}>
                      {REPORT_CATEGORY_LABELS[category]}（{items.length}）
                    </ThemedText>
                    {items.map((w, idx) => (
                      <View key={`${category}-${idx}`} style={reportDetailStyles.item}>
                        <View style={[reportDetailStyles.dot, { backgroundColor: REPORT_SEVERITY_COLORS[w.severity] }]} />
                        <View style={reportDetailStyles.itemBody}>
                          <ThemedText style={reportDetailStyles.itemMessage}>{w.message}</ThemedText>
                          {w.rawText ? (
                            <ThemedText themeColor="textSecondary" style={reportDetailStyles.itemRaw} numberOfLines={2}>
                              {w.rawText}
                            </ThemedText>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
                {report.suggestions.length > 0 && (
                  <View style={reportDetailStyles.section}>
                    <ThemedText type="subtitle" style={reportDetailStyles.sectionTitle}>建议</ThemedText>
                    {report.suggestions.map((s, idx) => (
                      <ThemedText key={`s-${idx}`} style={reportDetailStyles.suggestion}>· {s}</ThemedText>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      );
    }

    const reportDetailStyles = StyleSheet.create({
      body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
      summary: { fontSize: 13, marginVertical: Spacing.two },
      section: { marginBottom: Spacing.three },
      sectionTitle: { marginBottom: Spacing.one },
      item: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
      dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
      itemBody: { flex: 1 },
      itemMessage: { fontSize: 14 },
      itemRaw: { fontSize: 12, marginTop: 2 },
      suggestion: { fontSize: 13, marginBottom: 4 },
    });

    function CourseDetailModal({ course, periodTimes, periodDurations, onClose }: { course: ScheduledCourse; periodTimes: Record<number, string>; periodDurations: Record<number, number>; onClose: () => void }) {
  const theme = useTheme();
  const meta = getTimeSlotMeta(course.timeSlot);
  if (!meta) return null;
  // Prefer the authoritative start/end written by the importer so the modal
  // shows the real period range (e.g. `5-7节`), not the coarse slot meta.
  const startPeriod = course.startPeriod ?? meta.start;
  const endPeriod = course.endPeriod ?? meta.end;
  return (
    <Modal visible={true} onRequestClose={onClose} animationType="fade" transparent={true}>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.modalHeader}>
            <ThemedText type="title" style={styles.modalTitle}>{course.name}</ThemedText>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="关闭">
              <ThemedText type="smallBold" themeColor="textSecondary">×</ThemedText>
            </Pressable>
          </View>
          <View style={styles.modalBody}>
                      <DetailRow label="上课时间" value={`${WEEK_DAY_LABELS[course.day]} ${formatPeriodTimeRange(startPeriod, endPeriod, periodTimes, periodDurations)}`} />
                      <DetailRow label="上课地点" value={course.location.address || '未填写'} />
                                            <DetailRow label="教师" value={`${course.teacher.name || '未填写'}${course.teacher.title ? ` · ${course.teacher.title}` : ''}`} />
                      <DetailRow label="周次" value={formatWeekDisplay(course.weekList, course.isOddEven)} />
                    </View>
        </View>
      </View>
    </Modal>
  );
}

function PeriodTimeModal({ period, value, duration, onChange, onDurationChange, onSave, onClose }: { period: number; value: string; duration: string; onChange: (value: string) => void; onDurationChange: (value: string) => void; onSave: () => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Modal visible={true} onRequestClose={onClose} animationType="fade" transparent={true}>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={styles.periodModalTitle}>第{period}节上课时间</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">请输入 24 小时制时间，例如 08:00。</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.periodFieldLabel}>开始时间</ThemedText>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="08:00"
            placeholderTextColor={theme.textSecondary}
            keyboardType="numbers-and-punctuation"
            style={[styles.periodInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
            accessibilityLabel={`第${period}节上课时间`}
            autoFocus
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.periodFieldLabel}>课程时长（分钟）</ThemedText>
          <TextInput
            value={duration}
            onChangeText={onDurationChange}
            placeholder="45"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            style={[styles.periodInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
            accessibilityLabel={`第${period}节课程时长`}
          />
          <View style={styles.periodModalActions}>
            <Pressable onPress={onClose} style={styles.modalActionButton}><ThemedText themeColor="textSecondary">取消</ThemedText></Pressable>
            <Pressable onPress={onSave} style={[styles.modalActionButton, { backgroundColor: theme.backgroundSelected }]}><ThemedText style={{ color: theme.text }}>保存</ThemedText></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createDefaultPeriodTimes(maxPeriods: number = DEFAULT_MAX_PERIODS): Record<number, string> {
  return periodsArray(maxPeriods).reduce<Record<number, string>>((times, period) => {
    const totalMinutes = 8 * 60 + (period - 1) * (45 + 5);
    times[period] = formatMinutes(totalMinutes);
    return times;
  }, {});
}

function createDefaultPeriodDurations(maxPeriods: number = DEFAULT_MAX_PERIODS): Record<number, number> {
  return periodsArray(maxPeriods).reduce<Record<number, number>>((durations, period) => {
    durations[period] = 45;
    return durations;
  }, {});
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatPeriodRange(startTime: string, duration: number): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const endTime = formatMinutes(hours * 60 + minutes + duration);
  return `${startTime}\n${endTime}`;
}

function formatPeriodTimeRange(start: number, end: number, periodTimes: Record<number, string>, periodDurations: Record<number, number>): string {
  const startTime = periodTimes[start];
  const lessonCount = end - start + 1;
  const duration = Array.from({ length: lessonCount }, (_, index) => periodDurations[start + index] ?? 45).reduce((total, minutes) => total + minutes, 0) + (lessonCount - 1) * 5;
  return `(第${start}-${end}节 ${formatPeriodRange(startTime, duration)})`;
}

/**
 * Render a course's week info for the detail modal. Replaces the old
 * "周次模式" full/specific toggle — the v4 shape carries the concrete
 * weekList plus an optional odd/even marker, so we can show:
 *   - "全周" when the list covers [1..N] contiguously with N≥18
 *   - "单周 [1, 3, 5, ...]" / "双周 [2, 4, ...]" when marker present
 *   - "指定周: 1-8, 10-16" (range form) when no marker and not full
 */
function formatWeekDisplay(
  weekList: number[],
  isOddEven: 'odd' | 'even' | null | undefined,
): string {
  if (!weekList || weekList.length === 0) return '未指定';

  // "Full" heuristic: contiguous from 1 and length ≥ DEFAULT_SEMESTER_WEEKS.
  const isFullSemester =
    weekList[0] === 1 &&
    weekList.every((w, i) => i === 0 || w === weekList[i - 1] + 1) &&
    weekList.length >= 18;

  if (isFullSemester) return '全周';
  if (isOddEven === 'odd') return `单周 ${weekList.join(', ')}`;
  if (isOddEven === 'even') return `双周 ${weekList.join(', ')}`;

  // Compress runs to range form for readability: 1,2,3,5,7,8 → "1-3, 5, 7-8".
  const parts: string[] = [];
  let i = 0;
  while (i < weekList.length) {
    const start = weekList[i];
    let end = start;
    let j = i + 1;
    while (j < weekList.length && weekList[j] === end + 1) {
      end = weekList[j];
      j++;
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    i = j;
  }
  return `指定周: ${parts.join(', ')}`;
}

function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) || date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3]) ? null : startOfLocalDay(date);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayDate(startDate: string, week: number, day: typeof WEEK_DAYS[number]): string {
  const start = parseLocalDate(startDate);
  if (!start) return '';
  const dayIndex = WEEK_DAYS.indexOf(day);
  const date = new Date(start);
  date.setDate(start.getDate() + (week - 1) * 7 + dayIndex);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatMonth(startDate: string, week: number): string {
  const start = parseLocalDate(startDate);
  if (!start) return '';
  const date = new Date(start);
  date.setDate(start.getDate() + (week - 1) * 7);
  return `${date.getMonth() + 1}月`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>{label}</ThemedText>
      <ThemedText type="small" style={styles.detailValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safe: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center', paddingHorizontal: 0, paddingBottom: 4, paddingTop: 0 },

  // Compact header: week info + week selector
  header: {
    paddingVertical: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
  },
  headerLeft: { flex: 1 },
  summaryText: { fontSize: 12, lineHeight: 16, opacity: 0.85 },

  weekControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  weekNavBtn: {
    width: 22, height: 22,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledBtn: { opacity: 0.4 },
  weekInput: {
    width: 28, height: 22,
    borderWidth: 1,
    borderRadius: 4,
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontSize: 11,
    lineHeight: 18,
    includeFontPadding: false,
  },
  weekTotal: { fontSize: 10, marginLeft: 0 },

  empty: { padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
  scrollVertical: { flex: 1 },
  scrollVerticalContent: { flexGrow: 1 },
  scrollHorizontal: { flex: 1 },
  scrollContent: { paddingBottom: Spacing.four },

  // Grid layout
  grid: {
    width: TIME_COL_WIDTH + DAY_WIDTH * 7,
    position: 'relative',
  },
  timeHeader: { flexDirection: 'row', zIndex: 10 },
  gridBody: { flexDirection: 'row' },

  // Time column header (top-left corner with month)
  timeHead: {
    width: TIME_COL_WIDTH,
    height: 48,
    borderBottomWidth: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthLabel: { fontSize: 10, fontWeight: '600', opacity: 0.7 },

  // Day headers - compact
  dayHead: {
    width: DAY_WIDTH,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    paddingHorizontal: 1,
  },
  dayLabel: { fontSize: 13, fontWeight: '700' },
  dateLabel: { fontSize: 9, marginTop: 0, opacity: 0.7 },

  // Time column - compact
  timeColumn: {
    width: TIME_COL_WIDTH,
    borderRightWidth: 0.5,
  },
  periodRow: { borderBottomWidth: 0.5 },
  timeCell: {
    width: TIME_COL_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 1,
    paddingVertical: 3,
  },
  periodNumber: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  periodTime: { fontSize: 8, textAlign: 'center', lineHeight: 11, marginTop: 0 },

  // Day columns
  dayColumn: {
    width: DAY_WIDTH,
    position: 'relative',
    borderRightWidth: 0.5,
  },
  gridLine: { borderBottomWidth: 0.5 },
  positionedCard: {
    position: 'absolute',
    left: GAP,
    right: GAP,
    zIndex: 5,
  },

  // Course cards - taller, more readable
    card: {
      borderRadius: 5,
      padding: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 2,
      borderWidth: 1,
      width: '100%',
      height: '100%',
      overflow: 'visible',
    },
    cardContent: {
      flex: 1,
    },
    courseName: { fontSize: 10, lineHeight: 13, fontWeight: '700', flexShrink: 1 },
    courseLocation: { fontSize: 9, lineHeight: 12, marginTop: 0, flexShrink: 1 },
    fileName: { marginTop: Spacing.one, textAlign: 'center', fontSize: 10 },

  // Modals
  modalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
    zIndex: 100,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: Spacing.four,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.three },
  periodModalTitle: { fontSize: 18, marginBottom: Spacing.two },
  periodFieldLabel: { marginTop: Spacing.three },
  periodInput: { height: 42, borderWidth: 1, borderRadius: 6, paddingHorizontal: Spacing.two, marginTop: Spacing.three, fontSize: 16 },
  periodModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.four },
  modalActionButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 6 },
  modalTitle: { fontSize: 18, maxWidth: '80%' },
  closeBtn: { padding: 4 },
  modalBody: { gap: Spacing.two },
  detailRow: { flexDirection: 'row', gap: Spacing.two },
  detailLabel: { minWidth: 64, flexShrink: 0 },
  detailValue: { flex: 1, flexWrap: 'wrap' },
});