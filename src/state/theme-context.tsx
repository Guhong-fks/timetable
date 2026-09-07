import { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/theme';
import { getStoredValue, setStoredValue } from '@/lib/storage';

export type ThemeMode = 'light' | 'dark' | 'auto';

const THEME_KEY = 'course-table-app.theme';

type ColorScheme = {
  text: string;
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  textSecondary: string;
};

interface ThemeContextValue {
  theme: ColorScheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// 默认浅色主题，避免首屏白屏
const DEFAULT_THEME = Colors.light; // eslint-disable-line @typescript-eslint/no-unused-vars

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('auto');
  const [hydrated, setHydrated] = useState(false);

  // 立即计算有效主题，避免首帧白屏
  const effectiveScheme = mode === 'auto' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const theme = Colors[effectiveScheme];

  // Load saved preference
  useEffect(() => {
    void (async () => {
      try {
        const saved = await getStoredValue(THEME_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'auto') {
          setModeState(saved);
        }
      } catch {
        // 静默失败，保持默认
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Save preference
  useEffect(() => {
    // 只在 hydrated 后且 mode 真正改变时存储
    // 避免首次 hydrated 触发不必要的写入
  }, [mode]);

  // 单独的 effect 处理存储，避免循环依赖
  useEffect(() => {
    if (hydrated) {
      void setStoredValue(THEME_KEY, mode);
    }
  }, [mode, hydrated]);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
  };

  // 始终渲染 Provider，首屏用默认主题，hydrated 后自动切换
  return (
    <ThemeContext.Provider value={{ theme, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppTheme must be used inside ThemeProvider');
  return ctx;
}