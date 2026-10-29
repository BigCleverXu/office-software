import type { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILE_KINDS,
  MAX_RESULTS,
  MAX_TEXT_PREVIEW_BYTES,
  RESCAN_INTERVAL_MS,
  fileExtensionOf,
  fileKindOf,
  type FileEntry,
  type FileKind,
  type FileScanProgress,
  type FileSearchState
} from '../shared/files'
import { closeDatabase, openDatabase } from './database'
import { FileIndexStore } from './file-index-store'
import {
  FileSearchService,
  type FileSearchServiceOptions
} from './file-search-service'
import { toAppFileUrl } from './file-protocol'
import type { FileScanOptions, FileScanSummary } from './file-scanner'

let db: DatabaseSync
let store: FileIndexStore
let root: string
const tempDirs: string[] = []

/** 创建临时目录并登记，供 afterEach 统一清理 */
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

beforeEach(async () => {
  db = openDatabase({ path: ':memory:' })
  store = new FileIndexStore(db)
  root = await makeTempDir('file-search-service-')
})

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true })
  }
  tempDirs.length = 0
  closeDatabase(db)
})

/** 构造服务实例，默认使用注入的 scan 回调 */
function createService(
  overrides: Partial<FileSearchServiceOptions> = {}
): FileSearchService {
  return new FileSearchService({ store, ...overrides })
}

/** 在 root 下按相对路径创建文件，返回绝对路径 */
async function createFile(
  relativePath: string,
  content: string | Buffer = 'x'
): Promise<string> {
  const fullPath = join(root, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
  return fullPath
}

/** 由绝对路径构造索引条目 */
function makeEntry(path: string, modifiedAt = 0, size = 1024): FileEntry {
  const name = basename(path)
  return {
    path,
    name,
    dir: dirname(path),
    extension: fileExtensionOf(name),
    kind: fileKindOf(name),
    size,
    modifiedAt
  }
}

/** 全部类型计数为 0 */
function zeroCounts(): Record<FileKind, number> {
  const counts = {} as Record<FileKind, number>
  for (const kind of FILE_KINDS) {
    counts[kind] = 0
  }
  return counts
}

/** 轮询等待条件成立，避免依赖固定 sleep 时长 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000
): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('等待条件超时')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('FileSearchService.search', () => {
  it('空关键词 / 非字符串关键词返回空结果且不查库', () => {
    const spy = vi.spyOn(store, 'search')
    const service = createService()
    const emptyResult = {
      entries: [],
      total: 0,
      tookMs: 0,
      counts: zeroCounts()
    }

    expect(service.search({ keyword: '   ' })).toEqual(emptyResult)
    expect(service.search('report')).toEqual(emptyResult)
    expect(service.search(null)).toEqual(emptyResult)
    expect(service.search({ keyword: 42 })).toEqual(emptyResult)
    expect(spy).not.toHaveBeenCalled()
  })

  it('非法 kind 回退 all，limit 超限被夹到 MAX_RESULTS', () => {
    const entries = Array.from({ length: 205 }, (_item, index) =>
      makeEntry(join(root, `report-${index}.txt`), index)
    )
    store.upsertBatch(root, 1, entries)
    const service = createService()

    const result = service.search({
      keyword: 'report',
      kind: 'bogus',
      limit: 1000
    })
    expect(result.entries).toHaveLength(MAX_RESULTS)
    expect(result.total).toBe(205)
  })

  it('合法 kind 过滤生效，counts 仍统计全部类型', () => {
    store.upsertBatch(root, 1, [
      makeEntry(join(root, 'report.pdf')),
      makeEntry(join(root, 'report.png')),
      makeEntry(join(root, 'report.txt'))
    ])
    const service = createService()

    const filtered = service.search({ keyword: 'report', kind: 'image' })
    expect(filtered.entries).toHaveLength(1)
    expect(filtered.entries[0].kind).toBe('image')
    expect(filtered.counts.image).toBe(1)
    expect(filtered.counts.document).toBe(2)
  })
})

describe('FileSearchService.addRoots / removeRoot', () => {
  it('忽略非法输入，去重后返回新 roots 并触发扫描', async () => {
    const dirA = join(root, 'docs')
    const dirB = join(root, 'pics')
    await mkdir(dirA, { recursive: true })
    await mkdir(dirB, { recursive: true })
    const filePath = await createFile('single.txt')
    const missing = join(root, 'missing-dir')
    const scan = vi.fn(async (): Promise<FileScanSummary> => ({
      scanned: 0,
      rootCounts: {}
    }))
    const service = createService({ scan })

    const first = service.addRoots([
      dirA,
      dirA,
      filePath,
      missing,
      'relative/dir'
    ])
    expect(first.roots).toEqual([dirA])

    const second = service.addRoots([dirB, dirA])
    expect(second.roots).toEqual([dirA, dirB])

    await waitFor(() => !service.getState().scanning)
    expect(scan).toHaveBeenCalled()
  })

  it('removeRoot 后该目录索引不再出现在搜索结果', () => {
    store.setRoots([root])
    store.upsertBatch(root, 1, [makeEntry(join(root, 'report.txt'))])
    const service = createService()

    expect(service.search({ keyword: 'report' }).total).toBe(1)
    const state = service.removeRoot(root)
    expect(state.roots).toEqual([])
    expect(service.search({ keyword: 'report' }).total).toBe(0)
    expect(service.getState().indexedCount).toBe(0)
  })

  it('removeRoot 传入非字符串或不存在的目录也安全', () => {
    store.setRoots([root])
    const service = createService()
    expect(service.removeRoot(42).roots).toEqual([root])
    expect(service.removeRoot('/not/configured').roots).toEqual([root])
  })
})

describe('FileSearchService.isPathAllowed', () => {
  it('目录内为 true，目录外与 .. 逃逸为 false', async () => {
    const insideFile = await createFile('inside/a.txt')
    const outsideDir = await makeTempDir('file-search-outside-')
    const outsideFile = join(outsideDir, 'b.txt')
    await writeFile(outsideFile, 'x')

    store.setRoots([root])
    const service = createService()

    expect(await service.isPathAllowed(insideFile)).toBe(true)
    expect(await service.isPathAllowed(outsideFile)).toBe(false)
    expect(await service.isPathAllowed(join(root, '..', 'escape.txt'))).toBe(
      false
    )
  })
})

describe('FileSearchService.preview', () => {
  it('目录外与不存在的文件返回错误文案', async () => {
    const outsideDir = await makeTempDir('file-search-outside-')
    const outsideFile = join(outsideDir, 'b.txt')
    await writeFile(outsideFile, 'x')
    store.setRoots([root])
    const service = createService()

    expect(await service.preview(outsideFile)).toEqual({
      ok: false,
      error: '该文件不在搜索目录内'
    })
    expect(await service.preview(join(root, 'missing.txt'))).toEqual({
      ok: false,
      error: '文件不存在或已被移动'
    })
    expect(await service.preview(42)).toEqual({
      ok: false,
      error: '文件路径无效'
    })
  })

  it('大文本截断、二进制嗅探、媒体与不支持类型', async () => {
    const bigPath = await createFile(
      'big.txt',
      Buffer.alloc(MAX_TEXT_PREVIEW_BYTES + 1024, 0x61)
    )
    const binaryPath = await createFile(
      'binary.txt',
      Buffer.from('a\u0000b', 'utf-8')
    )
    const pngPath = await createFile(
      'pic.png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    )
    const mp4Path = await createFile('clip.mp4', Buffer.from([0x00]))
    const mp3Path = await createFile('sound.mp3', Buffer.from([0x00]))
    const pdfPath = await createFile('doc.pdf', Buffer.from('%PDF'))

    store.setRoots([root])
    const service = createService()

    const big = await service.preview(bigPath)
    expect(big.ok).toBe(true)
    expect(big.entry).toMatchObject({
      path: bigPath,
      name: 'big.txt',
      extension: 'txt',
      kind: 'document'
    })
    const bigPreview = big.preview
    expect(bigPreview).toMatchObject({ type: 'text', truncated: true })
    if (bigPreview === undefined || bigPreview.type !== 'text') {
      throw new Error('预期文本预览')
    }
    expect(bigPreview.content.length).toBe(MAX_TEXT_PREVIEW_BYTES)

    const binary = await service.preview(binaryPath)
    expect(binary.ok).toBe(true)
    expect(binary.preview).toEqual({ type: 'unsupported' })

    const image = await service.preview(pngPath)
    expect(image.ok).toBe(true)
    expect(image.preview).toEqual({
      type: 'image',
      url: toAppFileUrl(pngPath)
    })

    const video = await service.preview(mp4Path)
    expect(video.preview).toMatchObject({ type: 'video' })
    expect((await service.preview(mp3Path)).preview).toMatchObject({
      type: 'audio'
    })
    expect((await service.preview(pdfPath)).preview).toEqual({
      type: 'unsupported'
    })
  })

  it('toAppFileUrl 生成 app-file 协议 URL', () => {
    expect(toAppFileUrl('/home/a.png')).toBe('app-file://local/%2Fhome%2Fa.png')
  })
})

describe('FileSearchService 扫描调度', () => {
  it('rescan 写入固定条目、更新 indexedAt 并推送状态', async () => {
    store.setRoots([root])
    const entries = [
      makeEntry(join(root, 'alpha.txt')),
      makeEntry(join(root, 'beta.png'))
    ]
    const states: FileSearchState[] = []
    const progress: FileScanProgress[] = []
    const scan = vi.fn(
      async (options: FileScanOptions): Promise<FileScanSummary> => {
        options.onProgress?.({
          scanned: entries.length,
          currentDir: root,
          done: false
        })
        options.onBatch(root, entries)
        return {
          scanned: entries.length,
          rootCounts: { [root]: entries.length }
        }
      }
    )
    const service = createService({
      scan,
      onStateChanged: (state) => states.push(state),
      onScanProgress: (item) => progress.push(item)
    })

    const initial = service.rescan()
    expect(initial.scanning).toBe(true)
    await waitFor(() => !service.getState().scanning)

    expect(service.getState().indexedCount).toBe(2)
    expect(service.getState().indexedAt).not.toBeNull()
    expect(states.length).toBeGreaterThan(0)
    expect(progress.some((item) => item.done)).toBe(true)
    expect(service.search({ keyword: 'alpha' }).total).toBe(1)
  })

  it('扫描中重复触发被合并为一次扫描', async () => {
    store.setRoots([root])
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scan = vi.fn(async (): Promise<FileScanSummary> => {
      await gate
      return { scanned: 0, rootCounts: {} }
    })
    const service = createService({ scan })

    service.rescan()
    service.rescan()
    expect(scan).toHaveBeenCalledTimes(1)

    release()
    await waitFor(() => !service.getState().scanning)
    expect(scan).toHaveBeenCalledTimes(1)
  })

  it('startIfStale 在索引为空或超过间隔时扫描，刚扫描过不触发', async () => {
    store.setRoots([root])
    const scan = vi.fn(
      async (options: FileScanOptions): Promise<FileScanSummary> => {
        options.onBatch(root, [makeEntry(join(root, 'one.txt'))])
        return { scanned: 1, rootCounts: { [root]: 1 } }
      }
    )
    const service = createService({ scan })

    service.startIfStale()
    await waitFor(() => !service.getState().scanning)
    expect(scan).toHaveBeenCalledTimes(1)

    const indexedAt = service.getState().indexedAt
    expect(indexedAt).not.toBeNull()
    service.startIfStale(Date.now())
    expect(scan).toHaveBeenCalledTimes(1)

    // 超过重建间隔后再次触发
    service.startIfStale((indexedAt ?? 0) + RESCAN_INTERVAL_MS)
    expect(scan).toHaveBeenCalledTimes(2)
    await waitFor(() => !service.getState().scanning)
  })

  it('扫描中移除目录后，该目录的后续批次与索引行都不再写入', async () => {
    const nested = join(root, 'docs')
    await mkdir(nested, { recursive: true })
    store.setRoots([root, nested])

    const first = [
      makeEntry(join(nested, 'report-a.txt')),
      makeEntry(join(nested, 'report-b.txt'))
    ]
    const second = [
      makeEntry(join(nested, 'report-c.txt')),
      makeEntry(join(root, 'keep.txt'))
    ]
    const service = createService({
      scan: async (options: FileScanOptions): Promise<FileScanSummary> => {
        options.onBatch(root, first)
        // 扫描尚未结束时移除嵌套目录
        service.removeRoot(nested)
        options.onBatch(root, second)
        return { scanned: 4, rootCounts: { [root]: 4 } }
      }
    })

    service.rescan()
    await waitFor(() => !service.getState().scanning)

    expect(service.getState().roots).toEqual([root])
    expect(service.search({ keyword: 'report' }).total).toBe(0)
    expect(service.getState().indexedCount).toBe(1)
    expect(service.search({ keyword: 'keep' }).entries[0].path).toBe(
      join(root, 'keep.txt')
    )
  })

  it('使用真实扫描构建索引（集成用例）', async () => {
    await createFile('docs/alpha.txt', 'a')
    await createFile('pics/beta.png', Buffer.from([0x89, 0x50]))
    store.setRoots([root])
    const service = createService()

    service.rescan()
    await waitFor(() => !service.getState().scanning, 10000)

    expect(service.getState().indexedCount).toBe(2)
    expect(
      service.search({ keyword: 'alpha' }).entries.map((entry) => entry.path)
    ).toEqual([join(root, 'docs', 'alpha.txt')])
  })
})
