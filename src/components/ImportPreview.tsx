// =============================================================================
// ImportPreview — post-parse confirmation screen (module component)
// -----------------------------------------------------------------------------
// Shown between "解析完成" and "落库": lists every recognized course with the
// fields the recognizer derived, lets the user tick off entries, edit obvious
// field mistakes inline (name / location / teacher), and only then commit the
// checked subset to the store. Unchecked rows are dropped.
//
// This is the "整表失败变局部修正" screen: a wrong column mapping or a
// misread cell no longer costs a full re-import.
// =============================================================================
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEEK_DAY_LABELS, type ScheduledCourse } from '@/types/timetable';
import type { ReportWarning } from '@/lib/reporting/types';

export interface ImportPreviewProps {
  /** Parsed courses straight from the recognizer (pre-store). */
  courses: ScheduledCourse[];
  /** Parser warnings for the context banner. */
  report: { warnings: ReportWarning[]; suggestions: string[] };
  fileName: string;
  onCommit: (kept: ScheduledCourse[]) => void;
  onCancel: () => void;
}

interface RowState {
  course: ScheduledCourse;
  name: string;
  location: string;
  teacher: string;
  included: boolean;
}

export function ImportPreview({
  courses,
  report,
  fileName,
  onCommit,
  onCancel,
}: ImportPreviewProps) {
  const theme = useTheme();
  const [rows, setRows] = useState<RowState[]>(() =>
    courses.map((course) => ({
      course,
      name: course.name,
      location: course.location.address,
      teacher: course.teacher.name,
      included: true,
    })),
  );

  const includedCount = useMemo(() => rows.filter((r) => r.included).length, [rows]);
  const errorCount = useMemo(
    () => report.warnings.filter((w) => w.severity === 'error').length,
    [report.warnings],
  );

  const patchRow = (index: number, patch: Partial<RowState>) => {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const commit = () => {
    const kept = rows
      .filter((r) => r.included)
      .map((r): ScheduledCourse => ({
        ...r.course,
        name: r.name.trim() || '未命名课程',
        location: { address: r.location.trim() },
        teacher: { name: r.teacher.trim() },
      }));
    onCommit(kept);
  };

  const border = theme.textSecondary + '55';
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">确认导入</ThemedText>
        <ThemedText themeColor="textSecondary">
          {fileName} · 解析出 {courses.length} 门课程。取消勾选即丢弃该课；点击字段可直接修正。
        </ThemedText>
        {errorCount > 0 && (
          <ThemedView type="backgroundElement" style={[styles.warnBox, { borderColor: '#D6913A' }]}>
            <ThemedText type="small" style={{ color: '#D6913A' }}>
              解析报告含 {errorCount} 条错误警告，建议展开核对对应课程（详见导入页的“查看解析详情”）。
            </ThemedText>
          </ThemedView>
        )}
        {rows.map((row, index) => (
          <ThemedView
            key={row.course.id}
            type="backgroundElement"
            style={[styles.card, { borderColor: row.included ? theme.textSecondary + '33' : theme.textSecondary + '18' }]}
          >
            <View style={styles.cardHead}>
              <Pressable
                onPress={() => patchRow(index, { included: !row.included })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: row.included }}
                style={styles.check}
                hitSlop={8}
              >
                <Ionicons
                  name={row.included ? 'checkbox-outline' : 'square-outline'}
                  size={20}
                  color={row.included ? theme.backgroundSelected : theme.textSecondary}
                />
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                {WEEK_DAY_LABELS[row.course.day]} 第{row.course.startPeriod}
                {row.course.endPeriod !== row.course.startPeriod ? `-${row.course.endPeriod}` : ''}节 ·{' '}
                {row.course.weekList.length
                  ? `${row.course.weekList[0]}-${row.course.weekList[row.course.weekList.length - 1]}周`
                  : '全学期'}
              </ThemedText>
            </View>
            <TextInput
              value={row.name}
              onChangeText={(text) => patchRow(index, { name: text })}
              style={[styles.input, styles.nameInput, { color: theme.text, borderColor: border }]}
              placeholder="课程名"
              placeholderTextColor={theme.textSecondary}
            />
            <View style={styles.fieldRow}>
              <TextInput
                value={row.location}
                onChangeText={(text) => patchRow(index, { location: text })}
                style={[styles.input, styles.flex1, { color: theme.text, borderColor: border }]}
                placeholder="上课地点"
                placeholderTextColor={theme.textSecondary}
              />
              <TextInput
                value={row.teacher}
                onChangeText={(text) => patchRow(index, { teacher: text })}
                style={[styles.input, styles.teacherInput, { color: theme.text, borderColor: border }]}
                placeholder="教师"
                placeholderTextColor={theme.textSecondary}
              />
            </View>
          </ThemedView>
        ))}
      </ScrollView>
      <ThemedView type="backgroundElement" style={styles.footer}>
        <Pressable onPress={onCancel} style={[styles.footerBtn, { borderColor: border }]}>
          <ThemedText themeColor="textSecondary">放弃</ThemedText>
        </Pressable>
        <Pressable
          onPress={commit}
          disabled={includedCount === 0}
          style={[
            styles.footerBtn,
            styles.commitBtn,
            { backgroundColor: theme.backgroundSelected, opacity: includedCount === 0 ? 0.4 : 1 },
          ]}
        >
          <ThemedText style={{ color: theme.background, fontWeight: '700' }}>
            导入 {includedCount} 门课程
          </ThemedText>
        </Pressable>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  warnBox: { padding: Spacing.three, borderRadius: Spacing.two, borderWidth: 1 },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
    borderWidth: 1,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  check: { padding: 2 },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    fontSize: 14,
  },
  nameInput: { fontWeight: '600' },
  fieldRow: { flexDirection: 'row', gap: Spacing.two },
  flex1: { flex: 1 },
  teacherInput: { width: 96 },
  footer: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.four,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.25)',
  },
  footerBtn: {
    flex: 1,
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
    borderColor: 'transparent',
  },
  commitBtn: { borderWidth: 0 },
});
