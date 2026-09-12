import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { requestNotificationPermissions } from '@/lib/notifications';
import { getStoredValue, setStoredValue } from '@/lib/storage';
import { sendTestNotification } from '@/lib/test-notification';
import { useAppTheme } from '@/state/theme-context';
import { useTimetable } from '@/state/timetable';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const NOTIFICATION_ENABLED_KEY = 'course-table-app.notifications.enabled.v1';
const PERIOD_TIMES_KEY = 'course-table-app.period-times.v2';
const PERIOD_DURATIONS_KEY = 'course-table-app.period-durations.v1';

export default function SettingsScreen() {
  const { mode, setMode } = useAppTheme();
  const { clearCourses, courses, importedFileName, semesterStartDate } = useTimetable();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // 加载通知设置
  useEffect(() => {
    void (async () => {
      const saved = await getStoredValue(NOTIFICATION_ENABLED_KEY);
      if (saved !== null) {
        setNotificationsEnabled(JSON.parse(saved));
      }
    })();
  }, []);

  const toggleNotifications = async (enabled: boolean) => {
    if (enabled) {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        // 权限被拒绝，不更新状态
        return;
      }
    }
    setNotificationsEnabled(enabled);
    await setStoredValue(NOTIFICATION_ENABLED_KEY, JSON.stringify(enabled));
  };

  const handleTestNotification = async () => {
    try {
      const [savedTimes, savedDurations] = await Promise.all([
        getStoredValue(PERIOD_TIMES_KEY),
        getStoredValue(PERIOD_DURATIONS_KEY),
      ]);
      const periodTimes = savedTimes ? { ...JSON.parse(savedTimes) } : {};
      const periodDurations = savedDurations ? { ...JSON.parse(savedDurations) } : {};
      
      const result = await sendTestNotification(courses, semesterStartDate, periodTimes, periodDurations);
      Alert.alert(result.success ? '成功' : '失败', result.message);
    } catch (error) {
      Alert.alert('错误', '发送测试通知失败：' + (error as Error).message);
    }
  };

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
            <ThemedText type="subtitle">提醒</ThemedText>

            <View style={styles.optionRow}>
              <ThemedText>上课前15分钟提醒</ThemedText>
              <Switch
                value={notificationsEnabled}
                onValueChange={toggleNotifications}
              />
            </View>

            {courses.length > 0 && notificationsEnabled && (
              <Pressable onPress={handleTestNotification} style={styles.testButton}>
                <Ionicons name="flask-outline" size={16} color="#4A90D9" style={styles.testIcon} />
                <ThemedText style={styles.testText}>发送测试通知（15秒后弹出）</ThemedText>
              </Pressable>
            )}
          </ThemedView>

          {Platform.OS === 'android' && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="subtitle">桌面小组件</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
                添加方式：长按桌面空白处 → 「小组件」→ 找到「课程表」→ 拖到桌面。
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
                小组件随课表变更即时更新，并每 30 分钟按当天课程自动刷新；点击小组件可直接打开 App。
              </ThemedText>
            </ThemedView>
          )}

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
            <ThemedText themeColor="textSecondary">课程表 v1.0.4</ThemedText>
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
  testButton: { padding: Spacing.two, borderWidth: 1, borderColor: '#4A90D9', alignItems: 'center', borderRadius: Spacing.two, marginTop: Spacing.two, flexDirection: 'row', gap: Spacing.one, backgroundColor: '#E6F4FE' },
  testIcon: {},
  testText: { color: '#4A90D9', fontWeight: '600' },
});