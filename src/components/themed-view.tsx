import { View, type ViewProps } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export function ThemedView({ style, type = 'default', ...props }: ViewProps & { type?: 'default' | 'backgroundElement' }) {
  const theme = useTheme();
  const bg = type === 'backgroundElement'
    ? theme.backgroundElement
    : theme.background;
  return <View style={[{ backgroundColor: bg }, style]} {...props} />;
}