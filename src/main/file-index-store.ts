import type { DatabaseSync } from 'node:sqlite'
import { sep } from 'node:path'
import {
  FILE_KINDS,
  MAX_RESULTS,
  type FileEntry,
  type FileKind,
  type FileSearchQuery,
  type FileSearchResult
} from '../shared/files'
import type { SettingRow } from './database'

/** settings 表中保存搜索目录的键名 */
const ROOTS_KEY = 'file_search_roots'

/** settings 表中保存上次扫描完成时间的键名 */
const INDEXED_AT_KEY = 'file_search_indexed_at'

/** file_index 表行结构 */
interface FileIndexRow {
  path: string
  name: string
  dir: string
  extension: string
  kind: string
  size: number
  modified_at: number
}

/** 按类型分组的命中数量行 */
interface KindCountRow {
  kind: string
  n: number
}

/** COUNT(*) 结果 */
interface CountRow {
  n: number
}

/** 转义 LIKE 通配符，使关键词按字面值参与匹配 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** 去掉结尾的路径分隔符，得到目录自身路径 */
function trimTrailingSep(root: string): string {
  let result = root
  while (result.length > 0 && result.endsWith(sep)) {
    result = result.slice(0, -1)
  }
  return result
}

/**
 * 目录内路径的 LIKE 模式：目录去结尾分隔符后补一个分隔符，
 * 通配符（含 Windows 的 `\`）已转义，再拼 `%` 匹配全部子路径。
 */
function likePathPattern(root: string): string {
  const base = trimTrailingSep(root.trim())
  return `${escapeLike(`${base}${sep}`)}%`
}

/** 判断数据库中的字符串是否为合法文件类型 */
function isFileKind(value: string): value is FileKind {
  return (FILE_KINDS as readonly string[]).includes(value)
}

/** 生成各类型计数为 0 的初始结构 */
function emptyCounts(): Record<FileKind, number> {
  const counts = {} as Record<FileKind, number>
  for (const kind of FILE_KINDS) {
    counts[kind] = 0
  }
  return counts
}

/** file_index 行转为 FileEntry */
function rowToEntry(row: FileIndexRow): FileEntry {
  return {
    path: row.path,
    name: row.name,
    dir: row.dir,
    extension: row.extension,
    kind: isFileKind(row.kind) ? row.kind : 'other',
    size: row.size,
    modifiedAt: row.modified_at
  }
}

/**
 * 文件索引的本地持久化存储。
 *
 * 索引数据保存在 `file_index` 表，搜索目录与上次扫描时间保存在
 * settings 表；数据库由 `openDatabase` 统一创建与关闭。
 */
export class FileIndexStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 读取已配置的搜索目录；缺失或损坏时返回空数组 */
  getRoots(): string[] {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(ROOTS_KEY) as unknown as SettingRow | undefined
    if (!row) {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(row.value)
    } catch {
      return []
    }
    if (!Array.isArray(parsed)) {
      return []
    }
    const roots: string[] = []
    for (const item of parsed) {
      if (typeof item !== 'string') {
        continue
      }
      const root = item.trim()
      if (root !== '' && !roots.includes(root)) {
        roots.push(root)
      }
    }
    return roots
  }

  /** 去空白、去重并按原顺序保存搜索目录，返回规范化结果 */
  setRoots(roots: string[]): string[] {
    const normalized: string[] = []
    for (const item of roots) {
      const root = item.trim()
      if (root !== '' && !normalized.includes(root)) {
        normalized.push(root)
      }
    }
    this.writeSetting(ROOTS_KEY, JSON.stringify(normalized))
    return normalized
  }

  /**
   * 移除某个搜索目录，并删除该目录下全部索引行。
   *
   * 除 root 列精确匹配的行外，同时按路径前缀删除位于该目录内的行，
   * 覆盖嵌套目录被其他 root 扫描写入的情况；一次 DELETE 完成，返回最新 roots。
   */
  removeRoot(root: string): string[] {
    const target = root.trim()
    const next = this.getRoots().filter((item) => item !== target)
    this.setRoots(next)
    if (target === '') {
      this.db.prepare('DELETE FROM file_index WHERE root = ?').run(target)
      return next
    }
    this.db
      .prepare(
        `DELETE FROM file_index WHERE root = ? OR path LIKE ? ESCAPE '\\'`
      )
      .run(target, likePathPattern(target))
    return next
  }

  /** 按路径前缀删除某目录内的索引行，返回删除行数 */
  purgePathsUnderRoot(root: string): number {
    const target = root.trim()
    if (target === '') {
      return 0
    }
    const result = this.db
      .prepare(`DELETE FROM file_index WHERE path LIKE ? ESCAPE '\\'`)
      .run(likePathPattern(target))
    return Number(result.changes)
  }

  /** 已索引文件总数 */
  getIndexedCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM file_index')
      .get() as unknown as CountRow | undefined
    return row?.n ?? 0
  }

  /** 上次扫描完成时间（毫秒），从未扫描或数据损坏时返回 null */
  getIndexedAt(): number | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(INDEXED_AT_KEY) as unknown as SettingRow | undefined
    if (!row) {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(row.value)
    } catch {
      return null
    }
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
  }

  /** 写入扫描完成时间；传 null 表示清除 */
  setIndexedAt(value: number | null): void {
    if (value === null || !Number.isFinite(value)) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(INDEXED_AT_KEY)
      return
    }
    this.writeSetting(INDEXED_AT_KEY, JSON.stringify(value))
  }

  /**
   * 批量写入一轮扫描的索引条目：单事务 INSERT OR REPLACE，
   * 同一 path 重复写入时覆盖旧值，保证幂等。
   */
  upsertBatch(root: string, runToken: number, entries: FileEntry[]): void {
    if (entries.length === 0) {
      return
    }
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO file_index (
        path, root, name, name_lower, dir, extension, kind,
        size, modified_at, run_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    this.db.exec('BEGIN')
    try {
      for (const entry of entries) {
        insert.run(
          entry.path,
          root,
          entry.name,
          entry.name.toLowerCase(),
          entry.dir,
          entry.extension,
          entry.kind,
          entry.size,
          entry.modifiedAt,
          runToken
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * 一轮扫描结束后清理陈旧行：删除该 root 下 run_token
   * 不等于本轮 token 的记录（扫描期间已删除的文件），返回删除行数。
   */
  finishRun(root: string, runToken: number): number {
    const result = this.db
      .prepare('DELETE FROM file_index WHERE root = ? AND run_token != ?')
      .run(root, runToken)
    return Number(result.changes)
  }

  /** 清空全部索引（用于移除全部搜索目录等场景） */
  clearAll(): void {
    this.db.exec('DELETE FROM file_index')
  }

  /**
   * 按关键词搜索索引。
   *
   * 匹配：不区分大小写（name_lower），包含匹配，通配符已转义。
   * 排序：完全匹配 > 前缀匹配 > 包含匹配；同级按修改时间倒序，
   * 再按文件名升序。counts 为同关键词下各类型数量，不受 kind 过滤影响。
   */
  search(query: FileSearchQuery): FileSearchResult {
    const startedAt = performance.now()
    const keyword =
      typeof query.keyword === 'string' ? query.keyword.trim() : ''
    if (keyword === '') {
      return {
        entries: [],
        total: 0,
        tookMs: 0,
        counts: emptyCounts()
      }
    }
    const lowered = keyword.toLowerCase()
    const contains = `%${escapeLike(lowered)}%`
    const prefix = `${escapeLike(lowered)}%`
    const kind = query.kind ?? 'all'
    const filterKind = kind === 'all' ? null : kind
    const requested = query.limit ?? MAX_RESULTS
    const limit = Math.min(
      requested > 0 ? Math.floor(requested) : MAX_RESULTS,
      MAX_RESULTS
    )

    const counts = emptyCounts()
    const kindRows = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS n FROM file_index
        WHERE name_lower LIKE ? ESCAPE '\\'
        GROUP BY kind`
      )
      .all(contains) as unknown as KindCountRow[]
    for (const row of kindRows) {
      if (isFileKind(row.kind)) {
        counts[row.kind] = row.n
      }
    }

    // kind 过滤只影响 total 与结果列表，不影响 counts
    const kindClause = filterKind ? ' AND kind = ?' : ''
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM file_index
        WHERE name_lower LIKE ? ESCAPE '\\'${kindClause}`
      )
      .get(...(filterKind ? [contains, filterKind] : [contains])) as unknown as
      CountRow | undefined
    const total = countRow?.n ?? 0

    const rows = this.db
      .prepare(
        `SELECT path, name, dir, extension, kind, size, modified_at
        FROM file_index
        WHERE name_lower LIKE ? ESCAPE '\\'${kindClause}
        ORDER BY
          CASE
            WHEN name_lower = ? THEN 0
            WHEN name_lower LIKE ? ESCAPE '\\' THEN 1
            ELSE 2
          END ASC,
          modified_at DESC,
          name_lower ASC
        LIMIT ?`
      )
      .all(
        ...(filterKind
          ? [contains, filterKind, lowered, prefix, limit]
          : [contains, lowered, prefix, limit])
      ) as unknown as FileIndexRow[]

    return {
      entries: rows.map((row) => rowToEntry(row)),
      total,
      tookMs: performance.now() - startedAt,
      counts
    }
  }

  /** 写入单个 settings 键值（覆盖旧值） */
  private writeSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, value)
  }
}
