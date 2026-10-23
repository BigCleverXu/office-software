// 主进程节假日服务：缓存优先 + 后台刷新
// 读取永远同步返回，网络请求在后台进行，成功后通过 onUpdated 通知渲染层
import type { DatabaseSync } from 'node:sqlite'
import {
  isDateOnly,
  type HolidayEntry,
  type HolidayYear
} from '../shared/calendar'
import { getBuiltinHolidays } from '../shared/holidays-2026'
import type { HolidayCacheRow } from './database'
import { fetchHolidayYear, type HolidayFetchResult } from './holiday-provider'

/** 缓存有效期：7 天 */
export const HOLIDAY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 最早允许查询的年份 */
const MIN_YEAR = 1900

/** 最晚允许查询的年份 */
const MAX_YEAR = 2100

export interface HolidayServiceOptions {
  db: DatabaseSync
  /** 注入取数实现便于测试，默认 fetchHolidayYear */
  fetchYear?: (year: number) => Promise<HolidayFetchResult>
  /** 注入当前时间便于测试，默认 Date.now */
  now?: () => number
  /** 后台刷新成功后回调，用于向渲染层推送 */
  onUpdated?: (data: HolidayYear) => void
}

/** 判断年份是否为 1900–2100 的整数 */
function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR
}

/**
 * 解析缓存 payload；任一条目非法即视为整体损坏，返回 null。
 * 空数组视为合法缓存（该年份确实没有节假日数据）。
 */
function parseCachedEntries(payload: string): HolidayEntry[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) {
    return null
  }
  const entries: HolidayEntry[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return null
    }
    const record = item as Record<string, unknown>
    const date = record.date
    const name = record.name
    const type = record.type
    if (!isDateOnly(date)) {
      return null
    }
    if (typeof name !== 'string' || name === '') {
      return null
    }
    if (type !== 'holiday' && type !== 'workday') {
      return null
    }
    entries.push({ date, name, type })
  }
  return entries
}

/**
 * 节假日的本地持久化与在线刷新。
 *
 * 数据保存在注入的 SQLite 数据库（`holiday_cache` 表）中，由 database.ts
 * 负责建表；本类只做单表读写。
 */
export class HolidayService {
  private readonly db: DatabaseSync
  private readonly fetchYear: (year: number) => Promise<HolidayFetchResult>
  private readonly now: () => number
  private readonly onUpdated?: (data: HolidayYear) => void
  /** 同一年份的进行中刷新任务，避免并发重复请求 */
  private readonly pending = new Map<number, Promise<void>>()
  private readonly selectCache: ReturnType<DatabaseSync['prepare']>
  private readonly upsertCache: ReturnType<DatabaseSync['prepare']>
  private readonly deleteCache: ReturnType<DatabaseSync['prepare']>

  constructor(options: HolidayServiceOptions) {
    this.db = options.db
    this.fetchYear = options.fetchYear ?? fetchHolidayYear
    this.now = options.now ?? Date.now
    this.onUpdated = options.onUpdated
    this.selectCache = this.db.prepare(
      'SELECT year, payload, fetched_at FROM holiday_cache WHERE year = ?'
    )
    this.upsertCache = this.db.prepare(
      `INSERT OR REPLACE INTO holiday_cache (
        year, payload, fetched_at
      ) VALUES (?, ?, ?)`
    )
    this.deleteCache = this.db.prepare(
      'DELETE FROM holiday_cache WHERE year = ?'
    )
  }

  /** 读取缓存行；不存在返回 null */
  private readCache(year: number): HolidayCacheRow | null {
    const row = this.selectCache.get(year) as unknown as
      HolidayCacheRow | undefined
    return row ?? null
  }

  /** 判断缓存是否仍在有效期内 */
  private isFresh(row: HolidayCacheRow): boolean {
    return this.now() - row.fetched_at <= HOLIDAY_CACHE_TTL_MS
  }

  /**
   * 同步返回某年的节假日数据，绝不等待网络。
   * 缓存过期或缺失时在后台触发刷新。
   */
  getYear(year: number): HolidayYear {
    if (!isValidYear(year)) {
      return { year, entries: [], source: 'none' }
    }
    const row = this.readCache(year)
    if (row) {
      const entries = parseCachedEntries(row.payload)
      if (entries !== null) {
        if (!this.isFresh(row)) {
          void this.refresh(year)
        }
        return { year, entries, source: 'cache' }
      }
      // 缓存损坏：删除该行并按无缓存处理
      this.deleteCache.run(year)
    }
    const builtin = getBuiltinHolidays(year)
    void this.refresh(year)
    return {
      year,
      entries: builtin,
      source: builtin.length > 0 ? 'builtin' : 'none'
    }
  }

  /**
   * 后台刷新指定年份；同一年份并发调用共享同一个 Promise。
   * 缓存仍新鲜时直接返回；失败只记录不抛出、不回调。
   */
  refresh(year: number): Promise<void> {
    const running = this.pending.get(year)
    if (running) {
      return running
    }
    const task = this.runRefresh(year).finally(() => {
      this.pending.delete(year)
    })
    this.pending.set(year, task)
    return task
  }

  /** 实际刷新流程 */
  private async runRefresh(year: number): Promise<void> {
    if (!isValidYear(year)) {
      return
    }
    const row = this.readCache(year)
    if (row && this.isFresh(row)) {
      return
    }
    let result: HolidayFetchResult
    try {
      result = await this.fetchYear(year)
    } catch (error) {
      console.warn(`获取 ${year} 年节假日失败：`, error)
      return
    }
    if (!result.ok) {
      console.warn(
        `获取 ${year} 年节假日失败（${result.reason}），继续使用现有数据`
      )
      return
    }
    try {
      this.upsertCache.run(year, JSON.stringify(result.entries), this.now())
    } catch (error) {
      console.warn(`写入 ${year} 年节假日缓存失败：`, error)
    }
    try {
      this.onUpdated?.({ year, entries: result.entries, source: 'remote' })
    } catch (error) {
      console.warn('推送节假日更新失败：', error)
    }
  }
}
