import { createProfileId, normalizeCollection, profileFromSnapshot } from '@/state/timetable/profiles';
import type { TimetableSnapshot } from '@/state/timetable/types';

describe('timetable profile collection', () => {
  const legacy: TimetableSnapshot = { courses: [], semesterWeeks: 18, maxPeriods: 13 };

  it('wraps legacy data in one default profile', () => {
    expect(normalizeCollection({}, legacy)).toEqual({ profiles: [profileFromSnapshot(legacy)], activeProfileId: 'default' });
  });

  it('keeps a valid active profile and falls back when invalid', () => {
    const profiles = [{ ...profileFromSnapshot(legacy), id: 'a', name: 'A' }, { ...profileFromSnapshot(legacy), id: 'b', name: 'B' }];
    expect(normalizeCollection({ profiles, activeProfileId: 'b' }, legacy).activeProfileId).toBe('b');
    expect(normalizeCollection({ profiles, activeProfileId: 'missing' }, legacy).activeProfileId).toBe('a');
  });

  it('creates distinct ids', () => {
    const first = createProfileId();
    const second = createProfileId();
    expect(first).not.toBe(second);
  });
});
