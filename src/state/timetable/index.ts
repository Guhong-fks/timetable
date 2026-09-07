/**
 * Public surface of the timetable state module. The legacy import path
 * `@/state/timetable-context` re-exports from here so call sites can
 * migrate gradually without breakage.
 */
export { TimetableProvider, useTimetable } from './TimetableContext';
export type { ImportReport } from './types';