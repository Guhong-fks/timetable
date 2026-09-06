import { Stack } from 'expo-router';
import { TimetableProvider } from '@/state/timetable-context';
import { ThemeProvider } from '@/state/theme-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <TimetableProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </TimetableProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}