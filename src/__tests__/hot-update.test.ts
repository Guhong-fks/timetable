/**
 * hot-update.ts 行为测试：expo-updates 的启用判定、检查/应用降级路径。
 * 通过 jest.mock 隔离 expo-updates 原生桥，用 getter 控制 isEnabled/channel/runtimeVersion。
 */
import {
  applyHotUpdate,
  checkHotUpdate,
  getRuntimeVersion,
  getUpdateChannel,
  isHotUpdateSupported,
} from '@/lib/hot-update';

// getter 延迟到测试运行时才取值，let 初始化早于任何访问，无 TDZ 问题。
let mockIsEnabled = true;
let mockChannel: string | null = 'production';
let mockRuntimeVersion: string | null = '1.0.5';

jest.mock('expo-updates', () => ({
  get isEnabled() {
    return mockIsEnabled;
  },
  get channel() {
    return mockChannel;
  },
  get runtimeVersion() {
    return mockRuntimeVersion;
  },
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Updates = require('expo-updates');

/** 测试内控制 __DEV__（jest-expo 默认 true，避免 supported 路径被短路）。 */
function setDev(value: boolean) {
  Object.defineProperty(globalThis, '__DEV__', { value, configurable: true });
}

beforeEach(() => {
  mockIsEnabled = true;
  mockChannel = 'production';
  mockRuntimeVersion = '1.0.5';
  setDev(false);
  Updates.checkForUpdateAsync.mockReset();
  Updates.fetchUpdateAsync.mockReset();
  Updates.reloadAsync.mockReset();
});

describe('isHotUpdateSupported', () => {
  it('release 构建（非 __DEV__）且已启用时返回 true', () => {
    expect(isHotUpdateSupported()).toBe(true);
  });
  it('expo-updates 未启用时返回 false', () => {
    mockIsEnabled = false;
    expect(isHotUpdateSupported()).toBe(false);
  });
  it('开发模式（__DEV__）返回 false', () => {
    setDev(true);
    expect(isHotUpdateSupported()).toBe(false);
  });
});

describe('checkHotUpdate', () => {
  it('不支持热更新时返回 supported=false 且不发起网络检查', async () => {
    mockIsEnabled = false;
    const status = await checkHotUpdate();
    expect(status).toEqual({ supported: false, available: false });
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('有可用更新时返回 available=true', async () => {
    Updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    const status = await checkHotUpdate();
    expect(status).toEqual({ supported: true, available: true });
  });

  it('无更新时返回 available=false', async () => {
    Updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
    const status = await checkHotUpdate();
    expect(status).toEqual({ supported: true, available: false });
  });

  it('检查抛异常时降级为无更新，不向上抛出', async () => {
    Updates.checkForUpdateAsync.mockRejectedValue(new Error('network down'));
    const status = await checkHotUpdate();
    expect(status).toEqual({ supported: true, available: false });
  });
});

describe('applyHotUpdate', () => {
  it('有新更新时下载并重启，返回 true', async () => {
    Updates.fetchUpdateAsync.mockResolvedValue({ isNew: true });
    const applied = await applyHotUpdate();
    expect(applied).toBe(true);
    expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('无可应用更新时返回 false 且不重启', async () => {
    Updates.fetchUpdateAsync.mockResolvedValue({ isNew: false });
    const applied = await applyHotUpdate();
    expect(applied).toBe(false);
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('下载失败时异常上抛，由 UI 提示', async () => {
    Updates.fetchUpdateAsync.mockRejectedValue(new Error('download failed'));
    await expect(applyHotUpdate()).rejects.toThrow('download failed');
  });
});

describe('getUpdateChannel / getRuntimeVersion', () => {
  it('透传 expo-updates 的 channel 与 runtimeVersion', () => {
    expect(getUpdateChannel()).toBe('production');
    expect(getRuntimeVersion()).toBe('1.0.5');
    mockChannel = null;
    mockRuntimeVersion = null;
    expect(getUpdateChannel()).toBeNull();
    expect(getRuntimeVersion()).toBeNull();
  });
});
