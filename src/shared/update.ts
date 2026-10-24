// 检查更新共享契约：通道 + 常量 + 类型 + 纯函数
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 检查更新的 IPC 通道 */
export const UPDATE_CHANNELS = {
  /** 渲染层主动触发检查更新 */
  check: 'update:check',
  /** 主进程推送自动检查发现的新版本结果 */
  available: 'update:available',
  /** 渲染层请求下载指定安装包 */
  download: 'update:download',
  /** 主进程推送下载进度 */
  downloadProgress: 'update:download-progress',
  /** 渲染层请求取消下载 */
  cancelDownload: 'update:cancel-download',
  /** 渲染层请求打开已下载的安装包 */
  openDownloaded: 'update:open-downloaded',
  /** 渲染层请求在文件管理器中显示安装包 */
  showInFolder: 'update:show-in-folder',
  /** 渲染层查询当前下载状态快照 */
  downloadState: 'update:download-state'
} as const

/** 自动检查更新的周期：每 4 小时一次 */
export const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** 自动检查更新的首次延迟：应用启动 10 秒后执行首检 */
export const AUTO_CHECK_INITIAL_DELAY_MS = 10 * 1000

/** GitHub 仓库归属者 */
export const GITHUB_OWNER = 'BigCleverXu'
/** GitHub 仓库名 */
export const GITHUB_REPO = 'office-software'
/** GitHub 发版 API 基址 */
export const GITHUB_RELEASES_ENDPOINT = 'https://api.github.com/repos'

/** 安装包下载目录名（位于系统下载目录下） */
export const UPDATE_DOWNLOAD_DIR_NAME = 'reminder-app-updates'

/** 允许下载的 GitHub release 下载地址路径前缀 */
export const UPDATE_DOWNLOAD_PATH_PREFIX =
  '/BigCleverXu/office-software/releases/download/'

/** 发行版中的一个安装包资产 */
export interface ReleaseAsset {
  /** 文件名 */
  name: string
  /** 字节大小，未知时为 0 */
  size: number
  /** 下载地址 */
  downloadUrl: string
}

/** 发行版信息 */
export interface ReleaseInfo {
  /** 规范化后的版本号（去前导 v / V） */
  version: string
  /** 原始 tag_name */
  tag: string
  /** 发行版名称，缺失时回退为 tag */
  title: string
  /** 发行说明正文，可能为空字符串 */
  notes: string
  /** created_at，缺失为 null */
  publishedAt: string | null
  /** 发行版页面地址 */
  pageUrl: string
  /** 发行版资产列表，无资产时为空数组 */
  assets: ReleaseAsset[]
}

/** 检查更新的失败原因 */
export type UpdateErrorReason =
  'network' | 'timeout' | 'rate-limited' | 'unreadable' | 'unknown'

/** 检查更新的四态判别联合（均携带当前版本号） */
export type UpdateCheckResult =
  | {
      status: 'update-available'
      currentVersion: string
      release: ReleaseInfo
    }
  | { status: 'up-to-date'; currentVersion: string; release: ReleaseInfo }
  | { status: 'no-release'; currentVersion: string }
  | { status: 'error'; currentVersion: string; reason: UpdateErrorReason }

/** 下载进度 */
export interface UpdateDownloadProgress {
  /** 文件名 */
  fileName: string
  /** 已传输字节数 */
  transferred: number
  /** 总字节数，未知时为 0 */
  total: number
  /** 进度百分比（0-100） */
  percent: number
}

/** 下载失败原因 */
export type UpdateDownloadErrorReason =
  | 'network'
  | 'timeout'
  | 'http'
  | 'invalid-asset'
  | 'write'
  | 'busy'
  | 'unknown'

/** 下载安装包的结果 */
export type UpdateDownloadResult =
  | { status: 'completed'; fileName: string; filePath: string }
  | { status: 'cancelled' }
  | {
      status: 'failed'
      reason: UpdateDownloadErrorReason
      /** 诊断详情：HTTP 状态码或底层错误码，界面原样展示 */
      detail?: string
    }

/** 下载状态快照：下载状态的唯一事实来源，供渲染层恢复进度 */
export type UpdateDownloadSnapshot =
  | { status: 'idle' }
  | {
      status: 'downloading'
      asset: ReleaseAsset
      progress: UpdateDownloadProgress
    }
  | {
      status: 'completed'
      asset: ReleaseAsset
      fileName: string
      filePath: string
    }
  | {
      status: 'failed'
      asset: ReleaseAsset
      reason: UpdateDownloadErrorReason
      detail?: string
    }

/** 打开已下载安装包的结果 */
export type OpenDownloadedResult =
  { status: 'opened' } | { status: 'revealed' } | { status: 'failed' }

/** preload 暴露给渲染层的检查更新 API */
export interface UpdateApi {
  /** 当前运行平台（process.platform），供渲染层挑选安装包 */
  readonly platform: string
  /** 当前运行架构（process.arch），供渲染层挑选安装包 */
  readonly arch: string
  check: () => Promise<UpdateCheckResult>
  /**
   * 订阅主进程自动检查发现的新版本提醒。
   * 返回值为取消订阅函数，组件卸载时调用以避免监听泄漏。
   */
  onAvailable: (callback: (result: UpdateCheckResult) => void) => () => void
  /** 下载指定安装包 */
  download: (asset: ReleaseAsset) => Promise<UpdateDownloadResult>
  /**
   * 订阅下载进度。
   * 返回值为取消订阅函数，组件卸载时调用以避免监听泄漏。
   */
  onDownloadProgress: (
    callback: (progress: UpdateDownloadProgress) => void
  ) => () => void
  /** 取消当前下载 */
  cancelDownload: () => Promise<void>
  /** 打开已下载的安装包 */
  openDownloaded: (filePath: string) => Promise<OpenDownloadedResult>
  /** 在文件管理器中显示安装包 */
  showInFolder: (filePath: string) => Promise<void>
  /** 查询当前下载状态快照，用于弹窗重开时恢复进度 */
  getDownloadState: () => Promise<UpdateDownloadSnapshot>
}

/** 去除首尾空白与一个前导 v / V */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^[vV]/, '')
}

/**
 * 比较两个版本号：-1（a<b）、0（相等）、1（a>b）。
 * 先 normalize，再按 `.` 分段逐段比较：两段均为纯数字时按数值比较，
 * 否则按字典序比较；段数不同时缺失段按 '0' 处理。
 */
export function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a).split('.')
  const right = normalizeVersion(b).split('.')
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const itemLeft = left[index] ?? '0'
    const itemRight = right[index] ?? '0'
    const numeric = /^\d+$/.test(itemLeft) && /^\d+$/.test(itemRight)
    let diff: number
    if (numeric) {
      diff = Number(itemLeft) - Number(itemRight)
    } else if (itemLeft === itemRight) {
      diff = 0
    } else {
      diff = itemLeft < itemRight ? -1 : 1
    }
    if (diff !== 0) {
      return diff > 0 ? 1 : -1
    }
  }
  return 0
}

/** latest 是否比 current 更新 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

/** 拼接发行版页面地址 */
export function releasePageUrl(
  owner: string,
  repo: string,
  tag: string
): string {
  return `https://github.com/${owner}/${repo}/releases/tag/${tag}`
}

/**
 * 解析发行版资产列表。
 * 非数组返回空数组；逐项要求 name 与 browser_download_url 为非空字符串，
 * size 非负有限数字，否则记为 0；不合法项直接忽略。
 */
function parseReleaseAssets(raw: unknown): ReleaseAsset[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const assets: ReleaseAsset[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    // 收窄为局部 Record，配合下方逐字段 typeof 检查，避免 any 绕过
    const record = item as Record<string, unknown>
    const name = record.name
    const url = record.browser_download_url
    if (typeof name !== 'string' || name === '') {
      continue
    }
    if (typeof url !== 'string' || url === '') {
      continue
    }
    const size = record.size
    assets.push({
      name,
      size:
        typeof size === 'number' && Number.isFinite(size) && size >= 0
          ? size
          : 0,
      downloadUrl: url
    })
  }
  return assets
}

/**
 * 解析 GitHub /releases/latest 的 JSON（字段为 snake_case）。
 * 非对象、或 tag_name 缺失/非字符串/为空时返回 null。
 */
export function parseRelease(
  payload: unknown,
  owner: string,
  repo: string
): ReleaseInfo | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  // 收窄为局部 Record，配合下方逐字段 typeof 检查，避免 any 绕过
  const record = payload as Record<string, unknown>
  const tag = record.tag_name
  if (typeof tag !== 'string' || tag === '') {
    return null
  }
  const name = record.name
  const body = record.body
  const createdAt = record.created_at
  return {
    tag,
    version: normalizeVersion(tag),
    title: typeof name === 'string' && name !== '' ? name : tag,
    notes: typeof body === 'string' ? body : '',
    publishedAt: typeof createdAt === 'string' ? createdAt : null,
    pageUrl: releasePageUrl(owner, repo, tag),
    assets: parseReleaseAssets(record.assets)
  }
}

/** 各架构在文件名中的常见标识（小写） */
const ARCH_MARKERS: Record<string, string[]> = {
  arm64: ['arm64', 'aarch64'],
  x64: ['x64', 'x86_64', 'amd64']
}

/** 所有可识别的架构标识（小写） */
const ALL_ARCH_MARKERS = [
  'arm64',
  'aarch64',
  'x64',
  'x86_64',
  'amd64',
  'ia32',
  'x86',
  'armv7l'
]

/** 取文件名的小写扩展名（含点），无扩展名返回空字符串 */
function lowerExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex < 0 ? '' : name.slice(dotIndex).toLowerCase()
}

/** 文件名是否包含指定架构标识（按非字母数字边界匹配，忽略大小写） */
function hasArchMarker(name: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(name)
}

/** 当前架构对应的标识列表，未知架构返回空数组 */
function currentArchMarkers(arch: string): string[] {
  const value = arch.toLowerCase()
  if (value === 'arm64' || value === 'aarch64') {
    return ARCH_MARKERS.arm64
  }
  if (value === 'x64' || value === 'x86_64' || value === 'amd64') {
    return ARCH_MARKERS.x64
  }
  return []
}

/**
 * 架构匹配得分：命中当前架构标识为 2，未标注架构为 1，
 * 仅命中其他架构标识为 0。
 */
function archScore(name: string, arch: string): number {
  if (currentArchMarkers(arch).some((marker) => hasArchMarker(name, marker))) {
    return 2
  }
  if (ALL_ARCH_MARKERS.some((marker) => hasArchMarker(name, marker))) {
    return 0
  }
  return 1
}

/** 按架构匹配度降序排序，同分保持原有顺序 */
function sortByArch(assets: ReleaseAsset[], arch: string): ReleaseAsset[] {
  return assets
    .map((asset, index) => ({
      asset,
      index,
      score: archScore(asset.name, arch)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.asset)
}

/** 在指定扩展名（小写含点）的资产中选架构匹配度最高者 */
function pickByExtensions(
  assets: ReleaseAsset[],
  extensions: string[],
  arch: string
): ReleaseAsset | null {
  const matched = assets.filter((asset) =>
    extensions.includes(lowerExtension(asset.name))
  )
  if (matched.length === 0) {
    return null
  }
  return sortByArch(matched, arch)[0] ?? null
}

/**
 * 按平台与架构挑选最合适的安装包。
 * Windows 只考虑 .exe；macOS 优先 .dmg 再回退 .zip；
 * Linux 优先 .AppImage 再回退 .deb；其他平台返回 null。
 */
export function selectDownloadAsset(
  assets: ReleaseAsset[],
  platform: string,
  arch: string
): ReleaseAsset | null {
  if (platform === 'win32') {
    return pickByExtensions(assets, ['.exe'], arch)
  }
  if (platform === 'darwin') {
    const dmg = pickByExtensions(assets, ['.dmg'], arch)
    return dmg ?? pickByExtensions(assets, ['.zip'], arch)
  }
  if (platform === 'linux') {
    const appImage = pickByExtensions(assets, ['.appimage'], arch)
    return appImage ?? pickByExtensions(assets, ['.deb'], arch)
  }
  return null
}

/** 平台展示名，未知平台返回原值 */
export function downloadPlatformLabel(platform: string): string {
  if (platform === 'win32') {
    return 'Windows'
  }
  if (platform === 'darwin') {
    return 'macOS'
  }
  if (platform === 'linux') {
    return 'Linux'
  }
  return platform
}

/** 安装包类型展示名 */
export function downloadAssetTypeLabel(asset: ReleaseAsset): string {
  switch (lowerExtension(asset.name)) {
    case '.exe':
      return '安装程序'
    case '.dmg':
      return '磁盘映像'
    case '.zip':
      return '压缩包'
    case '.appimage':
      return 'AppImage'
    case '.deb':
      return 'deb 安装包'
    default:
      return '安装包'
  }
}

/** 格式化字节大小：0 或非法值显示「未知大小」，其余保留一位小数 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '未知大小'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}
