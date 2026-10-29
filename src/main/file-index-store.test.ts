import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FILE_KINDS,
  fileExtensionOf,
  fileKindOf,
  type FileEntry,
  type FileKind
} from '../shared/files'
import { closeDatabase, openDatabase } from './database'
import { FileIndexStore } from './file-index-store'

/** settings 中目录配置的键名（测试直接写库时使用） */
const ROOTS_KEY = 'file_search_roots'

/** settings 中扫描时间的键名 */
const INDEXED_AT_KEY = 'file_search_indexed_at'

let db: DatabaseSync
let store: FileIndexStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new FileIndexStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 由绝对路径构造一条 FileEntry，name / dir / kind 等一并推导 */
function makeEntry(path: string, modifiedAt = 0, size = 1024): FileEntry {
  const name = path.split('/').pop() ?? path
  const dir = path.slice(0, path.length - name.length - 1)
  return {
    path,
    name,
    dir,
    extension: fileExtensionOf(name),
    kind: fileKindOf(name),
    size,
    modifiedAt
  }
}

/** 全部类型计数为 0 的结果对象 */
function zeroCounts(): Record<FileKind, number> {
  const counts = {} as Record<FileKind, number>
  for (const kind of FILE_KINDS) {
    counts[kind] = 0
  }
  return counts
}

describe('FileIndexStore 写入与搜索', () => {
  it('upsertBatch 写入后可被搜索到，重复写入幂等', () => {
    const entries = [
      makeEntry('/root/docs/report.pdf', 100),
      makeEntry('/root/pics/photo.png', 200)
    ]
    store.upsertBatch('/root', 1, entries)

    const result = store.search({ keyword: 'report' })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      path: '/root/docs/report.pdf',
      name: 'report.pdf',
      dir: '/root/docs',
      extension: 'pdf',
      kind: 'document',
      size: 1024,
      modifiedAt: 100
    })
    expect(result.total).toBe(1)
    expect(store.getIndexedCount()).toBe(2)

    // 同一 path 重复写入不产生重复行
    store.upsertBatch('/root', 2, entries)
    expect(store.getIndexedCount()).toBe(2)
    expect(store.search({ keyword: 'report' }).total).toBe(1)
  })

  it('不区分大小写，且关键词中的通配符按字面匹配', () => {
    store.upsertBatch('/root', 1, [
      makeEntry('/root/Docs/REPORT.pdf'),
      makeEntry('/root/Docs/100%_done.txt')
    ])

    expect(store.search({ keyword: 'report' }).total).toBe(1)
    expect(store.search({ keyword: 'REPORT' }).total).toBe(1)
    // % 与 _ 被转义，只有包含字面 "0%_" 的名称命中
    expect(store.search({ keyword: '0%_' }).total).toBe(1)
    expect(store.search({ keyword: '%' }).total).toBe(1)
    expect(store.search({ keyword: '_' }).total).toBe(1)
  })
})

describe('FileIndexStore.search 排序', () => {
  it('完全匹配 > 前缀匹配 > 包含匹配', () => {
    store.upsertBatch('/root', 1, [
      makeEntry('/root/a/my-report.txt', 300),
      makeEntry('/root/a/report-final.txt', 100),
      makeEntry('/root/a/report', 50)
    ])

    const names = store
      .search({ keyword: 'report' })
      .entries.map((entry) => entry.name)
    expect(names).toEqual(['report', 'report-final.txt', 'my-report.txt'])
  })

  it('同级按修改时间倒序，再按文件名升序', () => {
    store.upsertBatch('/root', 1, [
      makeEntry('/root/a/report-b.txt', 100),
      makeEntry('/root/a/report-a.txt', 200),
      makeEntry('/root/a/report-c.txt', 100)
    ])

    const names = store
      .search({ keyword: 'report' })
      .entries.map((entry) => entry.name)
    expect(names).toEqual(['report-a.txt', 'report-b.txt', 'report-c.txt'])
  })
})

describe('FileIndexStore.search 数量与筛选', () => {
  it('limit 生效但 total 为完整命中数', () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      makeEntry(`/root/report-${index}.txt`, index)
    )
    store.upsertBatch('/root', 1, entries)

    const result = store.search({ keyword: 'report', limit: 2 })
    expect(result.entries).toHaveLength(2)
    expect(result.total).toBe(5)
    expect(result.tookMs).toBeGreaterThanOrEqual(0)
  })

  it('limit 上限不超过 MAX_RESULTS', () => {
    const entries = Array.from({ length: 205 }, (_, index) =>
      makeEntry(`/root/report-${index}.txt`, index)
    )
    store.upsertBatch('/root', 1, entries)

    const result = store.search({ keyword: 'report', limit: 1000 })
    expect(result.entries).toHaveLength(200)
    expect(result.total).toBe(205)
  })

  it('kind 过滤生效，counts 不受过滤影响', () => {
    store.upsertBatch('/root', 1, [
      makeEntry('/root/report.pdf'),
      makeEntry('/root/report.png'),
      makeEntry('/root/report.mp4'),
      makeEntry('/root/report.txt')
    ])

    const filtered = store.search({ keyword: 'report', kind: 'image' })
    expect(filtered.entries).toHaveLength(1)
    expect(filtered.entries[0].kind).toBe('image')
    expect(filtered.total).toBe(1)

    const all = store.search({ keyword: 'report' })
    expect(all.total).toBe(4)
    expect(all.counts).toEqual({
      ...zeroCounts(),
      image: 1,
      document: 2,
      video: 1
    })
  })

  it('空关键词不查询，返回空结果且 counts 全 0', () => {
    store.upsertBatch('/root', 1, [makeEntry('/root/report.pdf')])

    const result = store.search({ keyword: '   ' })
    expect(result.entries).toEqual([])
    expect(result.total).toBe(0)
    expect(result.tookMs).toBe(0)
    expect(result.counts).toEqual(zeroCounts())
  })
})

describe('FileIndexStore 目录配置', () => {
  it('setRoots 去空白、去重并保持顺序，getRoots 往返一致', () => {
    expect(
      store.setRoots([' /data/a ', '/data/b', '/data/a', '  ', '/data/b'])
    ).toEqual(['/data/a', '/data/b'])
    expect(store.getRoots()).toEqual(['/data/a', '/data/b'])
    expect(new FileIndexStore(db).getRoots()).toEqual(['/data/a', '/data/b'])
  })

  it('getRoots 缺失或损坏时返回空数组', () => {
    expect(store.getRoots()).toEqual([])

    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(ROOTS_KEY, 'not-json')
    expect(store.getRoots()).toEqual([])

    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(ROOTS_KEY, '{"a":1}')
    expect(store.getRoots()).toEqual([])
  })

  it('removeRoot 删除该目录索引行并保留其他目录', () => {
    store.setRoots(['/data/a', '/data/b'])
    store.upsertBatch('/data/a', 1, [makeEntry('/data/a/report.pdf')])
    store.upsertBatch('/data/b', 1, [makeEntry('/data/b/report.pdf')])

    expect(store.getIndexedCount()).toBe(2)
    expect(store.removeRoot(' /data/a ')).toEqual(['/data/b'])
    expect(store.getIndexedCount()).toBe(1)
    expect(store.getRoots()).toEqual(['/data/b'])

    const result = store.search({ keyword: 'report' })
    expect(result.entries.map((entry) => entry.path)).toEqual([
      '/data/b/report.pdf'
    ])
  })

  it('removeRoot 同时删除嵌套目录内挂在其他 root 下的索引行', () => {
    const outer = '/data/a'
    const nested = '/data/a/docs'
    store.setRoots([outer, nested])
    store.upsertBatch(outer, 1, [
      makeEntry('/data/a/docs/report.pdf'),
      makeEntry('/data/a/docs/notes.md'),
      makeEntry('/data/a/keep.pdf')
    ])

    expect(store.getIndexedCount()).toBe(3)
    expect(store.search({ keyword: 'report' }).total).toBe(1)

    // 嵌套目录的文件行 root 列为 outer，仍需按路径前缀一并清理
    expect(store.removeRoot(nested)).toEqual([outer])
    expect(store.getIndexedCount()).toBe(1)
    expect(store.search({ keyword: 'report' }).total).toBe(0)
    expect(store.search({ keyword: 'notes' }).total).toBe(0)
    expect(store.search({ keyword: 'keep' }).entries[0].path).toBe(
      '/data/a/keep.pdf'
    )
  })

  it('前缀匹配转义 % 与 _，不会误删相邻目录', () => {
    const target = '/data/100%_dir'
    store.setRoots([target])
    store.upsertBatch(target, 1, [makeEntry('/data/100%_dir/report.pdf')])
    store.upsertBatch('/data/100X_dir', 1, [
      makeEntry('/data/100X_dir/report.pdf')
    ])
    store.upsertBatch('/data/100%Xdir', 1, [
      makeEntry('/data/100%Xdir/report.pdf')
    ])

    expect(store.removeRoot(target)).toEqual([])
    // 若未转义，% 与 _ 会作为通配符误匹配两个相邻目录
    expect(store.getIndexedCount()).toBe(2)
    expect(store.search({ keyword: 'report' }).total).toBe(2)
  })
})

describe('FileIndexStore.finishRun', () => {
  it('只删除该 root 下非本轮 token 的陈旧行', () => {
    store.upsertBatch('/data/a', 1, [
      makeEntry('/data/a/old.pdf'),
      makeEntry('/data/a/kept.pdf')
    ])
    store.upsertBatch('/data/a', 2, [makeEntry('/data/a/kept.pdf')])
    store.upsertBatch('/data/b', 5, [makeEntry('/data/b/other.pdf')])

    expect(store.getIndexedCount()).toBe(3)
    expect(store.finishRun('/data/a', 2)).toBe(1)
    expect(store.getIndexedCount()).toBe(2)
    expect(store.search({ keyword: 'old' }).total).toBe(0)

    const kept = store.search({ keyword: 'kept' }).entries[0]
    expect(kept.path).toBe('/data/a/kept.pdf')
    const other = store.search({ keyword: 'other' }).entries[0]
    expect(other.path).toBe('/data/b/other.pdf')
  })

  it('clearAll 清空全部索引', () => {
    store.upsertBatch('/data/a', 1, [makeEntry('/data/a/report.pdf')])
    expect(store.getIndexedCount()).toBe(1)
    store.clearAll()
    expect(store.getIndexedCount()).toBe(0)
    expect(store.search({ keyword: 'report' }).total).toBe(0)
  })
})

describe('FileIndexStore 扫描时间', () => {
  it('getIndexedAt / setIndexedAt 往返正确', () => {
    expect(store.getIndexedAt()).toBeNull()

    store.setIndexedAt(1700000000000)
    expect(store.getIndexedAt()).toBe(1700000000000)

    store.setIndexedAt(null)
    expect(store.getIndexedAt()).toBeNull()

    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(INDEXED_AT_KEY, 'broken')
    expect(store.getIndexedAt()).toBeNull()
  })
})

describe('FileIndexStore 大数据量搜索', () => {
  it('10 万条索引下搜索耗时不超过 300ms', () => {
    // 纯内存合成数据，不触碰真实文件系统
    const entries: FileEntry[] = []
    for (let index = 0; index < 100000; index += 1) {
      entries.push(makeEntry(`/bulk/file-${index}.pdf`, index))
    }
    store.upsertBatch('/bulk', 1, entries)
    expect(store.getIndexedCount()).toBe(100000)

    // 预热一次，再计时一次
    store.search({ keyword: 'file-1' })
    const result = store.search({ keyword: 'file-1', limit: 200 })
    expect(result.total).toBeGreaterThan(0)
    expect(result.entries).toHaveLength(200)
    console.log(`10 万条索引搜索耗时: ${result.tookMs.toFixed(1)}ms`)
    expect(result.tookMs).toBeLessThan(300)
  }, 20000)
})
