/**
 * Back-compat shim. The implementation lives in `./timetable/*` after
 * the split; this file just re-exports so existing imports
 * (`@/state/timetable-context`) keep working without touching call sites.
 *
 * New code should import from `@/state/timetable` directly.
 */
export { TimetableProvider, useTimetable } from './timetable/TimetableContext';
export type { ImportReport } from './timetable/types';