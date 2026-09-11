import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import { TimetableProvider, useTimetable } from '@/state/timetable';
import { ThemeProvider } from '@/state/theme-context';
import { DeepLinkProvider, useDeepLink } from '@/state/deep-link-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function DeepLinkHandler() {
  const { courses } = useTimetable();
  const { setPendingDeepLink } = useDeepLink();

  useEffect(() => {
    // Handle incoming deep links when app is already running
    const subscription = Linking.addEventListener('url', ({ url }: { url: string }) => {
      handleDeepLink(url);
    });

    // Handle initial URL if app was launched via deep link
    Linking.getInitialURL().then((url: string | null) => {
      if (url) handleDeepLink(url);
    });

    return () => subscription.remove();
  }, [courses, setPendingDeepLink]);

  const handleDeepLink = (url: string) => {
    // coursetableapp://course/<courseId>?week=<week>
    const match = url.match(/coursetableapp:\/\/course\/([^?]+)\?week=(\d+)/);
    if (match) {
      const [, courseId, weekStr] = match;
      const week = parseInt(weekStr, 10);
      const course = courses.find(c => c.id === courseId);
      if (course) {
        setPendingDeepLink({ courseId, week, course });
      }
    }
  };

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ErrorBoundary>
          <TimetableProvider>
            <DeepLinkProvider>
              <DeepLinkHandler />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
              </Stack>
            </DeepLinkProvider>
          </TimetableProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}