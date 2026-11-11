// 短视频模块共享契约：类型 + 常量 + 纯函数
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 支持的短视频平台标识 */
export type VideoPlatform = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'bilibili'

/** 全部平台标识，顺序即界面展示顺序 */
export const VIDEO_PLATFORMS: readonly VideoPlatform[] = [
  'douyin',
  'kuaishou',
  'xiaohongshu',
  'bilibili'
]

/** 资源类型：视频 / 图文笔记 */
export type VideoResourceKind = 'video' | 'note'

/** 清晰度档位的容器格式 */
export type VideoContainer = 'mp4' | 'flv' | 'm4s' | 'unknown'

/** 单个清晰度档位 */
export interface VideoVariant {
  /** 档位唯一标识，同一资源内唯一 */
  id: string
  /** 展示名，如「1080P 高清」 */
  label: string
  /** 清晰度排序权重，数值越大越清晰 */
  qualityRank: number
  /** 容器格式 */
  container: VideoContainer
  /** 媒体地址；下载前仍会做 CDN 白名单校验 */
  url: string
  /** DASH 场景下的独立音轨地址 */
  audioUrl?: string
  width?: number
  height?: number
  /** 字节大小，未知时缺省 */
  size?: number
}

/** 图片条目（图文笔记图片 / 封面图） */
export interface VideoImage {
  url: string
  width?: number
  height?: number
  /** 同图的无水印优先候选地址，下载失败时依次回退 */
  fallbackUrls?: string[]
  /** 仅剩带水印候选时为 true */
  watermarked?: boolean
  /** 动图（live 图）的视频源 */
  animated?: {
    url: string
    width?: number
    height?: number
    durationSec?: number
  }
}

/** 资源互动数据，缺失的字段不展示 */
export interface VideoStats {
  likes?: number
  comments?: number
  collects?: number
}

/** 归一化后的视频 / 图文资源 */
export interface VideoResource {
  /** 资源唯一标识，形如「平台:nativeId」 */
  id: string
  platform: VideoPlatform
  /** 平台原生 ID */
  nativeId: string
  kind: VideoResourceKind
  title: string
  author: string
  /** 作者头像地址 */
  avatar?: string
  /** 封面图 */
  cover?: VideoImage
  /** 正文 / 简介 */
  description?: string
  /** 时长（秒） */
  durationSec?: number
  /** 发布时间，ISO 字符串 */
  publishedAt?: string
  /** 用户输入的原始分享地址 */
  sourceUrl: string
  /** 短链跳转后的最终地址 */
  resolvedUrl: string
  /** 可直接分享的资源页地址 */
  shareUrl: string
  /** 清晰度档位，图文笔记为空数组 */
  variants: VideoVariant[]
  /** 图片列表，视频可为空数组 */
  images: VideoImage[]
  stats?: VideoStats
}

/** 解析 / 下载 / 口播的失败原因 */
export type VideoErrorReason =
  | 'invalid-link'
  | 'unsupported-platform'
  | 'short-link-failed'
  | 'expired'
  | 'rate-limited'
  | 'signature-failed'
  | 'api-changed'
  | 'network'
  | 'empty'
  | 'engine-missing'
  | 'engine-failed'
  | 'ffmpeg-missing'
  | 'write'
  | 'busy'
  | 'unknown'

/** 解析结果 */
export type VideoParseResult =
  | { ok: true; resource: VideoResource }
  | {
      ok: false
      reason: VideoErrorReason
      message: string
      /** 未识别出平台时为 null */
      platform: VideoPlatform | null
      /** 诊断详情：阶段标识或截断后的底层错误，界面原样展示 */
      detail?: string
    }

/** 下载请求 */
export interface VideoDownloadRequest {
  resourceId: string
  variantId: string
  /** 为 true 时清理半成品并从头下载 */
  reset?: boolean
}

/** 下载进度 */
export interface VideoDownloadProgress {
  /** 目标文件名 */
  fileName: string
  /** 已传输字节数 */
  transferred: number
  /** 总字节数，未知时为 0 */
  total: number
  /** 进度百分比（0-100 整数） */
  percent: number
  /** 当前速度，字节/秒 */
  speedBytesPerSec: number
  /** 预计剩余毫秒数，无法估算时为 null */
  remainingMs: number | null
}

/** 下载状态快照：下载状态的唯一事实来源，供界面重开恢复 */
export type VideoDownloadSnapshot =
  | { status: 'idle' }
  | {
      status: 'downloading'
      title: string
      fileName: string
      progress: VideoDownloadProgress
    }
  | { status: 'completed'; title: string; fileName: string; filePath: string }
  | {
      status: 'failed'
      title?: string
      reason: VideoErrorReason
      detail?: string
      /** 半成品是否保留、是否可续传 */
      resumable: boolean
    }

/** 图集下载进度 */
export interface VideoImageDownloadProgress {
  /** 已完成（成功 + 失败）的图片数 */
  completed: number
  /** 图片总数 */
  total: number
  /** 当前处理的文件名 */
  currentFileName: string
  /** 进度百分比（0-100 整数） */
  percent: number
}

/** 图集下载状态快照：同一时刻只允许一个任务 */
export type VideoImageDownloadSnapshot =
  | { status: 'idle' }
  | {
      status: 'downloading'
      title: string
      directory: string
      progress: VideoImageDownloadProgress
    }
  | {
      status: 'completed'
      title: string
      directory: string
      /** 成功保存的图片数 */
      saved: number
      /** 下载失败的图片数 */
      failed: number
    }
  | {
      status: 'failed'
      title: string
      reason: VideoErrorReason
      detail?: string
    }

/** 口播提取阶段 */
export type VideoTranscriptStage =
  'idle' | 'extracting' | 'recognizing' | 'completed' | 'failed'

/** 口播提取请求 */
export interface VideoTranscriptRequest {
  /** 已下载视频的绝对路径 */
  filePath: string
  /** 识别语言，缺省使用引擎配置 */
  language?: VideoEngineLanguage
}

/** 口播状态快照 */
export type VideoTranscriptSnapshot =
  | { status: 'idle' }
  | {
      status: 'running'
      stage: 'extracting' | 'recognizing'
      /** 阶段提示文案 */
      message: string
    }
  | {
      status: 'completed'
      text: string
      fileName: string
      /** 识别源文件绝对路径，旧快照可能缺失 */
      filePath?: string
      /** 实际使用的识别引擎名 */
      engine: string
      elapsedMs: number
    }
  | {
      status: 'failed'
      reason: VideoErrorReason
      message: string
      detail?: string
    }

/** 口播识别语言 */
export type VideoEngineLanguage = 'zh' | 'en' | 'auto'

/** 本地口播引擎配置 */
export interface VideoEngineConfig {
  /** whisper 可执行文件路径，空字符串表示自动探测 */
  whisperBinary: string
  /** whisper 模型文件路径，空字符串表示自动探测 */
  whisperModel: string
  /** ffmpeg 可执行文件路径，空字符串表示自动探测 */
  ffmpegPath: string
  /** 识别文本输出目录，空字符串表示使用应用数据目录 */
  outputDir: string
  language: VideoEngineLanguage
}

/** 引擎探测结果 */
export interface VideoEngineProbe {
  ok: boolean
  /** 探测到的 whisper 可执行文件，未找到为 null */
  binary: string | null
  /** 探测到的模型文件，未找到为 null */
  model: string | null
  /** 探测到的 ffmpeg，未找到为 null */
  ffmpeg: string | null
  /** 面向用户的中文说明 */
  message: string
}

/** 短视频模块设置 */
export interface VideoModuleSettings {
  engine: VideoEngineConfig
  /** 下载目录，空字符串表示由主进程按系统下载目录补全 */
  downloadDir: string
}

/** 默认引擎配置（也是非法数据的兜底值） */
export const DEFAULT_VIDEO_ENGINE_CONFIG: VideoEngineConfig = {
  whisperBinary: '',
  whisperModel: '',
  ffmpegPath: '',
  outputDir: '',
  language: 'zh'
}

/** 默认模块设置 */
export const DEFAULT_VIDEO_MODULE_SETTINGS: VideoModuleSettings = {
  engine: { ...DEFAULT_VIDEO_ENGINE_CONFIG },
  downloadDir: ''
}

/** 短视频模块 IPC 通道 */
export const VIDEO_CHANNELS = {
  /** 解析分享文本 */
  parse: 'video:parse',
  /** 发起 / 续传下载 */
  download: 'video:download',
  /** 清理半成品并重置下载状态 */
  resetDownload: 'video:reset-download',
  /** 取消当前下载（保留半成品） */
  cancelDownload: 'video:cancel-download',
  /** 查询下载状态快照 */
  downloadState: 'video:download-state',
  /** 主进程推送下载进度 */
  onDownloadProgress: 'video:download-progress',
  /** 下载图文笔记的全部图片 */
  downloadImages: 'video:download-images',
  /** 查询图集下载状态快照 */
  imageDownloadState: 'video:image-download-state',
  /** 取消当前图集下载 */
  cancelImageDownload: 'video:cancel-image-download',
  /** 主进程推送图集下载状态 */
  onImageDownloadProgress: 'video:image-download-progress',
  /** 用系统文件管理器打开目录 */
  openDirectory: 'video:open-directory',
  /** 开始口播提取 */
  transcriptStart: 'video:transcript-start',
  /** 取消口播提取 */
  transcriptCancel: 'video:transcript-cancel',
  /** 查询口播状态快照 */
  transcriptState: 'video:transcript-state',
  /** 主进程推送口播状态 */
  onTranscriptState: 'video:transcript-state-changed',
  /** 读取引擎配置 */
  engineGetSettings: 'video:engine-get-settings',
  /** 更新引擎配置 */
  engineUpdateSettings: 'video:engine-update-settings',
  /** 探测本地引擎 */
  engineProbe: 'video:engine-probe',
  /** 弹出文件 / 目录选择框 */
  pickFile: 'video:pick-file',
  /** 用系统默认程序打开文件 */
  openFile: 'video:open-file',
  /** 在文件管理器中定位文件 */
  showInFolder: 'video:show-in-folder',
  /** 导出文本为 .txt */
  exportText: 'video:export-text'
} as const

/** 文件选择类型 */
export type VideoPickKind =
  'whisper' | 'model' | 'ffmpeg' | 'media' | 'directory'

/** 文件选择结果 */
export interface VideoPickResult {
  canceled: boolean
  path?: string
}

/** 打开 / 定位操作结果 */
export interface VideoActionResult {
  ok: boolean
  error?: string
}

/** 导出文本结果 */
export interface VideoExportResult {
  canceled: boolean
  filePath?: string
}

/** 渲染进程可用的短视频 API（由 preload 暴露） */
export interface VideoApi {
  parse: (input: string) => Promise<VideoParseResult>
  download: (request: VideoDownloadRequest) => Promise<VideoDownloadSnapshot>
  /** 清理半成品并重置下载 */
  resetDownload: () => Promise<VideoDownloadSnapshot>
  /** 取消当前下载，保留半成品 */
  cancelDownload: () => Promise<void>
  /** 查询下载快照，用于界面重开恢复 */
  getDownloadState: () => Promise<VideoDownloadSnapshot>
  /**
   * 订阅下载进度。
   * 返回值为取消订阅函数，组件卸载时调用以避免监听泄漏。
   */
  onDownloadProgress: (
    callback: (progress: VideoDownloadProgress) => void
  ) => () => void
  /** 下载图文笔记的全部图片到本地目录 */
  downloadImages: (input: {
    resourceId: string
  }) => Promise<VideoImageDownloadSnapshot>
  /** 查询图集下载快照，用于界面重开恢复 */
  getImageDownloadState: () => Promise<VideoImageDownloadSnapshot>
  /** 取消当前图集下载，保留已写入的图片 */
  cancelImageDownload: () => Promise<void>
  /**
   * 订阅图集下载状态。
   * 返回值为取消订阅函数，组件卸载时调用以避免监听泄漏。
   */
  onImageDownloadProgress: (
    callback: (snapshot: VideoImageDownloadSnapshot) => void
  ) => () => void
  /** 用系统文件管理器打开目录 */
  openDirectory: (path: string) => Promise<void>
  startTranscript: (
    request: VideoTranscriptRequest
  ) => Promise<VideoTranscriptSnapshot>
  cancelTranscript: () => Promise<void>
  /** 查询口播快照 */
  getTranscriptState: () => Promise<VideoTranscriptSnapshot>
  /**
   * 订阅口播状态。
   * 返回值为取消订阅函数，组件卸载时调用以避免监听泄漏。
   */
  onTranscriptState: (
    callback: (state: VideoTranscriptSnapshot) => void
  ) => () => void
  getEngineSettings: () => Promise<VideoModuleSettings>
  updateEngineSettings: (
    settings: VideoModuleSettings
  ) => Promise<VideoModuleSettings>
  probeEngine: () => Promise<VideoEngineProbe>
  pickFile: (kind: VideoPickKind) => Promise<VideoPickResult>
  openFile: (filePath: string) => Promise<VideoActionResult>
  showInFolder: (filePath: string) => Promise<void>
  exportText: (input: {
    text: string
    suggestedFileName: string
  }) => Promise<VideoExportResult>
}

/** 短链最大跳转次数 */
export const MAX_SHORT_LINK_HOPS = 5

/** 单次解析总时长上限（毫秒） */
export const PARSE_TIMEOUT_MS = 30000

/** 解析结果缓存有效期（毫秒） */
export const RESOURCE_CACHE_TTL_MS = 10 * 60 * 1000

/** 下载文件名最大长度（含扩展名） */
export const VIDEO_FILE_NAME_MAX_LENGTH = 80

/** 平台语义色名，由渲染层映射到具体设计 token，此处不绑定类名 */
export type VideoAccent = 'cyan' | 'amber' | 'rose' | 'sky'

/** 平台元信息 */
export interface VideoPlatformMeta {
  /** 平台中文名 */
  label: string
  /** 用于识别平台的主机名后缀，允许子域 */
  hosts: readonly string[]
  /** 语义色名 */
  accent: VideoAccent
}

/** 各平台元信息，hosts 只包含平台自身域名（不含 CDN） */
export const PLATFORM_META: Record<VideoPlatform, VideoPlatformMeta> = {
  douyin: {
    label: '抖音',
    hosts: ['douyin.com', 'iesdouyin.com'],
    accent: 'cyan'
  },
  kuaishou: {
    label: '快手',
    hosts: ['kuaishou.com', 'chenzhongtech.com'],
    accent: 'amber'
  },
  xiaohongshu: {
    label: '小红书',
    hosts: ['xiaohongshu.com', 'xhslink.com'],
    accent: 'rose'
  },
  bilibili: {
    label: '哔哩哔哩',
    hosts: ['bilibili.com', 'b23.tv'],
    accent: 'sky'
  }
}

/** 各平台允许下载的媒体 CDN 主机后缀，允许子域 */
export const VIDEO_CDN_ALLOWLIST: Record<VideoPlatform, readonly string[]> = {
  douyin: [
    'douyin.com',
    'iesdouyin.com',
    'douyinpic.com',
    'douyinvod.com',
    'bytecdn.cn',
    'byteimg.com',
    'snssdk.com'
  ],
  kuaishou: ['kuaishou.com', 'kwai.com', 'kwaicdn.com', 'yximgs.com'],
  xiaohongshu: ['xiaohongshu.com', 'xhscdn.com', 'sns-img.com'],
  bilibili: ['bilivideo.com', 'bilivideo.cn', 'akamaized.net', 'hdslb.com']
}

/** 已知短链主机，允许子域 */
const SHORT_LINK_HOSTS: readonly string[] = [
  'v.douyin.com',
  'b23.tv',
  'xhslink.com',
  'v.kuaishou.com'
]

/** 分享文本中的 HTTP(S) 链接，遇到空白与中文标点即截止 */
const SHARE_URL_PATTERN = /https?:\/\/[^\s<>"'`，。；、！？：）】》」』”’]+/gi

/** 链接尾部可能被一并吞入的西文标点与闭合符号 */
const TRAILING_SYMBOL_PATTERN = /[.,;:!?)\]}>'"’”]+$/g

/** Windows 文件名非法字符与控制字符 */
const ILLEGAL_FILE_CHAR_PATTERN = /[\p{Cc}<>:"/\\|?*]/gu

/** 文件名尾部不允许出现的点与空格 */
const TRAILING_DOT_SPACE_PATTERN = /[. ]+$/g

/** 中英文空白 */
const WHITESPACE_PATTERN = /\s+/gu

/** Unicode 标点符号（中英文标点均属此类） */
const PUNCTUATION_PATTERN = /\p{P}/gu

/** 合法识别语言 */
const ENGINE_LANGUAGES: readonly VideoEngineLanguage[] = ['zh', 'en', 'auto']

/** 失败原因对应的中文文案 */
export const VIDEO_ERROR_MESSAGES: Record<VideoErrorReason, string> = {
  'invalid-link': '未识别到有效链接，请粘贴完整分享链接',
  'unsupported-platform':
    '暂不支持该平台，当前仅支持抖音、快手、小红书、哔哩哔哩',
  'short-link-failed': '短链解析失败，链接可能已失效，请重新复制分享链接',
  expired: '资源已失效或被删除',
  'rate-limited': '请求过于频繁，请稍后重试',
  'signature-failed': '平台签名校验失败，请稍后重试',
  'api-changed': '平台接口可能已变更，请稍后重试',
  network: '网络异常，请检查网络后重试',
  empty: '未获取到可用的媒体资源',
  'engine-missing': '未检测到本地口播引擎，请先在设置中配置 whisper 与模型',
  'engine-failed': '口播识别失败，请检查引擎与模型配置',
  'ffmpeg-missing': '未检测到 ffmpeg，请先配置 ffmpeg 路径',
  write: '写入文件失败，请检查磁盘空间与目录权限',
  busy: '当前有任务正在进行，请稍后再试',
  unknown: '操作失败，请稍后重试'
}

/** 是否为合法平台标识 */
function isVideoPlatform(value: unknown): value is VideoPlatform {
  return (
    typeof value === 'string' &&
    (VIDEO_PLATFORMS as readonly string[]).includes(value)
  )
}

/** 解析 URL 并返回小写主机名，非法输入返回 null */
function safeHostname(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  try {
    const hostname = new URL(value.trim()).hostname.toLowerCase()
    return hostname.length > 0 ? hostname : null
  } catch {
    return null
  }
}

/** 主机名是否命中域名后缀：精确相等或为其子域 */
function matchesHost(hostname: string, suffix: string): boolean {
  const normalized = suffix.toLowerCase()
  return hostname === normalized || hostname.endsWith(`.${normalized}`)
}

/**
 * 从任意分享文案中提取第一个 HTTP(S) 链接。
 * 自动去除尾部中文标点与西文标点；没有合法链接返回 null，不抛异常。
 */
export function extractShareUrl(text: string): string | null {
  if (typeof text !== 'string' || text.length === 0) {
    return null
  }
  const matches = text.match(SHARE_URL_PATTERN)
  if (matches === null) {
    return null
  }
  for (const match of matches) {
    const candidate = match.replace(TRAILING_SYMBOL_PATTERN, '')
    if (candidate.length === 0) {
      continue
    }
    try {
      // 用 URL 构造器兜底校验，避免把残缺片段当作链接返回
      new URL(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return null
}

/**
 * 依据主机名识别平台。
 * 仅接受精确域名或其子域，`douyin.com.example.com` 与 `fake-douyin.com`
 * 均视为未识别；无法解析的地址返回 null。
 */
export function detectVideoPlatform(url: string): VideoPlatform | null {
  const hostname = safeHostname(url)
  if (hostname === null) {
    return null
  }
  for (const platform of VIDEO_PLATFORMS) {
    if (
      PLATFORM_META[platform].hosts.some((host) => matchesHost(hostname, host))
    ) {
      return platform
    }
  }
  return null
}

/** 是否为已知短链地址 */
export function isShortLinkUrl(url: string): boolean {
  const hostname = safeHostname(url)
  if (hostname === null) {
    return false
  }
  if (SHORT_LINK_HOSTS.some((host) => matchesHost(hostname, host))) {
    return true
  }
  // 快手网页版分享短链形如 https://www.kuaishou.com/f/xxxx，
  // 需要跟随重定向才能得到 /short-video/{id}
  if (!matchesHost(hostname, 'kuaishou.com')) {
    return false
  }
  try {
    const pathname = new URL(url.trim()).pathname
    return /^\/f\/[A-Za-z0-9_-]+/.test(pathname)
  } catch {
    return false
  }
}

/** 平台中文名，未知平台返回「未知平台」 */
export function platformLabel(platform: VideoPlatform): string {
  return isVideoPlatform(platform) ? PLATFORM_META[platform].label : '未知平台'
}

/**
 * 格式化时长：非法 / 缺失 / 负数显示「--」；
 * 不足一小时为 m:ss，超过一小时为 h:mm:ss。
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '--'
  }
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const paddedSecs = String(secs).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSecs}`
  }
  return `${minutes}:${paddedSecs}`
}

/** 清洗文件名片段：去非法字符、折叠空白、去尾部点与空格 */
function cleanFileNamePart(value: string): string {
  return value
    .replace(ILLEGAL_FILE_CHAR_PATTERN, '')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
    .replace(TRAILING_DOT_SPACE_PATTERN, '')
}

/**
 * 清洗下载文件名：去掉路径、非法字符与首尾空白，折叠连续空白；
 * 保留合法扩展名并在总长度 80 内截断主体；清洗后为空时使用 fallback，
 * 仍为空则回退「video」。任何异常输入都不会抛出。
 */
export function sanitizeVideoFileName(name: string, fallback?: string): string {
  try {
    const raw = typeof name === 'string' ? name : ''
    const segment = (raw.split(/[\\/]/).pop() ?? '').trim()
    const dotIndex = segment.lastIndexOf('.')
    const extension =
      dotIndex > 0 && /^[a-z0-9]{1,8}$/i.test(segment.slice(dotIndex + 1))
        ? `.${segment.slice(dotIndex + 1).toLowerCase()}`
        : ''
    const baseRaw = extension.length > 0 ? segment.slice(0, dotIndex) : segment
    let base = cleanFileNamePart(baseRaw)
    if (base.length === 0) {
      base = cleanFileNamePart(typeof fallback === 'string' ? fallback : '')
    }
    if (base.length === 0) {
      base = 'video'
    }
    const maxBaseLength = Math.max(
      1,
      VIDEO_FILE_NAME_MAX_LENGTH - extension.length
    )
    if (base.length > maxBaseLength) {
      base = base
        .slice(0, maxBaseLength)
        .replace(TRAILING_DOT_SPACE_PATTERN, '')
    }
    if (base.length === 0) {
      base = 'video'
    }
    return `${base}${extension}`
  } catch {
    return 'video'
  }
}

/**
 * 媒体地址是否允许下载：必须为 https，主机名命中对应平台 CDN 后缀，
 * 且只接受精确域名或其子域，`douyin.com.evil.com` 之类的伪装地址一律拒绝。
 */
export function isAllowedMediaUrl(
  platform: VideoPlatform,
  url: string
): boolean {
  if (!isVideoPlatform(platform)) {
    return false
  }
  if (typeof url !== 'string' || url.trim().length === 0) {
    return false
  }
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'https:') {
      return false
    }
    const hostname = parsed.hostname.toLowerCase()
    return VIDEO_CDN_ALLOWLIST[platform].some((host) =>
      matchesHost(hostname, host)
    )
  } catch {
    return false
  }
}

/** 进度百分比：0-100 整数，total 非法或非正数时返回 0 */
export function percentOf(transferred: number, total: number): number {
  if (!Number.isFinite(transferred) || !Number.isFinite(total) || total <= 0) {
    return 0
  }
  const percent = (transferred / total) * 100
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/** 格式化字节大小：非法或非正数显示「0 B」，其余保留一位小数 */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  if (unitIndex === 0) {
    return `${Math.round(value)} B`
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/** 续传决策入参 */
export interface VideoResumeDecisionInput {
  /** 半成品已写入的字节数 */
  existingBytes: number
  /** 半成品 meta 记录的源地址，缺失为 null */
  metaUrl: string | null
  /** 本次请求的源地址 */
  requestUrl: string
  /** 是否存在可读的半成品 meta */
  hasMeta: boolean
}

/**
 * 续传决策：无 meta、无半成品、源地址变化或已下载字节数非法时
 * 均从头开始，否则按已下载位置续传。
 */
export function decideResume(
  args: VideoResumeDecisionInput
): 'resume' | 'restart' {
  const { existingBytes, metaUrl, requestUrl, hasMeta } = args
  if (!hasMeta || metaUrl === null) {
    return 'restart'
  }
  if (
    typeof existingBytes !== 'number' ||
    !Number.isFinite(existingBytes) ||
    existingBytes <= 0
  ) {
    return 'restart'
  }
  if (metaUrl !== requestUrl) {
    return 'restart'
  }
  return 'resume'
}

/** 口播文本归一化：去空白与中英文标点，便于按字符比较 */
function normalizeCerText(value: string): string {
  return value.replace(WHITESPACE_PATTERN, '').replace(PUNCTUATION_PATTERN, '')
}

/**
 * 计算中文 CER（字错率）：归一化后按字符 Levenshtein 距离除以参考长度。
 * 两者均为空返回 0；参考为空但有识别输出返回 1；输入非法按空串处理。
 */
export function computeCer(reference: string, hypothesis: string): number {
  const ref = Array.from(
    normalizeCerText(typeof reference === 'string' ? reference : '')
  )
  const hyp = Array.from(
    normalizeCerText(typeof hypothesis === 'string' ? hypothesis : '')
  )
  if (ref.length === 0) {
    return hyp.length === 0 ? 0 : 1
  }
  let previous = Array.from({ length: hyp.length + 1 }, (_, index) => index)
  let current = new Array<number>(hyp.length + 1).fill(0)
  for (let row = 1; row <= ref.length; row += 1) {
    current[0] = row
    for (let column = 1; column <= hyp.length; column += 1) {
      const cost = ref[row - 1] === hyp[column - 1] ? 0 : 1
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost
      )
    }
    const swap = previous
    previous = current
    current = swap
  }
  const distance = previous[hyp.length] ?? 0
  return distance / ref.length
}

/** 失败原因中文文案，未知原因回退通用提示 */
export function videoErrorMessage(reason: VideoErrorReason): string {
  return VIDEO_ERROR_MESSAGES[reason] ?? VIDEO_ERROR_MESSAGES.unknown
}

/** 取字符串字段并 trim，非字符串返回空字符串 */
function readTrimmedString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 归一化引擎配置：只接受普通对象与白名单字段，字符串字段 trim；
 * language 仅接受 zh / en / auto，其余回退默认；任何异常返回默认配置。
 */
export function normalizeVideoEngineConfig(raw: unknown): VideoEngineConfig {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ...DEFAULT_VIDEO_ENGINE_CONFIG }
    }
    const record = raw as Record<string, unknown>
    const language =
      typeof record.language === 'string' ? record.language.trim() : ''
    return {
      whisperBinary: readTrimmedString(record, 'whisperBinary'),
      whisperModel: readTrimmedString(record, 'whisperModel'),
      ffmpegPath: readTrimmedString(record, 'ffmpegPath'),
      outputDir: readTrimmedString(record, 'outputDir'),
      language:
        typeof language === 'string' &&
        (ENGINE_LANGUAGES as readonly string[]).includes(language)
          ? (language as VideoEngineLanguage)
          : DEFAULT_VIDEO_ENGINE_CONFIG.language
    }
  } catch {
    return { ...DEFAULT_VIDEO_ENGINE_CONFIG }
  }
}
