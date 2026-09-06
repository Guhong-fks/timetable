import { useAppTheme } from '@/state/theme-context';

export function useTheme() {
  const { theme } = useAppTheme();
  return theme;
}