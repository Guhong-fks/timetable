import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import type { TimetableProfile } from '@/state/timetable/profiles';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, TextInput, View, Alert } from 'react-native';
import { useState } from 'react';

interface Props {
  visible: boolean;
  profiles: TimetableProfile[];
  activeProfileId: string;
  onSwitch: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function TimetableSwitcherModal({ visible, profiles, activeProfileId, onSwitch, onAdd, onRename, onDelete, onClose }: Props) {
  const theme = useTheme();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const submitAdd = () => { if (newName.trim()) { onAdd(newName); setNewName(''); } };
  const submitRename = () => { if (editingId && editingName.trim()) { onRename(editingId, editingName); setEditingId(null); } };
  const confirmDelete = (profile: TimetableProfile) => Alert.alert('删除课表', `确定删除“${profile.name}”吗？其中的课程数据也会被删除。`, [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => onDelete(profile.id) }]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={e => e.stopPropagation()}>
          <ThemedView style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.titleRow}>
              <ThemedText type="subtitle">切换课表</ThemedText>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="关闭课表列表"><Ionicons name="close" size={22} color={theme.textSecondary} /></Pressable>
            </View>
            {profiles.map(profile => {
              const active = profile.id === activeProfileId;
              const editing = editingId === profile.id;
              return (
                <View key={profile.id} style={[styles.profileRow, { borderBottomColor: theme.textSecondary + '22' }]}>
                  {editing ? <TextInput autoFocus value={editingName} onChangeText={setEditingName} onSubmitEditing={submitRename} style={[styles.renameInput, { color: theme.text }]} /> : <Pressable style={styles.profileButton} onPress={() => { onSwitch(profile.id); onClose(); }}><Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={active ? theme.backgroundSelected : theme.textSecondary} /><View><ThemedText style={active ? styles.activeName : undefined}>{profile.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{profile.courses.length} 门课程</ThemedText></View></Pressable>}
                  {editing ? <Pressable onPress={submitRename}><ThemedText style={{ color: theme.backgroundSelected }}>保存</ThemedText></Pressable> : <View style={styles.actions}><Pressable onPress={() => { setEditingId(profile.id); setEditingName(profile.name); }}><ThemedText type="small" themeColor="textSecondary">重命名</ThemedText></Pressable><Pressable disabled={profiles.length <= 1} onPress={() => confirmDelete(profile)}><ThemedText type="small" style={{ color: profiles.length <= 1 ? theme.textSecondary : '#C0392B' }}>删除</ThemedText></Pressable></View>}
                </View>
              );
            })}
            <View style={styles.addRow}><TextInput value={newName} onChangeText={setNewName} placeholder="新课表名称" placeholderTextColor={theme.textSecondary} style={[styles.addInput, { color: theme.text, borderColor: theme.textSecondary + '55' }]} returnKeyType="done" onSubmitEditing={submitAdd} /><Pressable onPress={submitAdd} style={[styles.addButton, { backgroundColor: theme.backgroundSelected }]}><ThemedText style={{ color: '#fff', fontWeight: '700' }}>新增</ThemedText></Pressable></View>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 80, paddingHorizontal: 12 },
  card: { width: 320, maxWidth: '100%', borderRadius: 14, padding: 16, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  profileRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  profileButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', gap: 10 },
  activeName: { fontWeight: '700' },
  renameInput: { flex: 1, borderBottomWidth: 1, paddingVertical: 6 },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  addInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  addButton: { borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' },
});
