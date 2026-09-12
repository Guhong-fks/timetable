/**
 * LeadMinutesModal 组件测试（P2：UI 组件此前零测试）。
 *
 * 环境：jest-expo preset + react-test-renderer。组件链上的原生依赖
 * （通知模块、AsyncStorage、主题 context）全部隔离：
 *   - expo-notifications：notifications.ts 顶层副作用（setNotificationHandler）
 *   - AsyncStorage：storage.ts 模块加载
 *   - theme-context：组件用 useTheme() 取色值，直接 mock 返回固定主题
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { LeadMinutesModal } from '@/components/LeadMinutesModal';
import { DEFAULT_LEAD_MINUTES, MAX_LEAD_MINUTES } from '@/lib/notifications';

// 组件测试使用 jest-expo preset 自带的 react-native mock，不在此重复 mock。
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidNotificationPriority: { HIGH: 'HIGH' },
  AndroidImportance: { HIGH: 'HIGH' },
  SchedulableTriggerInputTypes: { DATE: 'DATE' },
}));

jest.mock('@/state/theme-context', () => ({
  useAppTheme: () => ({
    mode: 'light',
    theme: {
      background: '#ffffff',
      backgroundElement: '#f2f3f5',
      backgroundSelected: '#4A90D9',
      text: '#1a2333',
      textSecondary: '#666666',
    },
  }),
}));

function renderModal(props: Partial<React.ComponentProps<typeof LeadMinutesModal>> = {}) {
  const onSave = jest.fn();
  const onClose = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <LeadMinutesModal currentMinutes={15} onSave={onSave} onClose={onClose} {...props} />,
    );
  });
  return { renderer, onSave, onClose };
}

/** 找到含指定文本的可点按节点（jest-expo 下 Pressable byType 匹配不稳定，改用 onPress 属性查找） */
function findClickableByText(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const clickables = renderer.root.findAll((n) => typeof n.props.onPress === 'function');
  const found = clickables.find((node) => {
    const texts = node.findAll((n) => typeof n.props.children === 'string');
    return texts.some((t) => t.props.children === label);
  });
  expect(found).toBeDefined();
  return found!;
}

/** 渲染树中的全部可见文本（递归展开 JSX 数组插值，如 "1-{180}"） */
function visibleTexts(renderer: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const flatten = (node: { props?: { children?: unknown }; children?: readonly unknown[] } | null | undefined) => {
    if (!node) return;
    const c = node.props?.children;
    if (typeof c === 'string' || typeof c === 'number') {
      out.push(String(c));
    } else if (Array.isArray(c)) {
      for (const item of c) {
        if (item && typeof item === 'object') flatten(item as never);
        else if (item != null) out.push(String(item));
      }
    } else if (c && typeof c === 'object') {
      flatten(c as never);
    }
    (node.children as readonly unknown[] | undefined)?.forEach((child) => flatten(child as never));
  };
  flatten(renderer.root as never);
  return out.join(' ');
}

describe('LeadMinutesModal', () => {
  it('渲染标题、提示与当前值', () => {
    const { renderer } = renderModal({ currentMinutes: 30 });
    expect(visibleTexts(renderer)).toContain('自定义提前提醒时间');
    expect(visibleTexts(renderer)).toContain(`${MAX_LEAD_MINUTES}`);
    const input = renderer.root.findByType(TextInput);
    expect(input.props.value).toBe('30');
  });

  it('输入合法分钟数保存 → onSave(分钟数)', () => {
    const { renderer, onSave } = renderModal({ currentMinutes: 15 });
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('45'));
    act(() => findClickableByText(renderer, '保存').props.onPress());
    expect(onSave).toHaveBeenCalledWith(45);
  });

  it('输入 0 或非数字 → 回退默认并保存', () => {
    const { renderer, onSave } = renderModal({ currentMinutes: 15 });
    const input = renderer.root.findByType(TextInput);
    // 组件 onChangeText 已剥离非数字；模拟直接输入 0
    act(() => input.props.onChangeText('0'));
    act(() => findClickableByText(renderer, '保存').props.onPress());
    expect(onSave).toHaveBeenCalledWith(DEFAULT_LEAD_MINUTES);
  });

  it('超过上限（200）→ 封顶到 MAX_LEAD_MINUTES', () => {
    const { renderer, onSave } = renderModal({ currentMinutes: 15 });
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('200'));
    act(() => findClickableByText(renderer, '保存').props.onPress());
    expect(onSave).toHaveBeenCalledWith(MAX_LEAD_MINUTES);
  });

  it('点取消 → onClose', () => {
    const { renderer, onClose } = renderModal();
    act(() => findClickableByText(renderer, '取消').props.onPress());
    expect(onClose).toHaveBeenCalled();
  });
});
