import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RnSplash } from '@/components/RnSplash';
import { BackgroundProvider, useBackground } from '@/state/background-context';
import { DeepLinkProvider, useDeepLink } from '@/state/deep-link-context';
import { ThemeProvider } from '@/state/theme-context';
import { TimetableProvider, useTimetable } from '@/state/timetable';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// 显式接管启动图：先保持原生启动图（白底小图标），等 RN 首帧渲染出
// 自绘全屏启动页后再隐藏它，由 RnSplash 全屏大图接管到数据就绪。
SplashScreen.preventAutoHideAsync().catch(() => {
  // 非原生平台 / 启动图已被系统隐藏时忽略。
});

/** 兜底：storage 异常导致 hydrate 卡住时，启动页最长停留时长（ms）。 */
const SPLASH_MAX_MS = 3000;

/**
 * 系统 Splash 只负责 RN 加载前的瞬间；
 * RN 首帧后立刻隐藏系统 Splash，由 RnSplash（全屏大图）接管，
 * 等课表数据 hydrate 完成后淡出，露出真实课表。
 */
function SplashGate() {
  const { isHydrated } = useTimetable();
  const { splashImageUri } = useBackground();
  const [showRnSplash, setShowRnSplash] = useState(true);
  const [nativeHidden, setNativeHidden] = useState(false);

  // 大图真正解码完成后，再撤掉系统白屏，避免“系统白屏撤了、大图还没出来”的白缝。
  const handleReady = useCallback(() => {
    if (nativeHidden) return;
    setNativeHidden(true);
    SplashScreen.hideAsync().catch(() => {});
  }, [nativeHidden]);

  // 兜底：大图 onLoad 万一未触发，超时后也强制撤掉系统白屏。
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!nativeHidden) {
        setNativeHidden(true);
        SplashScreen.hideAsync().catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [nativeHidden]);

  // hydrate 完成 → 收起自绘启动页：直接用 !isHydrated 组合 visible，
  // 淡出动画交给 RnSplash 内部处理（不在 effect 中同步 setState，
  // 避免 React 19 级联渲染告警）。
  useEffect(() => {
    const timer = setTimeout(() => setShowRnSplash(false), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <RnSplash
      visible={showRnSplash && !isHydrated}
      onReady={handleReady}
      imageSource={splashImageUri ? { uri: splashImageUri } : undefined}
    />
  );
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
              <BackgroundProvider>
                <DeepLinkHandler />
                <SplashGate />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)" />
                </Stack>
              </BackgroundProvider>
            </DeepLinkProvider>
          </TimetableProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
