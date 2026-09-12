import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect } from 'react';
import { TimetableProvider, useTimetable } from '@/state/timetable';
import { ThemeProvider } from '@/state/theme-context';
import { DeepLinkProvider, useDeepLink } from '@/state/deep-link-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// 显式接管启动图：保持原生启动图直到课表数据 hydrate 完成再隐藏，
// 避免“启动图 → 正在读取课表… → 真实课表”的三段闪变。
SplashScreen.preventAutoHideAsync().catch(() => {
  // 非原生平台 / 启动图已被系统隐藏时忽略。
});

/** 兜底：storage 异常导致 hydrate 卡住时，启动图最长停留时长（ms）。 */
const SPLASH_MAX_MS = 3000;

/**
 * 在 hydration 完成后隐藏启动图。双 rAF 让 React 先提交真实课表首帧，
 * 启动图淡出时用户看到的就是完整课表；另设 3s 兜底超时防止白屏。
 */
function SplashGate() {
  const { isHydrated } = useTimetable();

  useEffect(() => {
    if (!isHydrated) return;
    // Three frames: (1) React commits the hydrated first paint, (2) onLayout
    // measure + recomputeBounds render lands, (3) hide — the user's first
    // glimpse is a layout-stable grid, never the pre-measure frame.
    let raf3 = 0;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        raf3 = requestAnimationFrame(() => {
          SplashScreen.hideAsync().catch(() => {});
        });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
    };
  }, [isHydrated]);

  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  return null;
}

function DeepLinkHandler() {
  const { courses } = useTimetable();
  const { setPendingDeepLink } = useDeepLink();

  // useCallback + declared BEFORE the effect: keeps the listener effect's
  // dependency referentially stable (rebuilds only when courses or the
  // setter change — same resubscription timing as the previous [courses,
  // setPendingDeepLink] deps) and satisfies the react-hooks/immutability
  // declaration-order rule.
  const handleDeepLink = useCallback((url: string) => {
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
  }, [courses, setPendingDeepLink]);

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
  }, [handleDeepLink]);

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
              <SplashGate />
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
