import React, { useState, ErrorInfo, ReactNode } from 'react';
import { StyleSheet, Button, View, Text } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

// Inner component that uses hooks (called unconditionally)
function ErrorFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>出错了</Text>
      <Text style={[styles.message, { color: theme.textSecondary }]}>
        {error?.message || '未知错误'}
      </Text>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>
        请尝试重新启动应用
      </Text>
      <Button title="重新加载" onPress={onReset} />
    </View>
  );
}

// Helper class component for actual error catching
class ErrorBoundaryWrapper extends React.Component<
  { children: ReactNode; onError: (error: Error, errorInfo: ErrorInfo) => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError(error, errorInfo);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function ErrorBoundary({ children, fallback }: Props) {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handleError = (error: Error, errorInfo: ErrorInfo) => {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    setError(error);
    setHasError(true);
  };

  if (hasError) {
    if (fallback) {
      return fallback;
    }
    return <ErrorFallback error={error} onReset={() => { setError(null); setHasError(false); }} />;
  }

  return (
    <ErrorBoundaryWrapper onError={handleError}>
      {children}
    </ErrorBoundaryWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 24, marginBottom: 16 },
  message: { fontSize: 16, marginBottom: 8, textAlign: 'center' },
  hint: { fontSize: 14, marginBottom: 24, textAlign: 'center' },
});

export default ErrorBoundary;