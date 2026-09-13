/**
 * update-check.ts 纯函数测试：版本解析/比较、APK 附件挑选、Release 说明清理。
 * （checkForUpdates 依赖网络与 expo-constants，不在单测范围。）
 */
import {
  formatReleaseNotes,
  isVersionNewer,
  parseVersion,
  pickApkAsset,
} from '@/lib/update-check';

describe('parseVersion', () => {
  it('解析标准 x.y.z', () => {
    expect(parseVersion('1.0.4')).toEqual({ major: 1, minor: 0, patch: 4 });
  });
  it('兼容前导 v', () => {
    expect(parseVersion('v1.0.5')).toEqual({ major: 1, minor: 0, patch: 5 });
  });
  it('兼容 -beta / +build 后缀', () => {
    expect(parseVersion('1.0.4-beta.1')).toEqual({ major: 1, minor: 0, patch: 4 });
    expect(parseVersion('1.0.4+build5')).toEqual({ major: 1, minor: 0, patch: 4 });
  });
  it('无法解析时返回 null', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.0')).toBeNull();
    expect(parseVersion('1.0.4.5')).toBeNull();
  });
});

describe('isVersionNewer', () => {
  it('patch 升级判定为更新', () => {
    expect(isVersionNewer('1.0.5', '1.0.4')).toBe(true);
  });
  it('minor / major 升级判定为更新', () => {
    expect(isVersionNewer('1.1.0', '1.0.9')).toBe(true);
    expect(isVersionNewer('2.0.0', '1.9.9')).toBe(true);
  });
  it('相同版本不算更新', () => {
    expect(isVersionNewer('1.0.4', '1.0.4')).toBe(false);
  });
  it('旧版本不算更新', () => {
    expect(isVersionNewer('1.0.3', '1.0.4')).toBe(false);
  });
  it('兼容前导 v 的 Tag', () => {
    expect(isVersionNewer('v1.0.5', '1.0.4')).toBe(true);
  });
  it('任一版本无法解析时不判定为更新', () => {
    expect(isVersionNewer('latest', '1.0.4')).toBe(false);
    expect(isVersionNewer('1.0.5', '')).toBe(false);
  });
});

describe('pickApkAsset', () => {
  it('挑选第一个 .apk 附件（不区分大小写）', () => {
    const assets = [
      { name: 'app.aab', browser_download_url: 'https://example.com/app.aab' },
      { name: 'course-table-v1.0.5.APK', browser_download_url: 'https://example.com/app.apk' },
      { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' },
    ];
    expect(pickApkAsset(assets)).toEqual(assets[1]);
  });
  it('没有 .apk 附件时返回 null', () => {
    const assets = [
      { name: 'app.aab', browser_download_url: 'https://example.com/app.aab' },
      { name: 'screenshot.png', browser_download_url: 'https://example.com/s.png' },
    ];
    expect(pickApkAsset(assets)).toBeNull();
    expect(pickApkAsset([])).toBeNull();
  });
});

describe('formatReleaseNotes', () => {
  it('清理 CRLF 与连续空行并保留内容', () => {
    expect(formatReleaseNotes('修复了 A\r\n\r\n\r\n修复了 B')).toBe('修复了 A\n\n修复了 B');
  });
  it('超长说明被截断并追加省略号', () => {
    const long = 'a'.repeat(1000);
    const result = formatReleaseNotes(long);
    expect(result.length).toBe(601);
    expect(result.endsWith('…')).toBe(true);
  });
  it('空说明返回空字符串', () => {
    expect(formatReleaseNotes('')).toBe('');
  });
});
