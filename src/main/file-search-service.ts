// 主进程文件搜索服务：扫描调度 + 查询 + 预览 / 打开 / 路径安全校验
import { promises as fs } from 'node:fs'
import { statSync, type Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { shell } from 'electron'
import {
  AUDIO_EXTENSIONS,
  BINARY_SNIFF_BYTES,
  FILE_KINDS,
  IMAGE_EXTENSIONS,
  MAX_RESULTS,
  MAX_TEXT_PREVIEW_BYTES,
  RESCAN_INTERVAL_MS,
  VIDEO_EXTENSIONS,
  fileExtensionOf,
  fileKindOf,
  type FileActionResult,
  type FileEntry,
  type FileKind,
  type FileKindFilter,
  type FilePreview,
  type FilePreviewResult,
  type FileScanProgress,
  type FileSearchResult,
  type FileSearchState
} from '../shared/files'
import type { FileIndexStore } from './file-index-store'
import { scanRoots } from './file-scanner'
import { toAppFileUrl } from './file-protocol'

/** 每批写入索引的条目数 */
const SCAN_BATCH_SIZE = 500

/** 支持文本预览的扩展名（代码类另由 kind === 'code' 覆盖） */
const TEXT_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt',
  'md',
  'csv',
  'log',
  'ini',
  'conf',
  'env',
  'htm',
  'html',
  'xml'
])

/** Windows / macOS 文件系统通常不区分大小写，去重时忽略大小写 */
const CASE_INSENSITIVE_PATHS =
  process.platform === 'win32' || process.platform === 'darwin'

/** 生成目录比较用的键 */
function rootKey(root: string): string {
  return CASE_INSENSITIVE_PATHS ? root.toLowerCase() : root
}

/** 各类型计数为 0 的初始结构 */
function emptyCounts(): Record<FileKind, number> {
  const counts = {} as Record<FileKind, number>
  for (const kind of FILE_KINDS) {
    counts[kind] = 0
  }
  return counts
}

/** 空关键词对应的空结果，不查库 */
function emptyResult(): FileSearchResult {
  return { entries: [], total: 0, tookMs: 0, counts: emptyCounts() }
}

/** 归一化类型筛选：非法值回退 all */
function normalizeKind(value: unknown): FileKindFilter {
  if (typeof value !== 'string') {
    return 'all'
  }
  if (value === 'all') {
    return 'all'
  }
  if ((FILE_KINDS as readonly string[]).includes(value)) {
    return value as FileKind
  }
  return 'all'
}

/** 判断 target 是否位于 root 内（相等或子路径），排除 .. 逃逸 */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 由绝对路径与 stat 结果构造索引条目 */
function entryOf(target: string, stats: Stats): FileEntry {
  const name = basename(target)
  return {
    path: target,
    name,
    dir: dirname(target),
    extension: fileExtensionOf(name),
    kind: fileKindOf(name),
    size: stats.size,
    modifiedAt: Math.round(stats.mtimeMs)
  }
}

/** 从指定位置读满 length 字节，遇到 EOF 提前返回实际内容 */
async function readBytes(handle: FileHandle, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, offset)
    if (result.bytesRead <= 0) {
      break
    }
    offset += result.bytesRead
  }
  return offset === length ? buffer : buffer.subarray(0, offset)
}

/** 预览构建结果：要么给出内容，要么给出错误文案 */
interface PreviewOutcome {
  preview?: FilePreview
  error?: string
}

/**
 * 读取文本预览：先嗅探前 8 KB 是否含空字节判定二进制，
 * 再读取不超过 200 KB 内容，超出上限时标记 truncated。
 */
async function readTextPreview(
  filePath: string,
  size: number
): Promise<PreviewOutcome> {
  let handle: FileHandle
  try {
    handle = await fs.open(filePath, 'r')
  } catch {
    return { error: '读取文件失败' }
  }
  try {
    const sniff = await readBytes(handle, Math.min(size, BINARY_SNIFF_BYTES))
    // 前 8 KB 出现空字节：按二进制处理，不做文本渲染
    if (sniff.includes(0)) {
      return { preview: { type: 'unsupported' } }
    }
    const content = await readBytes(
      handle,
      Math.min(size, MAX_TEXT_PREVIEW_BYTES)
    )
    return {
      preview: {
        type: 'text',
        content: content.toString('utf-8'),
        truncated: size > MAX_TEXT_PREVIEW_BYTES
      }
    }
  } catch {
    return { error: '读取文件失败' }
  } finally {
    try {
      await handle.close()
    } catch {
      // 关闭句柄失败不影响已读取内容
    }
  }
}

/** 路径校验通过后的目标信息 */
type ResolvedTarget =
  { ok: true; entry: FileEntry } | { ok: false; error: string }

export interface FileSearchServiceOptions {
  store: FileIndexStore
  /** 状态变化 / 扫描进度回调，主进程用于推送到窗口 */
  onStateChanged?: (state: FileSearchState) => void
  onScanProgress?: (progress: FileScanProgress) => void
  /** 注入扫描实现便于测试；默认使用 scanRoots */
  scan?: typeof scanRoots
}

/**
 * 文件搜索服务。
 *
 * 负责扫描调度（同一时刻只跑一轮）、查询归一化、目录维护、
 * 预览 / 打开 / 定位与 `app-file://` 协议依赖的路径安全校验。
 * 所有对外方法都不抛出：失败收敛为状态或中文错误文案。
 */
export class FileSearchService {
  private readonly store: FileIndexStore
  private readonly onStateChanged: (state: FileSearchState) => void
  private readonly onScanProgress: (progress: FileScanProgress) => void
  private readonly scan: typeof scanRoots
  /** 是否正在扫描，同时用于合并重复触发 */
  private scanning = false
  /** 本轮扫描中被移除的目录（已 resolve），用于丢弃飞行中的写入 */
  private cancelledRoots = new Set<string>()
  private scanScanned = 0
  private scanCurrentDir = ''

  constructor(options: FileSearchServiceOptions) {
    this.store = options.store
    this.onStateChanged = options.onStateChanged ?? (() => {})
    this.onScanProgress = options.onScanProgress ?? (() => {})
    this.scan = options.scan ?? scanRoots
  }

  /** 读取当前索引状态副本 */
  getState(): FileSearchState {
    return {
      roots: this.store.getRoots(),
      indexedCount: this.store.getIndexedCount(),
      indexedAt: this.store.getIndexedAt(),
      scanning: this.scanning,
      scanScanned: this.scanScanned,
      scanCurrentDir: this.scanCurrentDir
    }
  }

  /** 推送状态并返回同一份快照 */
  private pushState(): FileSearchState {
    const state = this.getState()
    this.onStateChanged(state)
    return state
  }

  /**
   * 搜索：入参可能是任意脏数据。
   * 空关键词直接返回空结果且不查库；kind 非法回退 all；
   * limit 非正数或非法时取 MAX_RESULTS。
   */
  search(query: unknown): FileSearchResult {
    const record =
      typeof query === 'object' && query !== null
        ? (query as Record<string, unknown>)
        : {}
    const keyword =
      typeof record.keyword === 'string' ? record.keyword.trim() : ''
    if (keyword === '') {
      return emptyResult()
    }
    const kind = normalizeKind(record.kind)
    const limit =
      typeof record.limit === 'number' &&
      Number.isFinite(record.limit) &&
      record.limit > 0
        ? record.limit
        : MAX_RESULTS
    return this.store.search({ keyword, kind, limit })
  }

  /**
   * 添加搜索目录：只接受绝对路径、存在且为目录的条目，
   * 与现有配置去重后保存，随后触发后台扫描。
   */
  addRoots(paths: unknown): FileSearchState {
    const candidates = Array.isArray(paths) ? paths : []
    const existing = this.store.getRoots()
    const seen = new Set(existing.map(rootKey))
    const accepted: string[] = []
    for (const item of candidates) {
      if (typeof item !== 'string') {
        continue
      }
      const trimmed = item.trim()
      if (trimmed === '' || !isAbsolute(trimmed)) {
        continue
      }
      const target = resolve(trimmed)
      let stats: Stats
      try {
        stats = statSync(target)
      } catch {
        // 不存在的路径直接忽略
        continue
      }
      if (!stats.isDirectory()) {
        continue
      }
      const key = rootKey(target)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      accepted.push(target)
    }
    if (accepted.length > 0) {
      this.store.setRoots([...existing, ...accepted])
      this.rescan()
    }
    return this.pushState()
  }

  /**
   * 移除搜索目录：找不到时也安全返回；
   * 索引行由 store 一并删除（含该目录下的路径前缀），不做全量重扫。
   * 扫描进行中移除时记入取消集合，丢弃该目录后续的批次写入。
   */
  removeRoot(root: unknown): FileSearchState {
    if (typeof root !== 'string' || root.trim() === '') {
      return this.pushState()
    }
    const target = resolve(root)
    const match = this.store.getRoots().find((item) => {
      const resolved = resolve(item)
      return rootKey(resolved) === rootKey(target)
    })
    if (match !== undefined) {
      if (this.scanning) {
        this.cancelledRoots.add(resolve(match))
      }
      this.store.removeRoot(match)
    }
    return this.pushState()
  }

  /** 触发后台扫描：立即返回当前状态，扫描中重复触发直接返回现状 */
  rescan(): FileSearchState {
    if (this.scanning) {
      return this.getState()
    }
    this.scanning = true
    this.scanScanned = 0
    this.scanCurrentDir = ''
    this.cancelledRoots.clear()
    const state = this.pushState()
    void this.runScan()
    return state
  }

  /** 启动时按需重建：索引为空或超过 30 分钟且已配置目录才扫描 */
  startIfStale(now?: number): void {
    const at =
      typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
    const indexedAt = this.store.getIndexedAt()
    const roots = this.store.getRoots()
    const stale = indexedAt === null || at - indexedAt >= RESCAN_INTERVAL_MS
    if (roots.length > 0 && stale) {
      this.rescan()
      return
    }
    this.pushState()
  }

  /** 执行一轮扫描；失败只记录日志，不影响搜索与后续触发 */
  private async runScan(): Promise<void> {
    const runToken = Date.now()
    const roots = this.store.getRoots()
    try {
      if (roots.length > 0) {
        await this.scan({
          roots,
          runToken,
          batchSize: SCAN_BATCH_SIZE,
          onBatch: (root, entries) => this.handleBatch(root, entries, runToken),
          onProgress: (progress) => this.handleProgress(progress)
        })
        // 只保留本轮写入的行，清理扫描期间被删除的文件
        for (const root of roots) {
          this.store.finishRun(root, runToken)
        }
      }
      this.store.setIndexedAt(Date.now())
    } catch (error) {
      console.error('文件扫描失败:', error)
    } finally {
      // 兜底清理：扫描中移除的目录可能仍有已写入的行
      this.purgeCancelledRoots()
    }
    this.scanning = false
    this.scanCurrentDir = ''
    this.pushState()
    this.onScanProgress({
      scanned: this.scanScanned,
      currentDir: '',
      done: true
    })
  }

  /** 转发扫描中间进度；结束事件由 runScan 统一发送 */
  private handleProgress(progress: FileScanProgress): void {
    if (progress.done) {
      return
    }
    this.scanScanned = progress.scanned
    this.scanCurrentDir = progress.currentDir
    this.onScanProgress(progress)
  }

  /**
   * 写入一批扫描结果：整批属于已移除目录时直接丢弃，
   * 否则过滤掉位于任一已移除目录内的条目，避免嵌套目录被
   * 其他 root 的批次写回索引。
   */
  private handleBatch(
    root: string,
    entries: FileEntry[],
    runToken: number
  ): void {
    if (entries.length === 0) {
      return
    }
    if (this.isCancelledRoot(resolve(root))) {
      return
    }
    const kept = entries.filter(
      (entry) => !this.isUnderCancelledRoot(resolve(entry.path))
    )
    if (kept.length === 0) {
      return
    }
    this.store.upsertBatch(root, runToken, kept)
  }

  /** 目录自身是否在本轮扫描中被移除（路径比较按平台忽略大小写） */
  private isCancelledRoot(root: string): boolean {
    const key = rootKey(root)
    for (const item of this.cancelledRoots) {
      if (rootKey(item) === key) {
        return true
      }
    }
    return false
  }

  /** 目标路径是否位于任一已移除目录内 */
  private isUnderCancelledRoot(target: string): boolean {
    for (const item of this.cancelledRoots) {
      if (isInside(item, target)) {
        return true
      }
    }
    return false
  }

  /** 扫描结束后按前缀清理已移除目录的残留索引行，并清空集合 */
  private purgeCancelledRoots(): void {
    for (const root of this.cancelledRoots) {
      this.store.purgePathsUnderRoot(root)
    }
    this.cancelledRoots.clear()
  }

  /**
   * 路径安全：必须位于任一已配置目录内；目标存在时再以 realpath
   * 校验，防止符号链接指向目录之外。
   */
  async isPathAllowed(filePath: string): Promise<boolean> {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      return false
    }
    const target = resolve(filePath)
    const roots = this.store.getRoots()
    if (roots.length === 0) {
      return false
    }
    const candidates = roots.filter((root) => isInside(resolve(root), target))
    if (candidates.length === 0) {
      return false
    }
    let realTarget: string
    try {
      realTarget = await fs.realpath(target)
    } catch {
      // 目标不存在：字符串比较已通过
      return true
    }
    for (const root of candidates) {
      try {
        const realRoot = await fs.realpath(resolve(root))
        if (isInside(realRoot, realTarget)) {
          return true
        }
      } catch {
        // root 不存在时跳过该条
      }
    }
    return false
  }

  /** 校验路径并读取 stat，供预览 / 打开 / 定位复用 */
  private async resolveTarget(filePath: unknown): Promise<ResolvedTarget> {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      return { ok: false, error: '文件路径无效' }
    }
    if (!(await this.isPathAllowed(filePath))) {
      return { ok: false, error: '该文件不在搜索目录内' }
    }
    const target = resolve(filePath)
    try {
      const stats = await fs.stat(target)
      if (!stats.isFile()) {
        return { ok: false, error: '文件不存在或已被移动' }
      }
      return { ok: true, entry: entryOf(target, stats) }
    } catch {
      return { ok: false, error: '文件不存在或已被移动' }
    }
  }

  /** 按扩展名 / 类型构造预览内容 */
  private async buildPreview(entry: FileEntry): Promise<PreviewOutcome> {
    const { extension, path } = entry
    if (IMAGE_EXTENSIONS.includes(extension)) {
      return { preview: { type: 'image', url: toAppFileUrl(path) } }
    }
    if (AUDIO_EXTENSIONS.includes(extension)) {
      return { preview: { type: 'audio', url: toAppFileUrl(path) } }
    }
    if (VIDEO_EXTENSIONS.includes(extension)) {
      return { preview: { type: 'video', url: toAppFileUrl(path) } }
    }
    const textCandidate =
      entry.kind === 'code' || TEXT_PREVIEW_EXTENSIONS.has(extension)
    if (!textCandidate) {
      return { preview: { type: 'unsupported' } }
    }
    return readTextPreview(path, entry.size)
  }

  /** 生成预览：先校验路径与文件，再按类型读取内容，异常统一收敛 */
  async preview(filePath: unknown): Promise<FilePreviewResult> {
    const target = await this.resolveTarget(filePath)
    if (!target.ok) {
      return { ok: false, error: target.error }
    }
    const entry = target.entry
    try {
      const outcome = await this.buildPreview(entry)
      if (outcome.error !== undefined) {
        return { ok: false, error: outcome.error }
      }
      if (outcome.preview === undefined) {
        return { ok: false, error: '无法预览该文件' }
      }
      return { ok: true, entry, preview: outcome.preview }
    } catch (error) {
      console.error('读取文件预览失败:', error)
      return { ok: false, error: '无法预览该文件' }
    }
  }

  /** 用系统默认程序打开：同样先做路径与存在校验，不抛出 */
  async openFile(filePath: unknown): Promise<FileActionResult> {
    const target = await this.resolveTarget(filePath)
    if (!target.ok) {
      return { ok: false, error: target.error }
    }
    try {
      const error = await shell.openPath(target.entry.path)
      if (error !== '') {
        return {
          ok: false,
          error: '无法打开该文件，请检查系统默认程序'
        }
      }
      return { ok: true }
    } catch {
      return { ok: false, error: '无法打开该文件，请检查系统默认程序' }
    }
  }

  /** 在系统文件管理器中定位文件，不抛出 */
  async revealFile(filePath: unknown): Promise<FileActionResult> {
    const target = await this.resolveTarget(filePath)
    if (!target.ok) {
      return { ok: false, error: target.error }
    }
    try {
      shell.showItemInFolder(target.entry.path)
      return { ok: true }
    } catch {
      return { ok: false, error: '无法在文件夹中显示该文件' }
    }
  }
}
