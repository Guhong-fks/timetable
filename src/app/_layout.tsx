import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { TimetableProvider } from '@/state/timetable';
import { ThemeProvider } from '@/state/theme-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ErrorBoundary>
          <TimetableProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
            </Stack>
          </TimetableProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}