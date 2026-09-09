import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTimetable } from '@/state/timetable';
import { useAppTheme } from '@/state/theme-context';

export default function SettingsScreen() {
  const { mode, setMode } = useAppTheme();
  const { clearCourses, courses, importedFileName } = useTimetable();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">设置</ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="subtitle">外观</ThemedText>
            
            <View style={styles.optionRow}>
              <ThemedText>浅色模式</ThemedText>
              <Switch
                value={mode === 'light'}
                onValueChange={() => setMode('light')}
              />
            </View>
            
            <View style={styles.optionRow}>
              <ThemedText>深色模式</ThemedText>
              <Switch
                value={mode === 'dark'}
                onValueChange={() => setMode('dark')}
              />
            </View>
            
            <View style={styles.optionRow}>
              <ThemedText>跟随系统</ThemedText>
              <Switch
                value={mode === 'auto'}
                onValueChange={() => setMode('auto')}
              />
            </View>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="subtitle">数据</ThemedText>
            {importedFileName && (
              <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
                当前文件：{importedFileName}
              </ThemedText>
            )}
            <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
              共 {courses.length} 门课程
            </ThemedText>
            {courses.length > 0 && (
              <Pressable onPress={clearCourses} style={styles.destructiveButton}>
                <Ionicons name="trash-outline" size={16} color="#E57373" style={styles.destructiveIcon} />
                <ThemedText style={styles.destructiveText}>清空所有课程数据</ThemedText>
              </Pressable>
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="subtitle">关于</ThemedText>
            <ThemedText themeColor="textSecondary">课程表 v1.0.3</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              基于 Expo + React Native 构建
            </ThemedText>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  content: { padding: Spacing.four, gap: Spacing.four },
  section: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two },
  optionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  fileInfo: { fontSize: 14 },
  hint: { marginTop: Spacing.one },
  destructiveButton: { padding: Spacing.two, borderWidth: 1, borderColor: '#E57373', alignItems: 'center', borderRadius: Spacing.two, marginTop: Spacing.two, flexDirection: 'row', gap: Spacing.one },
  destructiveIcon: {},
  destructiveText: { color: '#E57373', fontWeight: '600' },
});