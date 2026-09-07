import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { parseTimetableFile, isNativeBridgeAvailable } from '@/lib/importers/timetable-importer';
import { useTimetable } from '@/state/timetable-context';

export default function ImportScreen() {
  const input = useRef<HTMLInputElement | null>(null);
  const { replaceCourses, clearCourses, courses, importedFileName, semesterStartDate, setSemesterStartDate } = useTimetable();
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [startDateInput, setStartDateInput] = useState(semesterStartDate ?? '');
  const [lastImportTime, setLastImportTime] = useState(0);
  // Probed once on mount. False on Expo Go (the Nitro native binary is not
  // bundled); true on a Development Build / EAS Build. We use this to
  // surface a clear, non-blocking warning instead of letting the user pick
  // a file and only then find out the parser can't run.
  const [nativeAvailable, setNativeAvailable] = useState<boolean | null>(null);
  // ...rest of hooks
  const IMPORT_COOLDOWN_MS = 3000;

  // Detect once on mount. Safe: `isNativeBridgeAvailable` does a `require`
  // inside a try/catch and never throws across the boundary.
  useEffect(() => {
    setNativeAvailable(isNativeBridgeAvailable());
  }, []);

  async function choose(file?: { name: string; size?: number; type?: string; arrayBuffer: () => Promise<ArrayBuffer> } | { name: string; size?: number; type?: string; uri: string }) {
    if (!file) return;
    const now = Date.now();
    if (now - lastImportTime < IMPORT_COOLDOWN_MS && !loading) {
      setStatus(`请等待 ${Math.ceil((IMPORT_COOLDOWN_MS - (now - lastImportTime)) / 1000)} 秒后再试`);
      return;
    }
    setLoading(true);
    setStatus('');
    setLastImportTime(now);
    try {
      const result = await parseTimetableFile(file);
      replaceCourses(result.courses, file.name, undefined, result.report);
      if (result.report.warnings.length > 0) {
        setStatus(`已导入 ${result.courses.length} 门课程（${result.report.warnings.length} 条警告，请查看课表底部详情）`);
      } else {
        setStatus(`已导入 ${result.courses.length} 门课程。`);
      }
    } catch (error) {
      setStatus(humanizeImportError(error));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Translate any thrown value into a Chinese status string. The parser
   * already emits Chinese messages for known failures; this function only
   * catches the long-tail cases (storage exceptions, JSON parse errors,
   * native bridge failures, unknown throws).
   */
  function humanizeImportError(error: unknown): string {
    if (error instanceof Error) {
      // Known-localised messages from the parser — pass through verbatim
      // so we don't double-translate. (We test for Chinese characters to
      // avoid showing English tech errors like "Unexpected token …".)
      if (/[一-龥]/.test(error.message)) return error.message;
      // Bare technical message — wrap it with a "what to do" hint.
      console.warn('[import] underlying error:', error);
      return '导入失败：文件可能已损坏或不是有效的课表模板';
    }
    return '导入失败：未知错误';
  }

  async function chooseNativeFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled) {
      const file = result.assets[0];
      // DocumentPicker exposes file size under `.size` on most platforms; pass
      // it through so the size check in `validateFile` actually runs.
      await choose({ name: file.name, size: file.size, type: file.mimeType, uri: file.uri });
    }
  }

  const handleDateChange = (text: string) => {
    setStartDateInput(text);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      setSemesterStartDate(text);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">导入课表</ThemedText>
          <ThemedText themeColor="textSecondary">选择你的 Word 课表文件 (.docx)。</ThemedText>

          {/* Surface the missing-native-module case early. On Expo Go the
              Nitro binary isn't bundled, so picking a file would only fail
              with a tech error inside the parser — much friendlier to show
              a single banner before the user goes through the picker. */}
          {nativeAvailable === false && (
            <ThemedView
              type="backgroundElement"
              style={[styles.section, styles.nativeMissingBanner]}
            >
              <ThemedText type="subtitle">
                              当前环境不支持本地解析
                            </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.hint}>
                Expo Go 不含原生模块，无法解析 .docx。请使用 Development Build 或 EAS
                Build 后再导入文件。课表底部其他设置仍可正常使用。
              </ThemedText>
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="subtitle">学期开始日期</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              设置第一周周一的日期，用于在课表中显示具体上课日期
            </ThemedText>
            <TextInput
              value={startDateInput}
              onChangeText={handleDateChange}
              placeholder="YYYY-MM-DD (例如 2025-02-17)"
              placeholderTextColor="#999"
              keyboardType="numeric"
              style={styles.dateInput}
            />
            {semesterStartDate && (
              <ThemedText themeColor="textSecondary" style={styles.currentDate}>
                当前设置：{semesterStartDate} (第1周周一)
              </ThemedText>
            )}
          </ThemedView>

          <ThemedText type="subtitle">选择课表文件</ThemedText>
          <Pressable
            onPress={() => Platform.OS === 'web' ? input.current?.click() : void chooseNativeFile()}
            style={styles.button}
          >
            <Ionicons name="cloud-upload-outline" size={20} color="#FFF" style={styles.buttonIcon} />
            <ThemedText style={styles.buttonText}>{loading ? '正在解析...' : '选择 .docx 文件'}</ThemedText>
          </Pressable>
          {Platform.OS === 'web' && (
            <input
              ref={input}
              type="file"
              accept=".docx"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void choose({ name: file.name, size: file.size, type: file.type, arrayBuffer: () => file.arrayBuffer() });
              }}
            />
          )}
          {status && <ThemedView type="backgroundElement" style={styles.status}><ThemedText>{status}</ThemedText></ThemedView>}
          {importedFileName && <ThemedText themeColor="textSecondary">当前文件：{importedFileName}</ThemedText>}
          <ThemedText type="subtitle">说明</ThemedText>
          <ThemedText themeColor="textSecondary">课程单元格需要包含课程代码、周次和节次。同一格的多门课程会自动拆分，数据会保存在当前设备。</ThemedText>
          {!!courses.length && <Pressable onPress={clearCourses} style={styles.clear}><Ionicons name="trash-outline" size={16} color="#666" style={styles.clearIcon} /><ThemedText themeColor="textSecondary">清空当前课表</ThemedText></Pressable>}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  content: { padding: Spacing.four, gap: Spacing.three },
  section: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two, marginBottom: Spacing.two },
  nativeMissingBanner: { borderWidth: 1, borderColor: '#D6913A' },
  hint: { fontSize: 12, marginBottom: Spacing.one, opacity: 0.7 },
  dateInput: {
    borderWidth: 1,
    borderColor: '#D8DADF',
    borderRadius: Spacing.two,
    padding: Spacing.two,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#FFF',
  },
  currentDate: { marginTop: Spacing.one, fontSize: 13 },
  button: { padding: Spacing.three, backgroundColor: '#153B50', borderRadius: Spacing.two, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: Spacing.one },
  buttonIcon: { marginRight: Spacing.one },
  buttonText: { color: '#FFF', fontWeight: '700' },
  status: { padding: Spacing.three, borderRadius: Spacing.two },
  clear: { padding: Spacing.two, borderWidth: 1, borderColor: '#D8DADF', alignItems: 'center', borderRadius: Spacing.two, flexDirection: 'row', gap: Spacing.one },
  clearIcon: {}
});