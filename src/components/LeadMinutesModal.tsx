import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useState } from 'react';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { DEFAULT_LEAD_MINUTES, MAX_LEAD_MINUTES } from '@/lib/notifications';

export interface LeadMinutesModalProps {
  currentMinutes: number;
  onSave: (minutes: number) => void;
  onClose: () => void;
}

/** 自定义上课前提醒时间（分钟）的输入弹窗。 */
export function LeadMinutesModal({ currentMinutes, onSave, onClose }: LeadMinutesModalProps) {
  const theme = useTheme();
  const [input, setInput] = useState(String(currentMinutes));

  const handleSave = () => {
    const minutes = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(minutes) || minutes <= 0) {
      // 非法输入：重置为默认并提示
      onSave(DEFAULT_LEAD_MINUTES);
      return;
    }
    onSave(Math.min(Math.floor(minutes), MAX_LEAD_MINUTES));
  };

  return (
    <Modal visible={true} onRequestClose={onClose} animationType="fade" transparent={true}>
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={styles.title}>自定义提前提醒时间</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            请输入上课前提前提醒的分钟数（1-{MAX_LEAD_MINUTES}）。
          </ThemedText>
          <TextInput
            value={input}
            onChangeText={(text) => setInput(text.replace(/[^0-9]/g, '').slice(0, 3))}
            placeholder={`${DEFAULT_LEAD_MINUTES}`}
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            maxLength={3}
            autoFocus
            accessibilityLabel="提前提醒分钟数"
            style={[styles.input, { color: theme.text, borderColor: theme.textSecondary + '66', backgroundColor: theme.background }]}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.actionButton}>
              <ThemedText themeColor="textSecondary">取消</ThemedText>
            </Pressable>
            <Pressable onPress={handleSave} style={[styles.actionButton, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText style={{ color: theme.text }}>保存</ThemedText>
            </Pressable>
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
  title: { fontSize: 18, marginBottom: Spacing.two },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: Spacing.two,
    marginTop: Spacing.three,
    fontSize: 16,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.four },
  actionButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 6 },
});
