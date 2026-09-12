import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRef } from 'react';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

export interface PeriodTimeModalProps {
  period: number;
  hour: string;
  minute: string;
  duration: string;
  onHourChange: (value: string) => void;
  onMinuteChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/** Keep only digits and cap at two characters (HH / MM). */
function sanitizeTimePart(text: string): string {
  return text.replace(/[^0-9]/g, '').slice(0, 2);
}

/** Inline editor for a single period's start time + duration. */
export function PeriodTimeModal({ period, hour, minute, duration, onHourChange, onMinuteChange, onDurationChange, onSave, onClose }: PeriodTimeModalProps) {
  const theme = useTheme();
  const minuteInputRef = useRef<TextInput>(null);
  const durationInputRef = useRef<TextInput>(null);

  const handleHourChange = (text: string) => {
    const digits = sanitizeTimePart(text);
    onHourChange(digits);
    // Auto-advance to the minute box once a valid two-digit hour is entered.
    if (digits.length === 2 && Number(digits) <= 23) minuteInputRef.current?.focus();
  };

  const handleMinuteChange = (text: string) => {
    const digits = sanitizeTimePart(text);
    onMinuteChange(digits);
    // Auto-advance to the duration box once both minute digits are entered.
    if (digits.length === 2) durationInputRef.current?.focus();
  };

  return (
    <Modal visible={true} onRequestClose={onClose} animationType="fade" transparent={true}>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={styles.periodModalTitle}>第{period}节上课时间</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">请输入 24 小时制时间，左侧为时（0-23），右侧为分（0-59）。</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.periodFieldLabel}>开始时间</ThemedText>
          <View style={styles.timeRow}>
            <TextInput
              value={hour}
              onChangeText={handleHourChange}
              placeholder="08"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              maxLength={2}
              style={[styles.timePartInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
              accessibilityLabel={`第${period}节开始时间-时`}
              autoFocus
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.timeColon}>:</ThemedText>
            <TextInput
              ref={minuteInputRef}
              value={minute}
              onChangeText={handleMinuteChange}
              placeholder="00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              maxLength={2}
              style={[styles.timePartInput, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
              accessibilityLabel={`第${period}节开始时间-分`}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.periodFieldLabel}>课程时长（分钟）</ThemedText>
          <TextInput
            ref={durationInputRef}
            value={duration}
            onChangeText={onDurationChange}
            placeholder="45"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            maxLength={3}
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

const styles = StyleSheet.create({
  modalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 12,
    padding: Spacing.four,
  },
  periodModalTitle: { fontSize: 18, marginBottom: Spacing.two },
  periodFieldLabel: { marginTop: Spacing.three },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
  timePartInput: { flex: 1, height: 42, borderWidth: 1, borderRadius: 6, paddingHorizontal: Spacing.two, fontSize: 18, textAlign: 'center' },
  timeColon: { fontSize: 20, fontWeight: '600', marginHorizontal: 2 },
  periodInput: { height: 42, borderWidth: 1, borderRadius: 6, paddingHorizontal: Spacing.two, marginTop: Spacing.three, fontSize: 16 },
  periodModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.four },
  modalActionButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 6 },
});
