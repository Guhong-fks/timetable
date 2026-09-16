import { createContext, PropsWithChildren, useCallback, useContext, useMemo, useState } from 'react';
import type { NotificationNavigationTarget } from '@/lib/notification-navigation';

interface DeepLinkContextValue {
  pendingDeepLink: NotificationNavigationTarget | null;
  setPendingDeepLink: (link: NotificationNavigationTarget | null) => void;
  clearPendingDeepLink: () => void;
}

const DeepLinkContext = createContext<DeepLinkContextValue | null>(null);

export function DeepLinkProvider({ children }: PropsWithChildren) {
  const [pendingDeepLink, setPendingDeepLink] = useState<NotificationNavigationTarget | null>(null);
  const clearPendingDeepLink = useCallback(() => setPendingDeepLink(null), []);
  const value = useMemo(
    () => ({ pendingDeepLink, setPendingDeepLink, clearPendingDeepLink }),
    [pendingDeepLink, clearPendingDeepLink],
  );

  return <DeepLinkContext.Provider value={value}>{children}</DeepLinkContext.Provider>;
}

export function useDeepLink(): DeepLinkContextValue {
  const ctx = useContext(DeepLinkContext);
  if (!ctx) throw new Error('useDeepLink must be used inside DeepLinkProvider');
  return ctx;
}
