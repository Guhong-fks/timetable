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

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto';
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('auto');
  const [hydrated, setHydrated] = useState(false);

  // Load saved preference
  useEffect(() => {
    void (async () => {
      try {
        const saved = await getStoredValue(THEME_KEY);
        if (isThemeMode(saved)) setModeState(saved);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Save preference
  useEffect(() => {
    if (hydrated) void setStoredValue(THEME_KEY, mode);
  }, [mode, hydrated]);

  const effectiveScheme = mode === 'auto' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const theme = Colors[effectiveScheme];

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
  };

  if (!hydrated) return null;

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