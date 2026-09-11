import { createContext, PropsWithChildren, useContext, useState } from 'react';
import { ScheduledCourse } from '@/types/timetable';

interface PendingDeepLink {
  courseId: string;
  week: number;
  course?: ScheduledCourse;
}

interface DeepLinkContextValue {
  pendingDeepLink: PendingDeepLink | null;
  setPendingDeepLink: (link: PendingDeepLink | null) => void;
  consumePendingDeepLink: () => PendingDeepLink | null;
}

const DeepLinkContext = createContext<DeepLinkContextValue | null>(null);

export function DeepLinkProvider({ children }: PropsWithChildren) {
  const [pendingDeepLink, setPendingDeepLink] = useState<PendingDeepLink | null>(null);

  const consumePendingDeepLink = () => {
    const link = pendingDeepLink;
    setPendingDeepLink(null);
    return link;
  };

  return (
    <DeepLinkContext.Provider value={{ pendingDeepLink, setPendingDeepLink, consumePendingDeepLink }}>
      {children}
    </DeepLinkContext.Provider>
  );
}

export function useDeepLink(): DeepLinkContextValue {
  const ctx = useContext(DeepLinkContext);
  if (!ctx) throw new Error('useDeepLink must be used inside DeepLinkProvider');
  return ctx;
}