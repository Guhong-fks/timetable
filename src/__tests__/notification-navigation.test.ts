import { getNotificationNavigationTarget } from '@/lib/notification-navigation';

describe('notification navigation', () => {
  it('extracts course navigation data without constructing a URL route', () => {
    expect(getNotificationNavigationTarget({
      type: 'class-reminder',
      courseId: 'Monday-1-2-高等数学',
      week: 1,
    })).toEqual({ courseId: 'Monday-1-2-高等数学', week: 1 });
  });

  it('rejects unrelated or malformed notification data', () => {
    expect(getNotificationNavigationTarget({ type: 'other', courseId: 'x', week: 1 })).toBeNull();
    expect(getNotificationNavigationTarget({ type: 'class-reminder', courseId: '', week: 1 })).toBeNull();
    expect(getNotificationNavigationTarget({ type: 'class-reminder', courseId: 'x', week: 0 })).toBeNull();
    expect(getNotificationNavigationTarget(null)).toBeNull();
  });
});
