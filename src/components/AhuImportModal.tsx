import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  AHU_COURSE_EXTRACTION_SCRIPT,
  AHU_CREDENTIAL_CAPTURE_SCRIPT,
  buildAhuAutoLoginScript,
  parseAhuCoursePayloadDetailed,
} from '@/lib/importers/ahu-importer';
import {
  clearAhuCredentials,
  loadAhuCredentials,
  saveAhuCredentials,
  type AhuCredentials,
} from '@/lib/importers/ahu-credentials';
import type { ScheduledCourse } from '@/types/timetable';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

interface AhuImportModalProps {
  visible: boolean;
  mode: 'import' | 'refresh';
  onCancel: () => void;
  onImported: (courses: ScheduledCourse[], semesterName: string, droppedActivities: number) => void;
  onCredentialsSaved?: () => void;
  onCredentialsMissing?: () => void;
}

const AHU_LOGIN_URL = 'https://jw.ahu.edu.cn/student/sso/login';
const INITIAL_STATUS = '请在安徽大学官方页面完成登录';

function parsedUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isAllowedAhuUrl(url: string): boolean {
  const parsed = parsedUrl(url);
  return parsed?.protocol === 'https:' &&
    (parsed.hostname === 'jw.ahu.edu.cn' || parsed.hostname === 'one.ahu.edu.cn');
}

function isStudentHome(url: string): boolean {
  const parsed = parsedUrl(url);
  return parsed?.hostname === 'jw.ahu.edu.cn' && parsed.pathname.replace(/\/$/, '') === '/student/home';
}

function isCasPage(url: string): boolean {
  return parsedUrl(url)?.hostname === 'one.ahu.edu.cn';
}

export function AhuImportModal({
  visible,
  mode,
  onCancel,
  onImported,
  onCredentialsSaved,
  onCredentialsMissing,
}: AhuImportModalProps) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const extractionStarted = useRef(false);
  const autoLoginStarted = useRef(false);
  const extractionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCredentials = useRef<AhuCredentials | null>(null);
  const [status, setStatus] = useState(mode === 'refresh' ? '正在读取本机保存的教务账号…' : INITIAL_STATUS);
  const [reading, setReading] = useState(mode === 'refresh');
  const [saveChoice, setSaveChoice] = useState<boolean | null>(mode === 'refresh' ? true : null);
  const [credentials, setCredentials] = useState<AhuCredentials | null>(null);

  const clearExtractionTimer = () => {
    if (extractionTimer.current) clearTimeout(extractionTimer.current);
    extractionTimer.current = null;
  };

  const startTimeout = (message: string) => {
    clearExtractionTimer();
    extractionTimer.current = setTimeout(() => {
      extractionStarted.current = false;
      autoLoginStarted.current = false;
      setReading(false);
      setStatus(message);
    }, 20000);
  };

  useEffect(() => {
    if (mode !== 'refresh') return;
    let active = true;
    void loadAhuCredentials().then((saved) => {
      if (!active) return;
      if (!saved) {
        setReading(false);
        setStatus('未找到已保存的教务账号，请重新登录导入并允许保存');
        onCredentialsMissing?.();
        return;
      }
      setCredentials(saved);
      setStatus('正在自动登录安徽大学教务系统…');
    });
    return () => {
      active = false;
    };
  }, [mode, onCredentialsMissing]);

  useEffect(() => {
    return () => {
      if (extractionTimer.current) clearTimeout(extractionTimer.current);
    };
  }, []);

  const readCourses = () => {
    extractionStarted.current = true;
    setReading(true);
    setStatus('登录成功，正在读取当前学期课表…');
    startTimeout('读取超时，请重试');
    webViewRef.current?.injectJavaScript(AHU_COURSE_EXTRACTION_SCRIPT);
  };

  const finishImport = async (
    courses: ScheduledCourse[],
    semesterName: string,
    droppedActivities: number,
  ) => {
    if (mode === 'import' && saveChoice) {
      if (!pendingCredentials.current) {
        extractionStarted.current = false;
        setReading(false);
        setStatus('未捕获到登录账号，请重新填写账号密码后再试；课表尚未提交');
        return;
      }
      try {
        await saveAhuCredentials(pendingCredentials.current);
        const saved = await loadAhuCredentials();
        if (!saved || saved.username !== pendingCredentials.current.username || saved.password !== pendingCredentials.current.password) {
          throw new Error('账号安全保存校验失败');
        }
        onCredentialsSaved?.();
        pendingCredentials.current = null;
      } catch {
        extractionStarted.current = false;
        setReading(false);
        setStatus('账号安全保存失败，课表尚未提交；请重试或选择仅本次使用');
        return;
      }
    }
    onImported(courses, semesterName, droppedActivities);
  };

  const webReady = mode === 'import' ? saveChoice !== null : credentials !== null;
  const privacyText = mode === 'refresh'
    ? '账号密码从系统加密存储读取，仅自动填写到安徽大学官方登录页。'
    : saveChoice
      ? '登录成功并读取课表后，账号密码将加密保存在本机，仅用于后续一键刷新。'
      : '账号密码仅提交给安徽大学官方页面，本次不会保存。';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={[styles.header, { borderBottomColor: theme.textSecondary + '33' }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭安徽大学教务导入"
              hitSlop={10}
              onPress={onCancel}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
            <View style={styles.titleWrap}>
              <ThemedText type="subtitle">{mode === 'refresh' ? '刷新安徽大学课表' : '安徽大学教务导入'}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.subtitle} numberOfLines={1}>
                {status}
              </ThemedText>
            </View>
            {reading ? <ActivityIndicator color="#208AEF" /> : <View style={styles.headerSpacer} />}
          </View>

          {mode === 'import' && saveChoice === null ? (
            <View style={styles.consentWrap}>
              <View style={[styles.consentCard, { backgroundColor: theme.backgroundSelected + '14', borderColor: theme.textSecondary + '33' }]}>
                <Ionicons name="lock-closed-outline" size={28} color="#208AEF" />
                <ThemedText type="subtitle">允许保存教务账号？</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.consentText}>
                  允许后，用户名和密码通过系统 SecureStore 加密保存在本机，仅用于后续“刷新课表”自动登录。卸载应用会清除数据。
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setSaveChoice(true);
                    setStatus(INITIAL_STATUS);
                  }}
                  style={[styles.consentButton, { backgroundColor: '#208AEF' }]}
                >
                  <ThemedText style={styles.primaryButtonText}>允许保存并继续</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void clearAhuCredentials()
                      .then(() => {
                        onCredentialsMissing?.();
                        setSaveChoice(false);
                        setStatus(INITIAL_STATUS);
                      })
                      .catch(() => setStatus('无法清除本机旧凭据，请重试。'));
                  }}
                  style={[styles.consentButton, { borderColor: theme.textSecondary + '55', borderWidth: 1 }]}
                >
                  <ThemedText>仅本次使用</ThemedText>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.privacy, { backgroundColor: theme.backgroundSelected + '14' }]}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#208AEF" />
                <ThemedText themeColor="textSecondary" style={styles.privacyText}>
                  {privacyText}
                </ThemedText>
              </View>

              {webReady ? (
                <WebView
                  ref={webViewRef}
                  source={{ uri: AHU_LOGIN_URL }}
                  originWhitelist={['https://jw.ahu.edu.cn', 'https://one.ahu.edu.cn']}
                  incognito
                  javaScriptEnabled
                  domStorageEnabled
                  thirdPartyCookiesEnabled={false}
                  mixedContentMode="never"
                  onShouldStartLoadWithRequest={(request) => {
                    const allowed = isAllowedAhuUrl(request.url);
                    if (!allowed) setStatus('已阻止跳转到非安徽大学网站');
                    return allowed;
                  }}
                  onLoadStart={({ nativeEvent }) => {
                    if (!isStudentHome(nativeEvent.url)) extractionStarted.current = false;
                  }}
                  onLoadEnd={({ nativeEvent }) => {
                    if (isStudentHome(nativeEvent.url) && !extractionStarted.current) {
                      clearExtractionTimer();
                      readCourses();
                      return;
                    }
                    if (!isCasPage(nativeEvent.url)) return;
                    if (mode === 'import' && saveChoice) {
                      webViewRef.current?.injectJavaScript(AHU_CREDENTIAL_CAPTURE_SCRIPT);
                    } else if (mode === 'refresh' && credentials && !autoLoginStarted.current) {
                      autoLoginStarted.current = true;
                      setReading(true);
                      setStatus('正在自动登录安徽大学教务系统…');
                      startTimeout('自动登录超时，请重新登录导入以更新账号密码');
                      webViewRef.current?.injectJavaScript(buildAhuAutoLoginScript(credentials));
                    }
                  }}
                  onMessage={({ nativeEvent }) => {
                    try {
                      const message = JSON.parse(nativeEvent.data) as {
                        type?: string;
                        username?: string;
                        password?: string;
                        semesterName?: string;
                        payload?: unknown;
                        message?: string;
                      };
                      if (message.type === 'ahu-credentials') {
                        if (!isCasPage(nativeEvent.url) || mode !== 'import' || !saveChoice) return;
                        if (message.username && message.password) {
                          pendingCredentials.current = {
                            username: message.username,
                            password: message.password,
                          };
                        }
                        return;
                      }
                      if (message.type === 'ahu-auto-login-error') {
                        if (!isCasPage(nativeEvent.url) || mode !== 'refresh') return;
                        clearExtractionTimer();
                        setReading(false);
                        setStatus(message.message || '自动登录失败，请重新登录导入');
                        return;
                      }
                      if (message.type !== 'ahu-course-error' && message.type !== 'ahu-course-data') return;
                      // The injected script runs in the current WebView document, but
                      // Android WebView may report the response/frame URL here instead
                      // of the top-level /student/home URL. Trust only messages from
                      // an extraction that this component started on the trusted home.
                      if (!extractionStarted.current) return;
                      if (message.type === 'ahu-course-error') {
                        clearExtractionTimer();
                        extractionStarted.current = false;
                        setReading(false);
                        setStatus(message.message || '读取课表失败，请重试');
                        return;
                      }
                      clearExtractionTimer();
                      const parsed = parseAhuCoursePayloadDetailed(message.payload);
                      if (parsed.courses.length === 0) {
                        extractionStarted.current = false;
                        setReading(false);
                        setStatus('当前学期未读取到课程，请确认教务系统中已有课表');
                        return;
                      }
                      setReading(false);
                      void finishImport(
                        parsed.courses,
                        message.semesterName || '当前学期',
                        parsed.droppedActivities,
                      );
                    } catch {
                      clearExtractionTimer();
                      extractionStarted.current = false;
                      setReading(false);
                      setStatus('教务系统返回数据无法解析，请稍后重试');
                    }
                  }}
                  onError={() => {
                    clearExtractionTimer();
                    extractionStarted.current = false;
                    setReading(false);
                    setStatus('页面加载失败，请检查网络后重试');
                  }}
                  style={styles.webView}
                />
              ) : (
                <View style={styles.loadingWrap}><ActivityIndicator color="#208AEF" /></View>
              )}
              {(!reading && (status.includes('失败') || status.includes('超时'))) ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    extractionStarted.current = false;
                    autoLoginStarted.current = false;
                    setStatus(mode === 'refresh' ? '正在重新登录…' : INITIAL_STATUS);
                    webViewRef.current?.reload();
                  }}
                  style={[styles.retryButton, { backgroundColor: '#208AEF' }]}
                >
                  <ThemedText style={styles.primaryButtonText}>重新加载</ThemedText>
                </Pressable>
              ) : null}
            </>
          )}
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    minHeight: 58,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1 },
  subtitle: { fontSize: 12, marginTop: 2 },
  headerSpacer: { width: 20 },
  privacy: {
    margin: Spacing.two,
    marginBottom: 0,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  privacyText: { flex: 1, fontSize: 12, lineHeight: 18 },
  consentWrap: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  consentCard: { padding: Spacing.four, borderRadius: Spacing.three, borderWidth: 1, gap: Spacing.three, alignItems: 'center' },
  consentText: { textAlign: 'center', lineHeight: 21 },
  consentButton: { width: '100%', padding: Spacing.three, borderRadius: Spacing.two, alignItems: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  webView: { flex: 1, marginTop: Spacing.two },
  retryButton: { margin: Spacing.two, padding: Spacing.two, borderRadius: Spacing.two, alignItems: 'center' },
});
