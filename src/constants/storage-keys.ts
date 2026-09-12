/**
 * Shared AsyncStorage keys.
 *
 * These were previously duplicated in index.tsx / settings.tsx /
 * widget-data.ts / TimetableContext.tsx; a single source of truth keeps
 * the storage contract consistent across every consumer.
 */
export const PERIOD_TIMES_KEY = 'course-table-app.period-times.v2';
export const PERIOD_DURATIONS_KEY = 'course-table-app.period-durations.v1';
export const NOTIFICATION_ENABLED_KEY = 'course-table-app.notifications.enabled.v1';
export const NOTIFICATION_LEAD_MINUTES_KEY = 'course-table-app.notifications.lead-minutes.v1';
