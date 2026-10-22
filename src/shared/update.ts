// 检查更新共享契约：通道 + 常量 + 类型 + 纯函数
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 检查更新的 IPC 通道 */
export const UPDATE_CHANNELS = {
  /** 渲染层主动触发检查更新 */
  check: 'update:check',
  /** 主进程推送自动检查发现的新版本结果 */
  available: 'update:available'
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

/** preload 暴露给渲染层的检查更新 API */
export interface UpdateApi {
  check: () => Promise<UpdateCheckResult>
  /**
   * 订阅主进程自动检查发现的新版本提醒。
   * 返回值为取消订阅函数，组件卸载时调用以避免监听泄漏。
   */
  onAvailable: (callback: (result: UpdateCheckResult) => void) => () => void
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
    pageUrl: releasePageUrl(owner, repo, tag)
  }
}
