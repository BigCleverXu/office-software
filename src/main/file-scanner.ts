import { promises as fs } from 'node:fs'
import type { Dir, Stats } from 'node:fs'
import { join } from 'node:path'
import { fileExtensionOf, fileKindOf, type FileEntry } from '../shared/files'

/** 未指定批次大小时每批累积的条目数 */
const DEFAULT_BATCH_SIZE = 200

/** 扫描时直接跳过的目录名（另会跳过所有以 . 开头的隐藏目录） */
const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.cache',
  '$RECYCLE.BIN',
  'System Volume Information'
])

/** 扫描配置 */
export interface FileScanOptions {
  roots: string[]
  runToken: number
  /** 每累积一批（默认 200 条）回调一次 */
  onBatch: (root: string, entries: FileEntry[]) => void
  /** 扫描进度（可选） */
  onProgress?: (progress: {
    scanned: number
    currentDir: string
    done: boolean
  }) => void
  /** 取消信号（可选） */
  signal?: AbortSignal
  batchSize?: number
}

/** 扫描汇总 */
export interface FileScanSummary {
  scanned: number
  rootCounts: Record<string, number>
}

/** 批次大小兜底：非正数或非法值回退默认值 */
function normalizeBatchSize(batchSize: number | undefined): number {
  if (
    typeof batchSize !== 'number' ||
    !Number.isFinite(batchSize) ||
    batchSize <= 0
  ) {
    return DEFAULT_BATCH_SIZE
  }
  return Math.floor(batchSize)
}

/** 判断目录是否应跳过：隐藏目录或常见缓存 / 版本控制目录 */
function isSkippedDir(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIR_NAMES.has(name)
}

/** 读取单个文件的索引信息；stat 失败或非普通文件时返回 null */
async function readFileEntry(
  name: string,
  fullPath: string,
  dirPath: string
): Promise<FileEntry | null> {
  try {
    const stats = await fs.stat(fullPath)
    if (!stats.isFile()) {
      return null
    }
    return {
      path: fullPath,
      name,
      dir: dirPath,
      extension: fileExtensionOf(name),
      kind: fileKindOf(name),
      size: stats.size,
      modifiedAt: Math.round(stats.mtimeMs)
    }
  } catch {
    return null
  }
}

/** 读取单个目录的索引信息；stat 失败时返回 null（仍可继续递归） */
async function readFolderEntry(
  name: string,
  fullPath: string,
  dirPath: string
): Promise<FileEntry | null> {
  try {
    const stats = await fs.stat(fullPath)
    return {
      path: fullPath,
      name,
      dir: dirPath,
      extension: '',
      kind: 'folder',
      size: 0,
      modifiedAt: Math.round(stats.mtimeMs)
    }
  } catch {
    return null
  }
}

/**
 * 递归扫描配置的搜索目录，索引普通文件与子目录（不含根目录自身）。
 *
 * 使用 opendir 流式遍历，跳过隐藏目录、版本控制目录与符号链接；
 * 目录 / 文件读取失败时跳过不抛出；支持 AbortSignal 提前结束。
 */
export async function scanRoots(
  options: FileScanOptions
): Promise<FileScanSummary> {
  const batchSize = normalizeBatchSize(options.batchSize)
  const rootCounts: Record<string, number> = {}
  let scanned = 0
  let batchRoot = ''
  let batch: FileEntry[] = []

  /** 提交当前批次 */
  const flush = (): void => {
    if (batch.length === 0) {
      return
    }
    const root = batchRoot
    const entries = batch
    batch = []
    options.onBatch(root, entries)
  }

  /** 上报进度 */
  const report = (currentDir: string, done: boolean): void => {
    options.onProgress?.({ scanned, currentDir, done })
  }

  /** 追加一条条目，必要时提交批次 */
  const append = (root: string, entry: FileEntry): void => {
    if (batchRoot !== root) {
      flush()
      batchRoot = root
    }
    batch.push(entry)
    scanned += 1
    rootCounts[root] = (rootCounts[root] ?? 0) + 1
    if (batch.length >= batchSize) {
      flush()
    }
  }

  /** 递归扫描单个目录 */
  const scanDir = async (root: string, dirPath: string): Promise<void> => {
    if (options.signal?.aborted) {
      return
    }
    report(dirPath, false)
    let dir: Dir
    try {
      dir = await fs.opendir(dirPath)
    } catch {
      // 无权限、已被删除等：跳过该目录
      return
    }
    try {
      for await (const dirent of dir) {
        if (options.signal?.aborted) {
          break
        }
        if (dirent.isSymbolicLink()) {
          continue
        }
        const fullPath = join(dirPath, dirent.name)
        if (dirent.isDirectory()) {
          if (!isSkippedDir(dirent.name)) {
            const entry = await readFolderEntry(dirent.name, fullPath, dirPath)
            if (entry) {
              append(root, entry)
            }
            // stat 失败时不写入索引，但仍尝试递归其子目录
            await scanDir(root, fullPath)
          }
          continue
        }
        if (!dirent.isFile()) {
          continue
        }
        const entry = await readFileEntry(dirent.name, fullPath, dirPath)
        if (entry) {
          append(root, entry)
        }
      }
    } catch {
      // 遍历途中的异常（如目录被移除）只保留已扫描结果
    }
  }

  for (const root of options.roots) {
    rootCounts[root] = 0
    if (options.signal?.aborted) {
      break
    }
    let stats: Stats
    try {
      stats = await fs.stat(root)
    } catch {
      // root 不存在：跳过
      continue
    }
    if (!stats.isDirectory()) {
      continue
    }
    await scanDir(root, root)
  }

  flush()
  report('', true)
  return { scanned, rootCounts }
}
