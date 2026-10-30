// 文件搜索模块共享契约：类型 + 常量 + 纯函数
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 文件类型 */
export type FileKind =
  | 'folder'
  | 'image'
  | 'document'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'other'

/** 全部文件类型，顺序即类型筛选标签展示顺序 */
export const FILE_KINDS: readonly FileKind[] = [
  'folder',
  'image',
  'document',
  'video',
  'audio',
  'archive',
  'code',
  'other'
]

/** 类型中文名 */
export const FILE_KIND_LABELS: Record<FileKind, string> = {
  folder: '文件夹',
  image: '图片',
  document: '文档',
  video: '视频',
  audio: '音频',
  archive: '压缩包',
  code: '代码',
  other: '其他'
}

/** 「全部」筛选标签文案 */
export const ALL_KIND_LABEL = '全部'

/** 图片扩展名（小写、不含点），主进程预览判定复用 */
export const IMAGE_EXTENSIONS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif'
]

/** 音频扩展名（小写、不含点），主进程预览判定复用 */
export const AUDIO_EXTENSIONS: readonly string[] = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'm4a',
  'wma',
  'opus',
  'mid',
  'midi'
]

/** 视频扩展名（小写、不含点），主进程预览判定复用 */
export const VIDEO_EXTENSIONS: readonly string[] = [
  'mp4',
  'mkv',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'm4v',
  'mpg',
  'mpeg',
  'ts',
  '3gp'
]

/** 文档扩展名 */
const DOCUMENT_EXTENSIONS: readonly string[] = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'md',
  'rtf',
  'odt',
  'ods',
  'odp',
  'epub',
  'pages',
  'numbers',
  'key',
  'wps'
]

/** 压缩包扩展名 */
const ARCHIVE_EXTENSIONS: readonly string[] = [
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'zst',
  'iso',
  'dmg'
]

/** 代码扩展名 */
const CODE_EXTENSIONS: readonly string[] = [
  'js',
  'ts',
  'jsx',
  'tsx',
  'vue',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'cc',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'kt',
  'kts',
  'scala',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'sql',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'xml',
  'toml',
  'ini',
  'conf',
  'env',
  'bat',
  'cmd',
  'lua',
  'r',
  'dart'
]

/** 把一组扩展名批量绑定到同一类型，供查表初始化使用 */
function extensionEntries(
  extensions: readonly string[],
  kind: FileKind
): [string, FileKind][] {
  return extensions.map((extension) => [extension, kind])
}

/** 扩展名到类型的查表，避免每次分类都做线性扫描 */
const KIND_BY_EXTENSION: ReadonlyMap<string, FileKind> = new Map([
  ...extensionEntries(IMAGE_EXTENSIONS, 'image'),
  ...extensionEntries(DOCUMENT_EXTENSIONS, 'document'),
  ...extensionEntries(VIDEO_EXTENSIONS, 'video'),
  ...extensionEntries(AUDIO_EXTENSIONS, 'audio'),
  ...extensionEntries(ARCHIVE_EXTENSIONS, 'archive'),
  ...extensionEntries(CODE_EXTENSIONS, 'code')
])

/**
 * 取文件名扩展名：小写、不含点，无扩展名返回空字符串。
 * 含路径时只看最后一段；多点取最后一个点后的部分（a.tar.gz → gz）。
 * 以点开头的隐藏文件（.env）整体视为无扩展名。
 */
export function fileExtensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

/** 按扩展名判定文件类型，无扩展名或未知扩展名归为 other */
export function fileKindOf(name: string): FileKind {
  return KIND_BY_EXTENSION.get(fileExtensionOf(name)) ?? 'other'
}

/** 单次搜索返回的结果上限 */
export const MAX_RESULTS = 200

/** 文本预览读取的最大字节数（200 KB） */
export const MAX_TEXT_PREVIEW_BYTES = 204800

/** 二进制嗅探读取的字节数（前 8 KB 出现空字节即判定为二进制） */
export const BINARY_SNIFF_BYTES = 8192

/** 距上次扫描超过该间隔时，启动后台重扫（30 分钟） */
export const RESCAN_INTERVAL_MS = 1800000

/** 索引中的一条文件记录 */
export interface FileEntry {
  /** 绝对路径 */
  path: string
  /** 文件名（含扩展名） */
  name: string
  /** 所在目录绝对路径 */
  dir: string
  /** 小写、不含点，无扩展名为空字符串 */
  extension: string
  kind: FileKind
  /** 字节数 */
  size: number
  /** 修改时间戳（毫秒） */
  modifiedAt: number
}

/** 类型筛选：all 表示不限类型 */
export type FileKindFilter = FileKind | 'all'

/** 搜索请求 */
export interface FileSearchQuery {
  keyword: string
  kind?: FileKindFilter
  limit?: number
}

/** 搜索响应 */
export interface FileSearchResult {
  entries: FileEntry[]
  /** 命中总数（不受 limit 限制） */
  total: number
  /** 主进程计时耗时（毫秒） */
  tookMs: number
  /** 各类型命中数量 */
  counts: Record<FileKind, number>
}

/** 索引状态 */
export interface FileSearchState {
  /** 已配置的搜索目录 */
  roots: string[]
  /** 已索引文件数 */
  indexedCount: number
  /** 上次扫描完成时间戳（毫秒），null 表示从未扫描 */
  indexedAt: number | null
  /** 是否正在扫描 */
  scanning: boolean
  /** 当前扫描已处理文件数 */
  scanScanned: number
  /** 当前扫描所在目录 */
  scanCurrentDir: string
}

/** 扫描进度事件 */
export interface FileScanProgress {
  scanned: number
  currentDir: string
  /** 本轮扫描是否已结束 */
  done: boolean
}

/** 文件预览内容 */
export type FilePreview =
  | { type: 'image'; url: string }
  | { type: 'audio'; url: string }
  | { type: 'video'; url: string }
  | { type: 'text'; content: string; truncated: boolean }
  | { type: 'unsupported' }

/** 预览响应 */
export interface FilePreviewResult {
  ok: boolean
  entry?: FileEntry
  preview?: FilePreview
  error?: string
}

/** 打开 / 定位等操作响应 */
export interface FileActionResult {
  ok: boolean
  error?: string
}

/** 添加搜索目录（系统选择对话框）响应 */
export interface FileRootsResult {
  canceled: boolean
  roots: string[]
  error?: string
}

/** IPC 通道名称 */
export const FILE_SEARCH_CHANNELS = {
  getState: 'files:get-state',
  search: 'files:search',
  addRoots: 'files:add-roots',
  removeRoot: 'files:remove-root',
  rescan: 'files:rescan',
  preview: 'files:preview',
  open: 'files:open',
  reveal: 'files:reveal',
  stateChanged: 'files:state-changed',
  scanProgress: 'files:scan-progress'
} as const

/** 渲染进程可用的文件搜索 API（由 preload 暴露） */
export interface FileSearchApi {
  getState: () => Promise<FileSearchState>
  search: (query: FileSearchQuery) => Promise<FileSearchResult>
  addRoots: () => Promise<FileRootsResult>
  removeRoot: (root: string) => Promise<FileSearchState>
  rescan: () => Promise<FileSearchState>
  preview: (path: string) => Promise<FilePreviewResult>
  open: (path: string) => Promise<FileActionResult>
  reveal: (path: string) => Promise<FileActionResult>
  onStateChanged: (callback: (state: FileSearchState) => void) => () => void
  onScanProgress: (callback: (progress: FileScanProgress) => void) => () => void
}
