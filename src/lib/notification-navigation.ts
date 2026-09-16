export interface NotificationNavigationTarget {
  courseId: string;
  week: number;
}

/** Convert notification data to in-app navigation state without a URL route. */
export function getNotificationNavigationTarget(data: unknown): NotificationNavigationTarget | null {
  if (!data || typeof data !== 'object') return null;

  const candidate = data as Record<string, unknown>;
  if (candidate.type !== 'class-reminder') return null;
  if (typeof candidate.courseId !== 'string' || candidate.courseId.length === 0) return null;

  const week = typeof candidate.week === 'number'
    ? candidate.week
    : typeof candidate.week === 'string'
      ? Number(candidate.week)
      : Number.NaN;
  if (!Number.isInteger(week) || week < 1) return null;

  return { courseId: candidate.courseId, week };
}
