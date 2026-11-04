// 快捷网站模块共享契约：类型 + 常量 + 纯函数 + IPC 通道
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 目标浏览器标识 */
export type BrowserId =
  | 'system'
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'brave'
  | 'vivaldi'
  | 'opera'
  | 'safari'

/** 浏览器内核类型，决定启动参数拼装方式 */
export type BrowserKind = 'system' | 'chromium' | 'firefox' | 'safari'

/** 全部合法浏览器标识，顺序即探测优先级 */
export const BROWSER_IDS: readonly BrowserId[] = [
  'system',
  'chrome',
  'edge',
  'firefox',
  'brave',
  'vivaldi',
  'opera',
  'safari'
]

/** 系统默认浏览器的标识 */
export const SYSTEM_BROWSER_ID = 'system'

/** 站点名称最大字符数 */
export const QUICK_SITE_NAME_MAX_LENGTH = 20

/** 编组名称最大字符数 */
export const QUICK_SITE_GROUP_NAME_MAX_LENGTH = 20

/** 网址最大字符数 */
export const QUICK_SITE_URL_MAX_LENGTH = 2048

/** 浏览器角色 id 最大字符数 */
export const QUICK_SITE_PROFILE_ID_MAX_LENGTH = 512

/** 浏览器角色：Chromium 为 profile 目录名，Firefox 为配置目录绝对路径 */
export interface BrowserProfile {
  /** 角色 id；空字符串表示跟随浏览器默认行为 */
  id: string
  /** 展示名称 */
  name: string
}

/** 本机检测到的一个浏览器 */
export interface DetectedBrowser {
  id: BrowserId
  name: string
  kind: BrowserKind
  /** 可执行文件绝对路径；系统默认浏览器为空字符串 */
  executable: string
  profiles: BrowserProfile[]
}

/** 浏览器扫描结果 */
export interface BrowserScanResult {
  browsers: DetectedBrowser[]
}

/** 一个快捷站点 */
export interface QuickSite {
  id: string
  name: string
  /** 已规整的 http / https 网址 */
  url: string
  browserId: BrowserId
  /** 浏览器角色 id，空字符串表示默认角色 */
  profileId: string
  sortOrder: number
  /** 创建时间戳（毫秒） */
  createdAt: number
  /** 最近更新时间戳（毫秒） */
  updatedAt: number
}

/** 创建 / 编辑站点时提交的数据 */
export interface QuickSiteDraft {
  name: string
  url: string
  browserId: BrowserId
  profileId: string
}

/** 保存结果 */
export interface QuickSiteSaveResult {
  ok: boolean
  site?: QuickSite
  error?: string
}

/** 打开站点的结果 */
export interface OpenQuickSiteResult {
  ok: boolean
  /** 实际使用的浏览器名称 */
  browserName?: string
  /** 是否回退到系统默认浏览器 */
  fallback?: boolean
  error?: string
}

/** 一个快捷网站编组 */
export interface QuickSiteGroup {
  id: string
  name: string
  /** 编组包含的站点 id，已去重且仅保留存在的站点 */
  siteIds: string[]
  sortOrder: number
  /** 创建时间戳（毫秒） */
  createdAt: number
  /** 最近更新时间戳（毫秒） */
  updatedAt: number
}

/** 创建 / 编辑编组时提交的数据 */
export interface QuickSiteGroupDraft {
  name: string
  siteIds: string[]
}

/** 编组保存结果 */
export interface QuickSiteGroupSaveResult {
  ok: boolean
  group?: QuickSiteGroup
  error?: string
}

/** 打开编组的结果 */
export interface OpenQuickSiteGroupResult {
  ok: boolean
  /** 成功打开的站点数 */
  opened: number
  /** 回退到系统默认浏览器的站点数 */
  fallback: number
  /** 打开失败的站点数 */
  failed: number
  /** 失败提示，按站点顺序收集 */
  errors?: string[]
}

/** IPC 通道名称 */
export const QUICK_SITE_CHANNELS = {
  list: 'quick-sites:list',
  create: 'quick-sites:create',
  update: 'quick-sites:update',
  remove: 'quick-sites:delete',
  open: 'quick-sites:open',
  listBrowsers: 'quick-sites:list-browsers',
  changed: 'quick-sites:changed'
} as const

/** 编组 IPC 通道名称 */
export const QUICK_SITE_GROUP_CHANNELS = {
  list: 'quick-site-groups:list',
  create: 'quick-site-groups:create',
  update: 'quick-site-groups:update',
  remove: 'quick-site-groups:delete',
  open: 'quick-site-groups:open',
  changed: 'quick-site-groups:changed'
} as const

/** 渲染进程可用的快捷网站 API（由 preload 暴露） */
export interface QuickSiteApi {
  list: () => Promise<QuickSite[]>
  create: (draft: QuickSiteDraft) => Promise<QuickSiteSaveResult>
  update: (id: string, draft: QuickSiteDraft) => Promise<QuickSiteSaveResult>
  remove: (id: string) => Promise<void>
  open: (id: string) => Promise<OpenQuickSiteResult>
  listBrowsers: () => Promise<BrowserScanResult>
  onChanged: (callback: (sites: QuickSite[]) => void) => () => void
  listGroups: () => Promise<QuickSiteGroup[]>
  createGroup: (draft: QuickSiteGroupDraft) => Promise<QuickSiteGroupSaveResult>
  updateGroup: (
    id: string,
    draft: QuickSiteGroupDraft
  ) => Promise<QuickSiteGroupSaveResult>
  removeGroup: (id: string) => Promise<void>
  openGroup: (id: string) => Promise<OpenQuickSiteGroupResult>
  onGroupsChanged: (callback: (groups: QuickSiteGroup[]) => void) => () => void
}

/** 匹配开头的协议名（字母开头，后接字母 / 数字 / + . -） */
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** 匹配「主机:端口」形式，冒号后为纯数字 */
const HOST_PORT_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\d+(?:[/?#].*)?$/

/**
 * 规整网址：去首尾空格，仅接受 http / https。
 * 缺少协议时补 https://（含 //example.com 与 host:port 形式）；
 * 其它协议（javascript: / file: / data: / mailto: 等）一律返回空字符串。
 */
export function normalizeQuickSiteUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > QUICK_SITE_URL_MAX_LENGTH) {
    return ''
  }
  let candidate: string
  if (trimmed.startsWith('//')) {
    candidate = `https:${trimmed}`
  } else {
    const schemeMatch = trimmed.match(SCHEME_PATTERN)
    if (schemeMatch === null) {
      candidate = `https://${trimmed}`
    } else {
      const scheme = schemeMatch[0].slice(0, -1).toLowerCase()
      if (scheme === 'http' || scheme === 'https') {
        candidate = trimmed
      } else if (HOST_PORT_PATTERN.test(trimmed)) {
        // 形如 example.com:8080：冒号后为纯数字，按缺省协议处理
        candidate = `https://${trimmed}`
      } else {
        return ''
      }
    }
  }
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return ''
    }
    if (parsed.hostname === '') {
      return ''
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

/** 取网址主机名；解析失败返回空字符串 */
export function hostOf(url: string): string {
  if (typeof url !== 'string' || url === '') {
    return ''
  }
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * 规整名称：去首尾空格并截断到 20 个字符；为空时回退为域名
 * （去掉 `www.` 前缀）。
 */
export function normalizeQuickSiteName(value: unknown, url: string): string {
  const trimmed =
    typeof value === 'string'
      ? value.trim().slice(0, QUICK_SITE_NAME_MAX_LENGTH)
      : ''
  if (trimmed !== '') {
    return trimmed
  }
  return hostOf(url)
    .replace(/^www\./, '')
    .slice(0, QUICK_SITE_NAME_MAX_LENGTH)
}

/** 判断 value 是否为合法的浏览器标识（白名单校验） */
export function isBrowserId(value: unknown): value is BrowserId {
  return (
    typeof value === 'string' &&
    (BROWSER_IDS as readonly string[]).includes(value)
  )
}

/**
 * 规整浏览器角色 id：非字符串回退为空，去首尾空格并截断。
 * 打开方式为系统默认浏览器时强制为空字符串。
 */
export function normalizeQuickSiteProfileId(
  value: unknown,
  browserId: BrowserId
): string {
  if (browserId === SYSTEM_BROWSER_ID || typeof value !== 'string') {
    return ''
  }
  return value.trim().slice(0, QUICK_SITE_PROFILE_ID_MAX_LENGTH)
}

/** 规整编组名称：非字符串返回空串，去首尾空格并截断到 20 个字符 */
export function normalizeQuickSiteGroupName(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim().slice(0, QUICK_SITE_GROUP_NAME_MAX_LENGTH)
}

/**
 * 规整编组站点 id 列表：非数组返回空数组；逐项仅接受字符串，
 * 去首尾空格、丢弃空串，去重并保持首次出现的顺序。
 */
export function normalizeQuickSiteGroupSiteIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }
    const id = item.trim()
    if (id === '' || seen.has(id)) {
      continue
    }
    seen.add(id)
    result.push(id)
  }
  return result
}
