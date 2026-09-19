import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

export interface SchoolWebModalProps {
  visible: boolean;
  name: string;
  initialUrl: string;
  allowedHosts: string[];
  onClose: () => void;
  nextUrl?: string;
  nextLabel?: string;
}

function isAllowedUrl(url: string, allowedHosts: string[]): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function SchoolWebModal({
  visible,
  name,
  initialUrl,
  allowedHosts,
  onClose,
  nextUrl,
  nextLabel = '进入教务系统',
}: SchoolWebModalProps) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const [status, setStatus] = useState('请在官方页面完成登录');
  const [loading, setLoading] = useState(true);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={[styles.header, { borderBottomColor: theme.textSecondary + '33' }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`关闭${name}教务系统`}
              hitSlop={10}
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
            <View style={styles.titleWrap}>
              <ThemedText type="subtitle">{name}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.subtitle} numberOfLines={1}>
                {status}
              </ThemedText>
            </View>
            {nextUrl && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={nextLabel}
                onPress={() => {
                  webViewRef.current?.injectJavaScript(`window.location.href=${JSON.stringify(nextUrl)}; true;`);
                  setStatus(`正在打开${nextLabel}…`);
                }}
                style={[styles.nextButton, { backgroundColor: '#16A34A' }]}
              >
                <ThemedText style={styles.nextButtonText}>{nextLabel}</ThemedText>
              </Pressable>
            )}
            {loading ? <ActivityIndicator color="#208AEF" /> : <View style={styles.headerSpacer} />}
          </View>
          <WebView
            ref={webViewRef}
            source={{ uri: initialUrl }}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            mixedContentMode="never"
            onShouldStartLoadWithRequest={(request) => {
              const allowed = isAllowedUrl(request.url, allowedHosts);
              if (!allowed) setStatus('已阻止跳转到非该校官方域名');
              return allowed;
            }}
            onLoadStart={() => {
              setLoading(true);
              setStatus('正在加载官方页面…');
            }}
            onLoadEnd={({ nativeEvent }) => {
              setLoading(false);
              try {
                const hostname = new URL(nativeEvent.url).hostname;
                setStatus(nextUrl && (hostname === 'elib.cugb.edu.cn' || hostname === 'cas.cugb.edu.cn' || hostname === 'portals.cugb.edu.cn' || hostname === 'stu.cugb.edu.cn')
                  ? '统一认证完成后，点击右上角“进入教务系统”'
                  : '请在官方页面完成登录');
              } catch {
                setStatus('请在官方页面完成登录');
              }
            }}
            onError={() => {
              setLoading(false);
              setStatus('页面加载失败，请检查网络后重试');
            }}
            style={styles.webView}
          />
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
  nextButton: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.one },
  nextButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  webView: { flex: 1, marginTop: Spacing.two },
});
