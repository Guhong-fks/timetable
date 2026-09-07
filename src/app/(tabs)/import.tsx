import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { parseTimetableFile } from '@/lib/importers/timetable-importer';
import { useTimetable } from '@/state/timetable-context';

export default function ImportScreen() {
  const input = useRef<HTMLInputElement | null>(null);
  const { replaceCourses, clearCourses, courses, importedFileName, semesterStartDate, setSemesterStartDate } = useTimetable();
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [startDateInput, setStartDateInput] = useState(semesterStartDate ?? '');
  const [lastImportTime, setLastImportTime] = useState(0);
  const IMPORT_COOLDOWN_MS = 3000;

  async function choose(file?: { name: string; size?: number; arrayBuffer: () => Promise<ArrayBuffer> } | { name: string; uri: string }) {
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
      replaceCourses(result.courses, file.name);
      setStatus(`已导入 ${result.courses.length} 门课程。`);
    }
    catch (error) {
      setStatus(error instanceof Error ? error.message : '导入失败');
    }
    finally {
      setLoading(false);
    }
  }

  async function chooseNativeFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled) {
      const file = result.assets[0];
      await choose({ name: file.name, uri: file.uri });
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
                if (file) void choose({ name: file.name, size: file.size, arrayBuffer: () => file.arrayBuffer() });
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