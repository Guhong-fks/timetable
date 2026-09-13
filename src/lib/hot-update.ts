import * as Updates from 'expo-updates';

/**
 * EAS Update 热更新（OTA）封装。
 *
 * 机制：
 * - 原生构建（release APK）内置 expo-updates，启动时自动向
 *   `https://u.expo.dev/<projectId>` 检查更新（EXPO_UPDATES_CHECK_ON_LAUNCH=ALWAYS），
 *   有更新则后台下载、下次启动生效——小改动发布后用户无需重新安装 APK。
 * - 本模块提供"立即检查 + 下载 + 重启生效"的主动路径（设置页"检查更新"）。
 *
 * 兼容性规则（runtimeVersion = appVersion 策略）：
 * - 只有与当前构建 runtimeVersion（即 app.json 的 version）完全一致的更新才会被下发，
 *   因此 **纯 JS/TS 热更新发布时不要改 app.json 的 version**；
 * - 原生代码改动必须升版本 + 重新构建 APK 发布（GitHub Release），旧客户端不会接收
 *   不兼容的更新。
 *
 * 注意：
 * - 仅在启用 expo-updates 的原生构建中生效（Expo Go / 未配置更新时 isEnabled 为 false），
 *   此时所有接口按"不支持 / 无更新"安全降级，不影响原有 APK 检查路径。
 */

export interface HotUpdateStatus {
  /** 当前构建是否启用 OTA（false 时 UI 应跳过热更新检查） */
  supported: boolean;
  /** 是否存在可立即应用的热更新 */
  available: boolean;
}

/** 判断当前构建是否支持热更新（release 原生构建且 expo-updates 已启用）。 */
export function isHotUpdateSupported(): boolean {
  return Updates.isEnabled && !__DEV__;
}

/**
 * 检查 EAS Update 是否有可用热更新。
 * 任何异常都视为"不可用"返回，不向上抛出，由调用方回退到 APK 检查。
 */
export async function checkHotUpdate(): Promise<HotUpdateStatus> {
  if (!isHotUpdateSupported()) {
    return { supported: false, available: false };
  }
  try {
    const result = await Updates.checkForUpdateAsync();
    return { supported: true, available: result.isAvailable };
  } catch {
    // 网络 / 服务异常：静默降级，不影响 GitHub APK 检查路径。
    return { supported: true, available: false };
  }
}

/**
 * 下载并立即应用热更新。
 * - 下载成功后调用 reloadAsync 重启应用，新版本即刻生效；
 * - 返回 true 表示已进入重启流程；返回 false 表示没有可应用的新更新；
 * - 下载失败时抛出异常，由调用方提示用户。
 */
export async function applyHotUpdate(): Promise<boolean> {
  const result = await Updates.fetchUpdateAsync();
  if (!result.isNew) return false;
  await Updates.reloadAsync();
  return true;
}

/** 当前构建绑定的更新通道（如 "production"），Expo Go / 开发构建为 null。 */
export function getUpdateChannel(): string | null {
  return Updates.channel;
}

/** 当前构建的 runtimeVersion（appVersion 策略下等于应用版本号），未配置为 null。 */
export function getRuntimeVersion(): string | null {
  return Updates.runtimeVersion;
}
