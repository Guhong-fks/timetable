import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ImportPreview } from '@/components/ImportPreview';
import { WeekDay, TimeSlot, type ScheduledCourse } from '@/types/timetable';
import type { ReportWarning } from '@/lib/reporting/types';

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    background: '#ffffff',
    backgroundElement: '#f2f3f5',
    backgroundSelected: '#4A90D9',
    text: '#1a2333',
    textSecondary: '#666666',
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const COURSE: ScheduledCourse = {
  id: 'course-1',
  name: '高等数学',
  day: WeekDay.MONDAY,
  timeSlot: TimeSlot.ONE_TWO,
  startPeriod: 1,
  endPeriod: 2,
  duration: 2,
  location: { address: '逸夫楼101' },
  teacher: { name: '张老师' },
  weekList: [1, 2, 3],
};

function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findAllByType(Text)
    .map((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children ?? '');
    })
    .join(' ');
}

describe('ImportPreview diagnostics', () => {
  it('shows row-level parser warnings before the user commits the import', () => {
    const reportWarning: ReportWarning = {
      category: 'cell',
      severity: 'warning',
      message: 'CSV 第 3 行：星期必须是 1-7',
      at: 0,
    };
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <ImportPreview
          courses={[COURSE]}
          report={{ warnings: [reportWarning], suggestions: [] }}
          fileName="WakeUp.csv"
          onCommit={jest.fn()}
          onCancel={jest.fn()}
        />,
      );
    });

    expect(textContent(renderer)).toContain('CSV 第 3 行：星期必须是 1-7');
    expect(textContent(renderer)).toContain('解析报告含 1 条提示');
  });
});
