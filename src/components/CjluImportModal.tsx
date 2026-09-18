import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  CJLU_COURSE_EXTRACTION_SCRIPT,
  CJLU_CREDENTIAL_CAPTURE_SCRIPT,
  buildCjluAutoLoginScript,
  parseCjluCoursePayload,
} from '@/lib/importers/cjlu-importer';
import { clearCjluCredentials, loadCjluCredentials, saveCjluCredentials, type CjluCredentials } from '@/lib/importers/cjlu-credentials';
import type { ScheduledCourse } from '@/types/timetable';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

interface CjluImportModalProps {
  visible: boolean;
  mode: 'import' | 'refresh';
  onCancel: () => void;
  onImported: (courses: ScheduledCourse[], semesterName: string, droppedActivities: number) => void;
  onCredentialsSaved?: () => void;
  onCredentialsMissing?: () => void;
}

const LOGIN_URL = 'https://jwxt.cjlu.edu.cn/xtgl/login_slogin.html';

export function CjluImportModal({ visible, mode, onCancel, onImported, onCredentialsSaved, onCredentialsMissing }: CjluImportModalProps) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCredentials = useRef<CjluCredentials | null>(null);
  const autoLoginStarted = useRef(false);
  const [status, setStatus] = useState(mode === 'refresh' ? '正在读取本机保存的教务账号…' : '请在中国计量大学官方页面完成登录');
  const [reading, setReading] = useState(false);
  const [saveChoice, setSaveChoice] = useState<boolean | null>(mode === 'refresh' ? true : null);
  const [credentials, setCredentials] = useState<CjluCredentials | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const startTimer = (message: string) => {
    clearTimer();
    timer.current = setTimeout(() => {
      setReading(false);
      setStatus(message);
    }, 20000);
  };

  useEffect(() => {
    if (mode !== 'refresh') return;
    let active = true;
    void loadCjluCredentials().then((saved) => {
      if (!active) return;
      if (!saved) {
        setStatus('未找到已保存的中国计量大学账号，请重新登录导入并允许保存');
        onCredentialsMissing?.();
        return;
      }
      setCredentials(saved);
      setStatus('正在自动登录中国计量大学教务系统…');
    }).catch(() => setStatus('读取本机账号失败，请重新登录导入'));
    return () => { active = false; };
  }, [mode, onCredentialsMissing]);

  useEffect(() => () => clearTimer(), []);

  const readCourses = () => {
    setReading(true);
    setStatus('登录成功，正在读取当前学期课表…');
    startTimer('读取超时，请检查登录状态后重试');
    webViewRef.current?.injectJavaScript(CJLU_COURSE_EXTRACTION_SCRIPT);
  };

  const finishImport = async (courses: ScheduledCourse[], droppedActivities: number) => {
    if (mode === 'import' && saveChoice) {
      if (!pendingCredentials.current) {
        setReading(false);
        setStatus('未捕获到登录账号，请重新填写账号密码后再试；课表尚未提交');
        return;
      }
      try {
        const toSave = pendingCredentials.current;
        await saveCjluCredentials(toSave);
        const saved = await loadCjluCredentials();
        if (!saved || saved.username !== toSave.username || saved.password !== toSave.password) throw new Error('账号安全保存校验失败');
        pendingCredentials.current = null;
        onCredentialsSaved?.();
      } catch {
        setReading(false);
        setStatus('账号安全保存失败，课表尚未提交；请重试或选择仅本次使用');
        return;
      }
    }
    clearTimer();
    setReading(false);
    onImported(courses, '当前学期', droppedActivities);
  };

  const webReady = mode === 'import' ? saveChoice !== null : credentials !== null;
  const privacyText = mode === 'refresh'
    ? '账号密码从系统加密存储读取，仅自动填写到中国计量大学官方登录页。'
    : saveChoice
      ? '登录成功并读取课表后，账号密码将加密保存在本机，仅用于后续一键刷新。'
      : '账号密码仅提交给中国计量大学官方页面，本次不会保存。';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={[styles.header, { borderBottomColor: theme.textSecondary + '33' }]}>
            <Pressable onPress={onCancel} hitSlop={10} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
            <View style={styles.titleWrap}>
              <ThemedText type="subtitle">{mode === 'refresh' ? '刷新中国计量大学课表' : '中国计量大学教务导入'}</ThemedText>
              <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.subtitle}>{status}</ThemedText>
            </View>
            {reading ? <ActivityIndicator color="#F59E0B" /> : <View style={styles.headerSpacer} />}
          </View>

          {mode === 'import' && saveChoice === null ? (
            <View style={styles.consentWrap}>
              <View style={[styles.consentCard, { backgroundColor: theme.backgroundSelected + '14', borderColor: theme.textSecondary + '33' }]}>
                <Ionicons name="lock-closed-outline" size={28} color="#F59E0B" />
                <ThemedText type="subtitle">允许保存教务账号？</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.consentText}>允许后，用户名和密码通过系统 SecureStore 加密保存在本机，仅用于后续“刷新课表”。</ThemedText>
                <Pressable onPress={() => { setSaveChoice(true); setStatus('请在中国计量大学官方页面完成登录'); }} style={[styles.consentButton, { backgroundColor: '#F59E0B' }]}>
                  <ThemedText style={styles.primaryButtonText}>允许保存并继续</ThemedText>
                </Pressable>
                <Pressable onPress={() => void clearCjluCredentials().then(() => { onCredentialsMissing?.(); setSaveChoice(false); setStatus('请在中国计量大学官方页面完成登录'); })} style={[styles.consentButton, { borderColor: theme.textSecondary + '55', borderWidth: 1 }]}>
                  <ThemedText>仅本次使用</ThemedText>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.privacy, { backgroundColor: theme.backgroundSelected + '14' }]}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#F59E0B" />
                <ThemedText themeColor="textSecondary" style={styles.privacyText}>{privacyText}</ThemedText>
              </View>
              {webReady ? (
                <WebView
                  ref={webViewRef}
                  source={{ uri: LOGIN_URL }}
                  originWhitelist={['https://jwxt.cjlu.edu.cn', 'https://*.cjlu.edu.cn']}
                  incognito
                  javaScriptEnabled
                  domStorageEnabled
                  thirdPartyCookiesEnabled
                  mixedContentMode="never"
                  onShouldStartLoadWithRequest={({ url }) => {
                    try {
                      const parsed = new URL(url);
                      const allowed = parsed.protocol === 'https:' && (parsed.hostname === 'jwxt.cjlu.edu.cn' || parsed.hostname.endsWith('.cjlu.edu.cn'));
                      if (!allowed) setStatus('已阻止跳转到非中国计量大学网站');
                      return allowed;
                    } catch { return false; }
                  }}
                  onLoadEnd={({ nativeEvent }) => {
                    const isLoginPage = nativeEvent.url.includes('/xtgl/login_slogin');
                    if (mode === 'import' && saveChoice) webViewRef.current?.injectJavaScript(CJLU_CREDENTIAL_CAPTURE_SCRIPT);
                    if (mode === 'refresh' && isLoginPage && credentials && !autoLoginStarted.current) {
                      autoLoginStarted.current = true;
                      setReading(true);
                      startTimer('自动登录超时，请重新登录导入以更新账号密码');
                      webViewRef.current?.injectJavaScript(buildCjluAutoLoginScript(credentials));
                    } else if (mode === 'refresh' && !isLoginPage && autoLoginStarted.current) {
                      readCourses();
                    } else if (!reading) {
                      setStatus('登录后点击下方“读取当前课表”');
                    }
                  }}
                  onMessage={({ nativeEvent }) => {
                    try {
                      const message = JSON.parse(nativeEvent.data) as { type?: string; username?: string; password?: string; payload?: unknown; message?: string };
                      if (message.type === 'cjlu-credentials') {
                        if (mode === 'import' && saveChoice && message.username && message.password) pendingCredentials.current = { username: message.username, password: message.password };
                        return;
                      }
                      if (message.type === 'cjlu-auto-login-error') {
                        clearTimer(); setReading(false); setStatus(message.message || '自动登录失败，请手动登录'); return;
                      }
                      if (message.type === 'cjlu-course-error') {
                        clearTimer(); setReading(false); setStatus(message.message || '读取课表失败，请重试'); return;
                      }
                      if (message.type !== 'cjlu-course-data') return;
                      const parsed = parseCjluCoursePayload(message.payload);
                      if (!parsed.courses.length) { clearTimer(); setReading(false); setStatus('当前学期未读取到课程，请确认教务系统中已有课表'); return; }
                      void finishImport(parsed.courses, parsed.droppedActivities);
                    } catch {
                      clearTimer(); setReading(false); setStatus('教务系统返回数据无法解析，请稍后重试');
                    }
                  }}
                  onError={() => { clearTimer(); setReading(false); setStatus('页面加载失败，请检查网络后重试'); }}
                  style={styles.webView}
                />
              ) : <View style={styles.loadingWrap}><ActivityIndicator color="#F59E0B" /></View>}
              <Pressable onPress={readCourses} disabled={reading} style={[styles.readButton, { backgroundColor: '#F59E0B' }]}>
                <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                <ThemedText style={styles.readButtonText}>{reading ? '正在读取…' : '读取当前课表'}</ThemedText>
              </Pressable>
            </>
          )}
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, safe: { flex: 1 },
  header: { minHeight: 58, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  closeButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' }, titleWrap: { flex: 1 }, subtitle: { fontSize: 12, marginTop: 2 }, headerSpacer: { width: 20 },
  consentWrap: { flex: 1, justifyContent: 'center', padding: Spacing.four }, consentCard: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.four, gap: Spacing.three, alignItems: 'center' }, consentText: { textAlign: 'center', lineHeight: 20 }, consentButton: { width: '100%', padding: Spacing.three, borderRadius: Spacing.two, alignItems: 'center' }, primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  privacy: { margin: Spacing.two, padding: Spacing.two, borderRadius: Spacing.two, flexDirection: 'row', gap: Spacing.one, alignItems: 'center' }, privacyText: { flex: 1, fontSize: 12 }, webView: { flex: 1, marginTop: Spacing.two }, loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' }, readButton: { margin: Spacing.two, padding: Spacing.three, borderRadius: Spacing.two, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one }, readButtonText: { color: '#FFFFFF', fontWeight: '700' },
});
