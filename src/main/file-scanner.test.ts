import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileEntry, FileScanProgress } from '../shared/files'
import { scanRoots } from './file-scanner'
import type { FileScanSummary } from './file-scanner'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'file-scan-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

interface ScanCapture {
  summary: FileScanSummary
  entries: FileEntry[]
  batches: { root: string; size: number }[]
  progress: FileScanProgress[]
}

/** 执行一次扫描并收集回调数据 */
async function runScan(options: {
  roots: string[]
  batchSize?: number
  signal?: AbortSignal
}): Promise<ScanCapture> {
  const entries: FileEntry[] = []
  const batches: { root: string; size: number }[] = []
  const progress: FileScanProgress[] = []
  const summary = await scanRoots({
    roots: options.roots,
    runToken: 1,
    batchSize: options.batchSize,
    signal: options.signal,
    onBatch: (batchRoot, batch) => {
      batches.push({ root: batchRoot, size: batch.length })
      entries.push(...batch)
    },
    onProgress: (item) => {
      progress.push(item)
    }
  })
  return { summary, entries, batches, progress }
}

/** 在 root 下按相对路径创建文件 */
async function createFile(
  relativePath: string,
  content = 'x'
): Promise<string> {
  const fullPath = join(root, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
  return fullPath
}

describe('scanRoots 递归扫描', () => {
  it('递归扫描嵌套目录，文件数与 rootCounts 正确', async () => {
    await createFile('a.txt')
    await createFile('docs/b.md')
    await createFile('docs/deep/c.png')
    await createFile('中文 文件.txt')

    const capture = await runScan({ roots: [root] })

    expect(capture.summary.scanned).toBe(4)
    expect(capture.summary.rootCounts[root]).toBe(4)
    const names = capture.entries.map((entry) => entry.name).sort()
    expect(names).toEqual(['a.txt', 'b.md', 'c.png', '中文 文件.txt'])

    const png = capture.entries.find((entry) => entry.name === 'c.png')
    expect(png).toBeDefined()
    expect(png).toMatchObject({
      path: join(root, 'docs', 'deep', 'c.png'),
      dir: join(root, 'docs', 'deep'),
      extension: 'png',
      kind: 'image'
    })
    expect(png?.size).toBeGreaterThan(0)
    expect(png?.modifiedAt).toBeGreaterThan(0)
  })

  it('跳过 node_modules、版本控制目录与隐藏目录', async () => {
    await createFile('kept.txt')
    await createFile('node_modules/pkg/index.js')
    await createFile('.git/config')
    await createFile('.svn/entries')
    await createFile('.hidden/secret.txt')
    await createFile('.cache/data.bin')
    await createFile('__pycache__/mod.pyc')

    const capture = await runScan({ roots: [root] })

    expect(capture.summary.scanned).toBe(1)
    expect(capture.entries.map((entry) => entry.name)).toEqual(['kept.txt'])
  })

  it('不跟随符号链接（不支持创建时跳过该用例）', async () => {
    await createFile('real/a.txt')
    await createFile('docs/b.txt')

    try {
      await symlink(join(root, 'real'), join(root, 'link-dir'), 'dir')
      await symlink(join(root, 'docs', 'b.txt'), join(root, 'link-file.txt'))
    } catch {
      // Windows 等环境可能无权限创建符号链接
      return
    }

    const capture = await runScan({ roots: [root] })
    expect(capture.summary.scanned).toBe(2)
    expect(capture.entries.some((entry) => entry.path.includes('link-'))).toBe(
      false
    )
  })

  it('不存在的 root 不抛错，汇总为 0', async () => {
    const missing = join(root, 'missing-root')
    const filePath = await createFile('file-root.txt')

    const capture = await runScan({ roots: [missing, filePath] })

    expect(capture.summary.scanned).toBe(0)
    expect(capture.summary.rootCounts[missing]).toBe(0)
    expect(capture.summary.rootCounts[filePath]).toBe(0)
  })
})

describe('scanRoots 回调', () => {
  it('onBatch 按批次回调且条目字段正确', async () => {
    for (let index = 0; index < 5; index += 1) {
      await createFile(`docs/${index}.txt`)
    }

    const capture = await runScan({ roots: [root], batchSize: 2 })

    expect(capture.entries).toHaveLength(5)
    expect(capture.batches.map((batch) => batch.size)).toEqual([2, 2, 1])
    for (const batch of capture.batches) {
      expect(batch.root).toBe(root)
    }
    for (const entry of capture.entries) {
      expect(entry.path.startsWith(root)).toBe(true)
      expect(entry.dir).toBe(join(root, 'docs'))
      expect(entry.extension).toBe('txt')
      expect(entry.kind).toBe('document')
    }
  })

  it('onProgress 每处理一个目录回调，最后一次 done 为 true', async () => {
    await createFile('a.txt')
    await createFile('docs/b.txt')

    const capture = await runScan({ roots: [root] })

    expect(capture.progress.length).toBeGreaterThan(0)
    const last = capture.progress[capture.progress.length - 1]
    expect(last).toEqual({ scanned: 2, currentDir: '', done: true })
    const beforeDone = capture.progress.slice(0, -1)
    expect(beforeDone.every((item) => item.done === false)).toBe(true)
  })
})

describe('scanRoots 取消', () => {
  it('AbortController 取消后正常返回已扫描数量', async () => {
    for (let index = 0; index < 10; index += 1) {
      await createFile(`docs/${index}.txt`)
    }

    const controller = new AbortController()
    let scannedAtAbort = 0
    const summary = await scanRoots({
      roots: [root],
      runToken: 1,
      batchSize: 3,
      signal: controller.signal,
      onBatch: (batchRoot, entries) => {
        expect(batchRoot).toBe(root)
        scannedAtAbort += entries.length
        controller.abort()
      }
    })

    expect(summary.scanned).toBeGreaterThan(0)
    expect(summary.scanned).toBeLessThanOrEqual(10)
    expect(scannedAtAbort).toBeGreaterThan(0)
  })

  it('开始前已取消时不扫描任何文件', async () => {
    await createFile('a.txt')
    const controller = new AbortController()
    controller.abort()

    const summary = await scanRoots({
      roots: [root],
      runToken: 1,
      signal: controller.signal,
      onBatch: () => {}
    })

    expect(summary.scanned).toBe(0)
  })
})
