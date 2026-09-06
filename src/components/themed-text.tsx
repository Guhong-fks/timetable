import { StyleSheet, Text, type TextProps } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

const DEFAULT_COLORS: Record<string, string> = {
  text: '#000000',
  background: '#FFFFFF',
  backgroundElement: '#F5F5F5',
  backgroundSelected: '#E0E0E0',
  textSecondary: '#666666',
};

export function ThemedText({
  style,
  type = 'default',
  themeColor = 'text',
  ellipsizeMode,
  ...props
}: TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle';
  themeColor?: 'text' | 'background' | 'backgroundElement' | 'backgroundSelected' | 'textSecondary';
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
}) {
  const theme = useTheme();
  const color = theme?.[themeColor] ?? DEFAULT_COLORS[themeColor] ?? '#000000';
  return (
    <Text
      style={[
        { color },
        type === 'title' && styles.title,
        type === 'subtitle' && styles.subtitle,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        style,
      ]}
      ellipsizeMode={ellipsizeMode}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 36, fontWeight: '700' },
  subtitle: { fontSize: 24, fontWeight: '700' },
  small: { fontSize: 12 },
  smallBold: { fontSize: 12, fontWeight: '700' },
});