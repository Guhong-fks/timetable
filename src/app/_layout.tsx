import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RnSplash } from '@/components/RnSplash';
import { getNotificationNavigationTarget } from '@/lib/notification-navigation';
import { BackgroundProvider, useBackground } from '@/state/background-context';
import { DeepLinkProvider, useDeepLink } from '@/state/deep-link-context';
import { ThemeProvider } from '@/state/theme-context';
import { TimetableProvider, useTimetable } from '@/state/timetable';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
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
  const [minElapsed, setMinElapsed] = useState(false);
  const [nativeHidden, setNativeHidden] = useState(false);

  // 启动页至少停留 1s，避免 release 包 hydrate 太快导致立绘一闪而过。
  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), 1000);
    return () => clearTimeout(timer);
  }, []);

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

  // hydrate 完成且已过最短停留时间 → 收起自绘启动页。
  // isHydrated / minElapsed 都是单调标志（false→true 后不再回退），因此
  // "是否已就绪"可以安全地在渲染期推导，无需在 effect 体内同步 setState
  // （react-hooks/set-state-in-effect）。
  const readyToHide = isHydrated && minElapsed;

  // 兜底超时：无论如何到点收起。
  useEffect(() => {
    const timer = setTimeout(() => setShowRnSplash(false), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <RnSplash
      visible={showRnSplash && !readyToHide}
      onReady={handleReady}
      imageSource={splashImageUri ? { uri: splashImageUri } : undefined}
    />
  );
}

function DeepLinkHandler() {
  const { setPendingDeepLink } = useDeepLink();
  const router = useRouter();

  const handleNotificationResponse = useCallback((response: Notifications.NotificationResponse) => {
    const target = getNotificationNavigationTarget(response.notification.request.content.data);
    if (!target) return;
    setPendingDeepLink(target);
    // Internal navigation avoids exposing the course ID as an Expo Router URL.
    router.replace('/');
  }, [router, setPendingDeepLink]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleNotificationResponse(response);
      void Notifications.clearLastNotificationResponseAsync();
    });

    return () => subscription.remove();
  }, [handleNotificationResponse]);

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
