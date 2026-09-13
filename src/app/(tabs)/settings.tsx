import { LeadMinutesModal } from '@/components/LeadMinutesModal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NOTIFICATION_ENABLED_KEY, NOTIFICATION_LEAD_MINUTES_KEY } from '@/constants/storage-keys';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  beginScheduleEpoch,
  cancelAllNotifications,
  DEFAULT_LEAD_MINUTES,
  isCurrentScheduleEpoch,
  loadPeriodSchedule,
  requestNotificationPermissions,
  scheduleAllNotifications,
} from '@/lib/notifications';
import { setStoredValue } from '@/lib/storage';
import { sendTestNotification } from '@/lib/test-notification';
import { useBackground } from '@/state/background-context';
import { useAppTheme } from '@/state/theme-context';
import { useTimetable } from '@/state/timetable';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SettingsScreen() {
  const { mode, setMode } = useAppTheme();
  const { clearCourses, courses, importedFileName, semesterStartDate } = useTimetable();
  const {
    bgImageUri, bgOpacity, splashImageUri,
    pickBgImage, resetBgImage, setBgOpacity,
    pickSplashImage, resetSplashImage,
  } = useBackground();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [leadMinutes, setLeadMinutes] = useState(DEFAULT_LEAD_MINUTES);
  const [leadModalVisible, setLeadModalVisible] = useState(false);

  // 加载通知设置
  useEffect(() => {
    void (async () => {
      const prefs = await loadPeriodSchedule();
      setNotificationsEnabled(prefs.enabled);
      setLeadMinutes(prefs.leadMinutes);
    })();
  }, []);

  /** 用指定提前分钟数重排所有课程通知（仅在通知开启且有课表时生效）。
   * 作为一个调度批次运行：与 TimetableContext 的增量 effect 共享同一 epoch
   * 防抖，两个入口并发时以最新批次为准，不会交错覆盖。 */
  const rescheduleNotifications = async (lead: number) => {
    if (courses.length === 0 || !semesterStartDate) return;
    const epoch = beginScheduleEpoch();
    const prefs = await loadPeriodSchedule();
    if (!isCurrentScheduleEpoch(epoch)) return;
    if (!prefs.enabled) return;
    const granted = await requestNotificationPermissions();
    if (!isCurrentScheduleEpoch(epoch)) return;
    if (!granted) return;
    await scheduleAllNotifications(courses, semesterStartDate, prefs.periodTimes, prefs.periodDurations, lead);
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
      // 共享读取：与 Context/重排同一份节次配置，避免各自解析造成口径漂移。
      const prefs = await loadPeriodSchedule();
      const result = await sendTestNotification(courses, semesterStartDate, prefs.periodTimes, prefs.periodDurations);
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
            <ThemedText type="subtitle">课表背景</ThemedText>

            <View style={styles.rowBetween}>
              <ThemedText>背景图片</ThemedText>
              <View style={styles.row}>
                <Pressable onPress={() => void pickBgImage()} style={styles.linkBtn}>
                  <ThemedText style={styles.linkText}>选择图片</ThemedText>
                </Pressable>
                {bgImageUri && (
                  <Pressable onPress={() => void resetBgImage()} style={styles.linkBtn}>
                    <ThemedText style={styles.linkText}>恢复默认</ThemedText>
                  </Pressable>
                )}
              </View>
            </View>
            <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
              {bgImageUri ? '使用自定义图片' : '使用内置立绘'}
            </ThemedText>

            <View style={styles.rowBetween}>
              <ThemedText>背景不透明度</ThemedText>
              <ThemedText themeColor="textSecondary">{Math.round(bgOpacity * 100)}%</ThemedText>
            </View>
            <Slider
              minimumValue={0.05}
              maximumValue={1}
              step={0.05}
              value={bgOpacity}
              onValueChange={(v) => void setBgOpacity(v)}
              minimumTrackTintColor="#4A90D9"
              maximumTrackTintColor="#ccc"
            />

            <View style={styles.rowBetween}>
              <ThemedText>启动页图片</ThemedText>
              <View style={styles.row}>
                <Pressable onPress={() => void pickSplashImage()} style={styles.linkBtn}>
                  <ThemedText style={styles.linkText}>选择图片</ThemedText>
                </Pressable>
                {splashImageUri && (
                  <Pressable onPress={() => void resetSplashImage()} style={styles.linkBtn}>
                    <ThemedText style={styles.linkText}>恢复默认</ThemedText>
                  </Pressable>
                )}
              </View>
            </View>
            <ThemedText themeColor="textSecondary" style={styles.fileInfo}>
              {splashImageUri ? '使用自定义图片' : '使用内置立绘'}
            </ThemedText>
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
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  linkBtn: { paddingVertical: 2, paddingHorizontal: Spacing.two },
  linkText: { color: '#4A90D9', fontWeight: '600' },
  customButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: 999, borderWidth: 1, borderColor: '#4A90D9' },
  customButtonText: { color: '#4A90D9', fontWeight: '600' },
});