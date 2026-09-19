import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CUGB_PAGE_READER_SCRIPT, parseCugbCourseRows } from '@/lib/importers/cugb-importer';
import type { ScheduledCourse } from '@/types/timetable';
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

interface CugbImportModalProps {
  visible: boolean;
  onClose: () => void;
  onImported: (courses: ScheduledCourse[], droppedActivities: number) => void;
}

const CUGB_STUDENT_URL = 'https://jwglxt.cugb.edu.cn/academic/common/security/affairLogin.jsp';
const CUGB_HOSTS = ['jwglxt.cugb.edu.cn', 'elib.cugb.edu.cn', 'cas.cugb.edu.cn', 'portals.cugb.edu.cn', 'stu.cugb.edu.cn', 'cugb.edu.cn'];

export function CugbImportModal({ visible, onClose, onImported }: CugbImportModalProps) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const [status, setStatus] = useState('请连接校园网，登录后自行打开课表页面');
  const [reading, setReading] = useState(false);

  const readCurrentPage = () => {
    setReading(true);
    setStatus('正在读取当前课表页面…');
    webViewRef.current?.injectJavaScript(CUGB_PAGE_READER_SCRIPT);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={[styles.header, { borderBottomColor: theme.textSecondary + '33' }]}>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
            <View style={styles.titleWrap}>
              <ThemedText type="subtitle">中国地质大学（北京）教务插件</ThemedText>
              <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.subtitle}>{status}</ThemedText>
            </View>
            {reading ? <ActivityIndicator color="#16A34A" /> : <View style={styles.headerSpacer} />}
          </View>
          <WebView
            ref={webViewRef}
            source={{ uri: CUGB_STUDENT_URL }}
            originWhitelist={CUGB_HOSTS.map((host) => `https://${host}`)}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            mixedContentMode="never"
            onShouldStartLoadWithRequest={({ url }) => {
              try {
                const parsed = new URL(url);
                const allowed = parsed.protocol === 'https:' && CUGB_HOSTS.includes(parsed.hostname);
                if (!allowed) setStatus('已阻止跳转到非中国地质大学官方域名');
                return allowed;
              } catch { return false; }
            }}
            onLoadEnd={() => {
              setReading(false);
              setStatus('请在页面内自行进入课表详情，再点击下方“读取当前页面”');
            }}
            onMessage={({ nativeEvent }) => {
              try {
                const message = JSON.parse(nativeEvent.data) as { type?: string; rows?: unknown; message?: string };
                if (message.type === 'cugb-page-error') {
                  setReading(false);
                  setStatus(message.message || '当前页面不是可识别的课表页面');
                  return;
                }
                if (message.type !== 'cugb-page-data') return;
                const parsed = parseCugbCourseRows(message.rows);
                setReading(false);
                if (!parsed.courses.length) {
                  setStatus(`已读取 ${parsed.totalRows} 行，但没有识别到有效课程，请打开课表详情表格后重试`);
                  return;
                }
                onImported(parsed.courses, parsed.droppedRows);
              } catch {
                setReading(false);
                setStatus('课表页面返回数据无法解析');
              }
            }}
            onError={() => {
              setReading(false);
              setStatus('页面加载失败，请确认已连接校园网或学校 VPN');
            }}
            style={styles.webView}
          />
          <Pressable onPress={readCurrentPage} disabled={reading} style={[styles.readButton, { backgroundColor: '#16A34A' }]}>
            <Ionicons name="extension-puzzle-outline" size={18} color="#FFFFFF" />
            <ThemedText style={styles.readButtonText}>{reading ? '正在读取…' : '读取当前页面'}</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, safe: { flex: 1 },
  header: { minHeight: 58, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  closeButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' }, titleWrap: { flex: 1 }, subtitle: { fontSize: 12, marginTop: 2 }, headerSpacer: { width: 20 },
  webView: { flex: 1, marginTop: Spacing.two }, readButton: { margin: Spacing.two, padding: Spacing.three, borderRadius: Spacing.two, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one }, readButtonText: { color: '#FFFFFF', fontWeight: '700' },
});
