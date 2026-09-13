import Constants from 'expo-constants';

/**
 * GitHub 仓库（用户名/仓库名）。
 *
 * ⚠️ 仓库必须设为 **公开**：App 以匿名方式调用 GitHub API，
 * 私有仓库会返回 404，且私有仓库的 Release 附件也无法匿名下载。
 *
 * 发布新版本流程：
 * 1. 把 app.json / package.json 的 version 升到新版本号（如 1.0.5）；
 * 2. 用 EAS 构建出 APK；
 * 3. 在 GitHub 仓库创建 Release，Tag 填 v{版本号}（如 v1.0.5），
 *    并把 APK 作为附件上传（支持 .apk 后缀的任意文件名）。
 */
const GITHUB_REPO = 'Guhong-fks/timetable';

const RELEASES_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
/** 请求超时（毫秒），与 storage.ts 的 10s 超时策略保持一致 */
const FETCH_TIMEOUT_MS = 10000;
/** 更新说明在弹窗里最多展示的字符数 */
const RELEASE_NOTES_MAX_LEN = 600;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

interface UpdateInfo {
  /** 当前安装版本（来自 app.json 的 version） */
  currentVersion: string;
  /** 最新 Release 的版本号（Tag 去掉前导 v） */
  latestVersion: string;
  isUpdateAvailable: boolean;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  /** Release 页面地址，无 APK 附件时用于兜底跳转 */
  releaseUrl: string;
  /** APK 直链；Release 没有 .apk 附件时为 null */
  downloadUrl: string | null;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string | null;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  assets: GitHubReleaseAsset[];
}

/** 检查失败的分类错误码，UI 层据此决定提示文案 */
type UpdateCheckErrorCode = 'NOT_FOUND' | 'HTTP' | 'NETWORK';

export class UpdateCheckError extends Error {
  constructor(
    public readonly code: UpdateCheckErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'UpdateCheckError';
  }
}

/** 读取当前应用版本号；构建产物中 app.json 的 version 会被嵌入 expoConfig。 */
export function getCurrentVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

/** 解析 semver 版本号，兼容前导 v 与 -beta/+build 后缀；无法解析返回 null。 */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(raw.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** candidate 比 baseline 新（语义化版本逐段比较）；任一无法解析视为不新。 */
export function isVersionNewer(candidate: string, baseline: string): boolean {
  const c = parseVersion(candidate);
  const b = parseVersion(baseline);
  if (!c || !b) return false;
  if (c.major !== b.major) return c.major > b.major;
  if (c.minor !== b.minor) return c.minor > b.minor;
  return c.patch > b.patch;
}

/** 在 Release 附件中挑选第一个 .apk 文件（不区分大小写）；没有则返回 null。 */
export function pickApkAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
  return assets.find((asset) => asset.name.toLowerCase().endsWith('.apk')) ?? null;
}

/** 清理 Release 说明：统一换行、压缩连续空行、限制长度。 */
export function formatReleaseNotes(body: string): string {
  const cleaned = body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned.length <= RELEASE_NOTES_MAX_LEN
    ? cleaned
    : `${cleaned.slice(0, RELEASE_NOTES_MAX_LEN)}…`;
}

/**
 * 查询 GitHub 仓库的最新 Release，并与当前版本对比。
 * - 仓库不存在或尚无 Release：抛 UpdateCheckError('NOT_FOUND')
 * - 网络/超时/响应异常：抛 UpdateCheckError('NETWORK' | 'HTTP')
 * 不需要网络权限以外的任何配置，GitHub API 匿名限额（60 次/小时）对手动检查足够。
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(RELEASES_LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (response.status === 404) {
      throw new UpdateCheckError('NOT_FOUND', '仓库不存在或暂无 Release');
    }
    if (!response.ok) {
      throw new UpdateCheckError('HTTP', `GitHub API 返回 HTTP ${response.status}`);
    }
    const release = (await response.json()) as GitHubRelease;
    const latestVersion = (release.tag_name ?? '').replace(/^v/i, '');
    const apk = pickApkAsset(release.assets ?? []);
    return {
      currentVersion,
      latestVersion,
      isUpdateAvailable: latestVersion !== '' && isVersionNewer(latestVersion, currentVersion),
      releaseName: release.name || release.tag_name || latestVersion,
      releaseNotes: formatReleaseNotes(release.body ?? ''),
      publishedAt: release.published_at ?? '',
      releaseUrl: release.html_url,
      downloadUrl: apk?.browser_download_url ?? null,
    };
  } catch (error) {
    if (error instanceof UpdateCheckError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpdateCheckError('NETWORK', '请求超时');
    }
    throw new UpdateCheckError('NETWORK', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}
