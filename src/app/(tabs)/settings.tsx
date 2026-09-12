import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LeadMinutesModal } from '@/components/LeadMinutesModal';
import { NOTIFICATION_ENABLED_KEY, NOTIFICATION_LEAD_MINUTES_KEY, PERIOD_DURATIONS_KEY, PERIOD_TIMES_KEY } from '@/constants/storage-keys';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { DEFAULT_LEAD_MINUTES, cancelAllNotifications, normalizeLeadMinutes, requestNotificationPermissions, scheduleAllNotifications } from '@/lib/notifications';
import { getStoredValue, setStoredValue } from '@/lib/storage';
import { sendTestNotification } from '@/lib/test-notification';
import { useAppTheme } from '@/state/theme-context';
import { useTimetable } from '@/state/timetable';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SettingsScreen() {
  const { mode, setMode } = useAppTheme();
  const { clearCourses, courses, importedFileName, semesterStartDate } = useTimetable();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [leadMinutes, setLeadMinutes] = useState(DEFAULT_LEAD_MINUTES);
  const [leadModalVisible, setLeadModalVisible] = useState(false);

  // 加载通知设置
  useEffect(() => {
    void (async () => {
      const [saved, savedLead] = await Promise.all([
        getStoredValue(NOTIFICATION_ENABLED_KEY),
        getStoredValue(NOTIFICATION_LEAD_MINUTES_KEY),
      ]);
      if (saved !== null) {
        setNotificationsEnabled(JSON.parse(saved));
      }
      if (savedLead !== null) {
        setLeadMinutes(normalizeLeadMinutes(savedLead));
      }
    })();
  }, []);

  /** 用指定提前分钟数重排所有课程通知（仅在通知开启且有课表时生效）。 */
  const rescheduleNotifications = async (lead: number) => {
    if (courses.length === 0 || !semesterStartDate) return;
    const [savedTimes, savedDurations] = await Promise.all([
      getStoredValue(PERIOD_TIMES_KEY),
      getStoredValue(PERIOD_DURATIONS_KEY),
    ]);
    const periodTimes = savedTimes ? { ...JSON.parse(savedTimes) } : {};
    const periodDurations = savedDurations ? { ...JSON.parse(savedDurations) } : {};
    await scheduleAllNotifications(courses, semesterStartDate, periodTimes, periodDurations, lead);
  };

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
    // 开启后立即按当前提前时间调度；关闭后取消所有已调度通知。
    if (enabled) {
      await rescheduleNotifications(leadMinutes);
    } else {
      await cancelAllNotifications();
    }
  };

  const handleLeadChange = async (minutes: number) => {
    setLeadModalVisible(false);
    setLeadMinutes(minutes);
    await setStoredValue(NOTIFICATION_LEAD_MINUTES_KEY, JSON.stringify(minutes));
    // 通知已开启时，按新提前时间重排所有通知
    if (notificationsEnabled) {
      await rescheduleNotifications(minutes);
    }
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
              <ThemedText>上课前提醒</ThemedText>
              <Switch
                value={notificationsEnabled}
                onValueChange={toggleNotifications}
              />
            </View>

            {notificationsEnabled && (
              <>
                <View style={styles.leadRow}>
                  <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
                    提前提醒时间：{leadMinutes} 分钟
                  </ThemedText>
                  <Pressable
                    onPress={() => setLeadModalVisible(true)}
                    accessibilityRole="button"
                    accessibilityLabel="自定义提前提醒时间"
                    style={styles.customButton}
                  >
                    <ThemedText style={styles.customButtonText}>自定义</ThemedText>
                  </Pressable>
                </View>

                <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
                  提醒声音与震动由系统通知设置管理，可在手机系统设置中调整。
                </ThemedText>
              </>
            )}

            {courses.length > 0 && notificationsEnabled && (
              <Pressable onPress={handleTestNotification} style={styles.testButton}>
                <Ionicons name="flask-outline" size={16} color="#4A90D9" style={styles.testIcon} />
                <ThemedText style={styles.testText}>发送测试通知</ThemedText>
              </Pressable>
            )}
          </ThemedView>

          {Platform.OS === 'android' && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="subtitle">桌面小组件</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
                添加方式：长按桌面空白处 → 「插件」→ 找到「课程表」→ 拖到桌面。
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
                小组件随课表变更即时更新，下课时自动刷新。
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

        {leadModalVisible && (
          <LeadMinutesModal
            currentMinutes={leadMinutes}
            onSave={(minutes) => void handleLeadChange(minutes)}
            onClose={() => setLeadModalVisible(false)}
          />
        )}
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
  leadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.two, gap: Spacing.two },
  customButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: 999, borderWidth: 1, borderColor: '#4A90D9' },
  customButtonText: { color: '#4A90D9', fontWeight: '600' },
});