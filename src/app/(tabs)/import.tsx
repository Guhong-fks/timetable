import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { parseTimetableFile } from '@/lib/importers/timetable-importer';
import { useTimetable } from '@/state/timetable-context';

export default function ImportScreen() {
  const input = useRef<HTMLInputElement>(null);
  const { replaceCourses, clearCourses, courses, importedFileName } = useTimetable();
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  async function choose(file?: { name: string; size?: number; arrayBuffer: () => Promise<ArrayBuffer> } | { name: string; uri: string }) {
    if (!file) return;
    setLoading(true);
    setStatus('');
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">导入课表</ThemedText>
          <ThemedText themeColor="textSecondary">选择你的 Word 课表文件 (.docx)。</ThemedText>
          <Pressable
            onPress={() => Platform.OS === 'web' ? input.current?.click() : void chooseNativeFile()}
            style={styles.button}
          >
            <ThemedText style={styles.buttonText}>{loading ? '正在解析...' : '选择 .docx 文件'}</ThemedText>
          </Pressable>
          {Platform.OS === 'web' && <input
              ref={input}
              type="file"
              accept=".docx"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void choose({ name: file.name, size: file.size, arrayBuffer: () => file.arrayBuffer() });
              }}
            />}
          {status && <ThemedView type="backgroundElement" style={styles.status}><ThemedText>{status}</ThemedText></ThemedView>}
          {importedFileName && <ThemedText themeColor="textSecondary">当前文件：{importedFileName}</ThemedText>}
          <ThemedText type="subtitle">说明</ThemedText>
          <ThemedText themeColor="textSecondary">课程单元格需要包含课程代码、周次和节次。同一格的多门课程会自动拆分，数据会保存在当前设备。</ThemedText>
          {!!courses.length && <Pressable onPress={clearCourses} style={styles.clear}><ThemedText themeColor="textSecondary">清空当前课表</ThemedText></Pressable>}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  content: { padding: Spacing.four, gap: Spacing.three },
  button: { padding: Spacing.three, backgroundColor: '#153B50', borderRadius: Spacing.two, alignItems: 'center' },
  buttonText: { color: '#FFF', fontWeight: '700' },
  status: { padding: Spacing.three, borderRadius: Spacing.two },
  clear: { padding: Spacing.two, borderWidth: 1, borderColor: '#D8DADF', alignItems: 'center', borderRadius: Spacing.two }
});