import { View, type ViewProps } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export function ThemedView({ style, type = 'default', ...props }: ViewProps & { type?: 'default' | 'backgroundElement' }) {
  let theme;
  try { theme = useTheme(); } catch { theme = null; }
  const bg = type === 'backgroundElement'
    ? (theme?.backgroundElement ?? '#F5F5F5')
    : (theme?.background ?? '#FFFFFF');
  return <View style={[{ backgroundColor: bg }, style]} {...props} />;
}
