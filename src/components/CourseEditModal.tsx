import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Colors } from '@/constants/theme';
import { periodsArray, WEEK_DAY_LABELS, type ScheduledCourse } from '@/types/timetable';

/** Same pastel palette as the grid renderer (index.tsx COURSE_PALETTE).
 * Kept in sync manually; both read the same #RRGGBB hexes. */
const COURSE_PALETTE = [
  '#4A90D9', // blue
  '#5BAE6E', // green
  '#E0913C', // orange
  '#9B6FD4', // purple
  '#D96A9C', // pink
  '#42AFA5', // teal
  '#C9A227', // gold
  '#6C7BD9', // indigo
];

/** Rederive the name-hash hue so "默认" (no override) shows the color the
 * card would render with. Must match courseHue in index.tsx. */
function courseHue(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COURSE_PALETTE[hash % COURSE_PALETTE.length];
}

export interface CourseEditModalProps {
  course: ScheduledCourse;
  semesterWeeks: number;
  /** 'edit' (default) patches an existing course; 'create' appends a new
   * one (add-from-empty-slot) and hides the delete action. */
  mode?: 'edit' | 'create';
  /** Called with the validated patch on 保存 (edit mode). The screen
   * applies it via updateCourse and closes the modal. Unused in create
   * mode (onCreate takes over). */
  onUpdate?: (patch: Partial<ScheduledCourse>) => void;
  /** Called with the validated full course on 保存 (create mode). The
   * screen applies it via addCourse and closes the modal. */
  onCreate?: (course: Omit<ScheduledCourse, 'id'>) => void;
  /** Delete scopes (delete-confirm sheet). The screen resolves the ids to
   * remove via deleteCourses. */
  onDelete?: (scope: 'this' | 'weekly' | 'semester') => void;
  /** Courses matching this course's name — lets the confirm sheet show
   * how many sessions each scope would delete. */
  sameNameCount?: number;
  onClose: () => void;
}

/**
 * Course-edit modal: name, card color, weeks (toggle grid), period range,
 * teacher, location, note. Local form state seeded from the course; 保存
 * validates (name non-empty, start ≤ end) and hands a patch upward.
 */
export function CourseEditModal({ course, semesterWeeks, mode = 'edit', onUpdate, onCreate, onDelete, sameNameCount, onClose }: CourseEditModalProps) {
  const theme = useTheme();
  // Dark mode hides the color picker: the grid renders ONE unified card
  // hue there (per-course hues turn to mud on the dark base), so picking
  // a color would silently do nothing. The stored colorOverride survives
  // and applies again when the user switches back to light.
  const isDark = theme.background === Colors.dark.background;
  // null = edit form; a scope value = delete-confirm sheet over the form.
  const [confirmScope, setConfirmScope] = useState<'this' | 'weekly' | 'semester' | null>(null);
  const [name, setName] = useState(course.name);
  const [color, setColor] = useState<string>(course.colorOverride ?? courseHue(course.name));
  const [colorIsCustom, setColorIsCustom] = useState<boolean>(course.colorOverride != null);
  const [startPeriod, setStartPeriod] = useState(String(course.startPeriod));
  const [endPeriod, setEndPeriod] = useState(String(course.endPeriod));
  const [teacher, setTeacher] = useState(course.teacher.name);
  const [location, setLocation] = useState(course.location.address);
  const [note, setNote] = useState(course.note ?? '');
  const [error, setError] = useState('');
  // Weeks: local toggle set seeded from the course's weekList.
  const [weeks, setWeeks] = useState<Set<number>>(() => new Set(course.weekList));
  const weeksLabel = useMemo(() => {
    if (weeks.size === 0) return '未选择周次';
    const sorted = [...weeks].sort((a, b) => a - b);
    // Compact runs: 1,2,3,5 → 1-3, 5
    const parts: string[] = [];
    let i = 0;
    while (i < sorted.length) {
      const start = sorted[i];
      let end = start;
      let j = i + 1;
      while (j < sorted.length && sorted[j] === end + 1) { end = sorted[j]; j++; }
      parts.push(start === end ? `${start}` : `${start}-${end}`);
      i = j;
    }
    return parts.join(', ');
  }, [weeks]);

  const toggleWeek = (week: number) => {
    setWeeks(current => {
      const next = new Set(current);
      if (next.has(week)) next.delete(week); else next.add(week);
      return next;
    });
  };

  const save = () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setError('课程名称不能为空'); return; }
    const start = Number.parseInt(startPeriod, 10);
    const end = Number.parseInt(endPeriod, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > 13 || end > 13) {
      setError('节次需为 1-13 的整数');
      return;
    }
    if (start > end) { setError('开始节次不能晚于结束节次'); return; }
    if (weeks.size === 0) { setError('请至少选择一个上课周次'); return; }
    const day = course.day; // day comes from the tapped slot; not editable here
    const isOddEven: ScheduledCourse['isOddEven'] = null;
    const fields = {
      name: trimmedName,
      day,
      timeSlot: course.timeSlot, // recomputed by sanitizeCourses from periods
      startPeriod: start,
      endPeriod: end,
      duration: end - start + 1,
      teacher: { ...course.teacher, name: teacher.trim() },
      location: { address: location.trim() },
      note: note.trim(),
      colorOverride: isDark ? course.colorOverride : (colorIsCustom ? color : undefined),
      weekList: [...weeks].sort((a, b) => a - b),
      isOddEven,
    } as Partial<ScheduledCourse>;
    if (mode === 'create') {
      onCreate?.(fields as Omit<ScheduledCourse, 'id'>);
      return;
    }
    onUpdate?.(fields);
  };

  return (
    <Modal visible={true} onRequestClose={onClose} animationType="fade" transparent={true}>
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.header}>
            <ThemedText type="title" style={styles.title}>{mode === 'create' ? '添加课程' : '编辑课程'}</ThemedText>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="关闭">
              <ThemedText type="smallBold" themeColor="textSecondary">×</ThemedText>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {/* Name */}
            <ThemedText type="smallBold" style={styles.fieldLabel}>课程名称</ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
              accessibilityLabel="课程名称"
            />

            {/* Color — light mode only. Dark renders one unified card hue,
                so a picker there would be a no-op (and confusing). */}
            {!isDark && (
              <>
                <ThemedText type="smallBold" style={styles.fieldLabel}>课卡颜色</ThemedText>
                <View style={styles.colorRow}>
                  {COURSE_PALETTE.map(hex => (
                    <Pressable
                      key={hex}
                      onPress={() => { setColor(hex); setColorIsCustom(true); }}
                      style={[
                        styles.colorDot,
                        { backgroundColor: hex },
                        colorIsCustom && color === hex && styles.colorDotSelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`选择颜色 ${hex}`}
                    />
                  ))}
                  <Pressable
                    onPress={() => setColorIsCustom(false)}
                    style={[styles.colorDot, styles.defaultDot, { borderColor: theme.textSecondary }, !colorIsCustom && styles.colorDotSelected]}
                    accessibilityRole="button"
                    accessibilityLabel="使用默认颜色"
                  >
                    <ThemedText type="small" themeColor="textSecondary" style={styles.defaultDotText}>默认</ThemedText>
                  </Pressable>
                </View>
              </>
            )}

            {/* Weeks toggle grid */}
            <ThemedText type="smallBold" style={styles.fieldLabel}>
              上课周次（{weeksLabel}）
            </ThemedText>
            <View style={styles.weekGrid}>
              {periodsArray(semesterWeeks).map(week => (
                <Pressable
                  key={week}
                  onPress={() => toggleWeek(week)}
                  style={[
                    styles.weekCell,
                    { backgroundColor: weeks.has(week) ? theme.backgroundSelected : theme.background, borderColor: theme.textSecondary + '55' },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`第${week}周`}
                >
                  <ThemedText type="small" style={weeks.has(week) ? styles.weekCellOn : undefined}>{week}</ThemedText>
                </Pressable>
              ))}
            </View>

            {/* Period range */}
            <ThemedText type="smallBold" style={styles.fieldLabel}>上课时间（第几节到第几节）</ThemedText>
            <View style={styles.periodRow}>
              <TextInput
                value={startPeriod}
                onChangeText={v => setStartPeriod(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.periodInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
                accessibilityLabel="开始节次"
              />
              <ThemedText themeColor="textSecondary" style={styles.periodDash}>节 至</ThemedText>
              <TextInput
                value={endPeriod}
                onChangeText={v => setEndPeriod(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.periodInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
                accessibilityLabel="结束节次"
              />
              <ThemedText themeColor="textSecondary">节</ThemedText>
            </View>

            {/* Teacher */}
            <ThemedText type="smallBold" style={styles.fieldLabel}>教师</ThemedText>
            <TextInput
              value={teacher}
              onChangeText={setTeacher}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
              accessibilityLabel="教师"
            />

            {/* Location */}
            <ThemedText type="smallBold" style={styles.fieldLabel}>上课地点</ThemedText>
            <TextInput
              value={location}
              onChangeText={setLocation}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
              accessibilityLabel="上课地点"
            />

            {/* Note */}
            <ThemedText type="smallBold" style={styles.fieldLabel}>备注</ThemedText>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              style={[styles.input, styles.noteInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
              accessibilityLabel="备注"
              placeholder="选填"
              placeholderTextColor={theme.textSecondary}
            />

            {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
          </ScrollView>

          <View style={styles.actions}>
            {mode === 'edit' && (
              <Pressable onPress={() => setConfirmScope('this')} style={[styles.actionBtn, styles.deleteBtn]} accessibilityRole="button" accessibilityLabel="删除课程">
                <ThemedText style={styles.deleteText}>删除</ThemedText>
              </Pressable>
            )}
            <View style={styles.actionsRight}>
              <Pressable onPress={onClose} style={[styles.actionBtn, { backgroundColor: theme.background }]}>
                <ThemedText themeColor="textSecondary">取消</ThemedText>
              </Pressable>
              <Pressable onPress={save} style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="button" accessibilityLabel="保存课程信息">
                <ThemedText type="smallBold">保存</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
        {confirmScope !== null && (
          <DeleteConfirmSheet
            course={course}
            scope={confirmScope}
            sameNameCount={sameNameCount}
            onConfirm={(scope) => { setConfirmScope(null); onDelete?.(scope); }}
            onCancel={() => setConfirmScope(null)}
          />
        )}
      </View>
    </Modal>
  );
}

/** Delete scope options shown in the confirm sheet. Scope semantics:
 *  'this'     — remove ONLY the current week from this course's weekList
 *               (the cell disappears from the currently-viewed week; other
 *               weeks keep the course). The screen resolves this by
 *               patching weekList.
 *  'weekly'   — remove this course's WEEKLY SLOT on this weekday+periods
 *               (every week, same day & periods): delete every same-name
 *               course with identical day+start+end. Other slots of the
 *               same course (different periods/days) stay.
 *  'semester' — remove the course from the ENTIRE semester: every
 *               same-name course across all days/periods/weeks. */
export type DeleteScope = 'this' | 'weekly' | 'semester';

function scopeDescription(
  scope: DeleteScope,
  course: ScheduledCourse,
  sameNameCount: number,
): { title: string; detail: string } {
  const day = WEEK_DAY_LABELS[course.day];
  const periodText = course.startPeriod === course.endPeriod
    ? `第${course.startPeriod}节`
    : `第${course.startPeriod}-${course.endPeriod}节`;
  switch (scope) {
    case 'this':
      return {
        title: '仅删除本周这节课',
        detail: '只从当前查看的周次中移除这个格子，其他周仍正常显示该课。',
      };
    case 'weekly':
      return {
        title: '删除每周这一天的这节课',
        detail: `删除这门课每周${day} ${periodText} 的全部排课（${sameNameCount > 1 ? `共 ${sameNameCount} 个相同时间的格子` : '1 个格子'}）。该课程其他时间（如其他节次）的排课不受影响。`,
      };
    case 'semester':
      return {
        title: '删除本学期的这节课',
        detail: `从整个学期删除「${course.name}」的全部 ${sameNameCount} 个排课格子，包括一周中其他时间的该课。不可恢复。`,
      };
  }
}

/** Scope-picker + explicit confirm. Renders over the edit form inside
 * the same modal overlay. */
function DeleteConfirmSheet({
  course,
  scope: initialScope,
  sameNameCount,
  onConfirm,
  onCancel,
}: {
  course: ScheduledCourse;
  scope: DeleteScope;
  sameNameCount?: number;
  onConfirm: (scope: DeleteScope) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [scope, setScope] = useState<DeleteScope>(initialScope);
  const [checked, setChecked] = useState(false);
  return (
    <View style={confirmStyles.backdrop}>
      <View style={[confirmStyles.sheet, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="subtitle" style={confirmStyles.title}>删除课程</ThemedText>
        <ThemedText themeColor="textSecondary" style={confirmStyles.subtitle}>
          {course.name}
        </ThemedText>

        {(['this', 'weekly', 'semester'] as DeleteScope[]).map(option => {
          const desc = scopeDescription(option, course, sameNameCount ?? 1);
          const selected = scope === option;
          return (
            <Pressable
              key={option}
              onPress={() => { setScope(option); setChecked(false); }}
              style={[confirmStyles.option, { backgroundColor: selected ? theme.backgroundSelected : theme.background }]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <ThemedText type="smallBold" style={confirmStyles.optionTitle}>{desc.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={confirmStyles.optionDetail}>{desc.detail}</ThemedText>
            </Pressable>
          );
        })}

        {/* Explicit confirm gate: the delete button stays disabled until
            the user checks 我确认删除 — no accidental destructive taps. */}
        <Pressable
          onPress={() => setChecked(v => !v)}
          style={confirmStyles.confirmRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
        >
          <View style={[confirmStyles.checkbox, { borderColor: theme.textSecondary }, checked && { backgroundColor: theme.backgroundSelected, borderColor: theme.backgroundSelected }]}>
            {checked ? <ThemedText type="smallBold" style={confirmStyles.checkmark}>✓</ThemedText> : null}
          </View>
          <ThemedText type="small">我确认删除</ThemedText>
        </Pressable>

        <View style={confirmStyles.actions}>
          <Pressable onPress={onCancel} style={[confirmStyles.btn, { backgroundColor: theme.background }]} accessibilityRole="button">
            <ThemedText themeColor="textSecondary">取消</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => checked && onConfirm(scope)}
            disabled={!checked}
            style={[confirmStyles.btn, { backgroundColor: checked ? '#C0392B' : theme.background, opacity: checked ? 1 : 0.55 }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !checked }}
            accessibilityLabel="确认删除"
          >
            <ThemedText style={{ color: checked ? '#FFFFFF' : theme.textSecondary }}>确认删除</ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const confirmStyles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  sheet: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 14,
    padding: Spacing.four,
  },
  title: { fontSize: 17, marginBottom: 2 },
  subtitle: { fontSize: 13, marginBottom: Spacing.three },
  option: {
    borderRadius: 8,
    padding: Spacing.two,
    marginBottom: Spacing.two,
  },
  optionTitle: { fontSize: 13 },
  optionDetail: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  checkbox: {
    width: 18, height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: { fontSize: 12, lineHeight: 14 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
  },
  btn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 6,
  },
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
    zIndex: 100,
  },
  sheet: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '85%',
    borderRadius: 16,
    paddingBottom: Spacing.three,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  title: { fontSize: 18 },
  closeBtn: { padding: 4 },
  scroll: { paddingHorizontal: Spacing.four },
  scrollContent: { paddingBottom: Spacing.two, gap: Spacing.one },
  fieldLabel: { marginTop: Spacing.two, marginBottom: Spacing.one },
  input: {
    height: 40,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: Spacing.two,
    fontSize: 14,
  },
  noteInput: { height: 72, textAlignVertical: 'top', paddingTop: Spacing.two },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  colorDot: { width: 30, height: 30, borderRadius: 15 },
  colorDotSelected: { borderWidth: 2.5, borderColor: '#FFFFFF88' },
  defaultDot: { borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  defaultDotText: { fontSize: 9 },
  weekGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  weekCell: {
    width: 34, height: 28,
    borderRadius: 5,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  weekCellOn: { fontWeight: '700' },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  periodInput: {
    width: 48,
    height: 40,
    borderWidth: 1,
    borderRadius: 6,
    textAlign: 'center',
    fontSize: 15,
  },
  periodDash: { fontSize: 13 },
  errorText: { color: '#C0392B', fontSize: 12, marginTop: Spacing.two },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.three,
  },
  actionBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 6,
  },
  deleteBtn: {
    backgroundColor: 'rgba(192,57,43,0.12)',
  },
  deleteText: { color: '#C0392B' },
  actionsRight: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginLeft: 'auto',
  },
});
