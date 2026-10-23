import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HolidayEntry } from '../shared/calendar'
import { closeDatabase, openDatabase } from './database'
import type { HolidayFetchResult } from './holiday-provider'
import { HOLIDAY_CACHE_TTL_MS, HolidayService } from './holiday-service'

/** 固定当前时间，便于精确控制缓存新鲜度 */
const NOW = 1_700_000_000_000

/** 远程返回的数据（与 2026 内置数据不同，便于区分来源） */
const REMOTE_ENTRIES: HolidayEntry[] = [
  { date: '2026-01-01', name: '远程元旦', type: 'holiday' },
  { date: '2026-01-04', name: '远程补班', type: 'workday' }
]

let db: DatabaseSync

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
})

afterEach(() => {
  closeDatabase(db)
})

/** 直接写入一条缓存行，用于构造新鲜 / 过期 / 损坏场景 */
function seedCache(year: number, payload: string, fetchedAt: number): void {
  db.prepare(
    `INSERT INTO holiday_cache (year, payload, fetched_at)
    VALUES (?, ?, ?)`
  ).run(year, payload, fetchedAt)
}

/** 读取缓存行数 */
function countCache(year: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM holiday_cache WHERE year = ?')
    .get(year) as unknown as { n: number }
  return row.n
}

/** 读取缓存写入时间 */
function fetchedAt(year: number): number | null {
  const row = db
    .prepare('SELECT fetched_at FROM holiday_cache WHERE year = ?')
    .get(year) as unknown as { fetched_at: number } | undefined
  return row?.fetched_at ?? null
}

/** 构造总是成功的取数实现 */
function successFetch(
  entries: HolidayEntry[] = REMOTE_ENTRIES
): (year: number) => Promise<HolidayFetchResult> {
  return vi.fn(async (): Promise<HolidayFetchResult> => ({
    ok: true,
    entries
  }))
}

describe('HolidayService.getYear 缓存与内置数据', () => {
  it('无缓存且年份有内置数据时先返回 builtin，刷新后转为 cache', async () => {
    const fetchYear = successFetch()
    const service = new HolidayService({
      db,
      fetchYear,
      now: () => NOW
    })

    const first = service.getYear(2026)

    expect(first.source).toBe('builtin')
    expect(first.entries.length).toBeGreaterThan(0)

    await service.refresh(2026)

    expect(fetchYear).toHaveBeenCalledTimes(1)
    expect(fetchYear).toHaveBeenCalledWith(2026)
    const second = service.getYear(2026)
    expect(second).toEqual({
      year: 2026,
      entries: REMOTE_ENTRIES,
      source: 'cache'
    })
  })

  it('新鲜缓存直接返回 cache，不发请求也不触发 onUpdated', async () => {
    seedCache(2026, JSON.stringify(REMOTE_ENTRIES), NOW - 1000)
    const fetchYear = successFetch()
    const onUpdated = vi.fn()
    const service = new HolidayService({
      db,
      fetchYear,
      now: () => NOW,
      onUpdated
    })

    expect(service.getYear(2026)).toEqual({
      year: 2026,
      entries: REMOTE_ENTRIES,
      source: 'cache'
    })
    await service.refresh(2026)

    expect(fetchYear).not.toHaveBeenCalled()
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('过期缓存先返回旧数据，刷新成功后推送 remote 并更新写入时间', async () => {
    const stale: HolidayEntry[] = [
      { date: '2026-01-01', name: '旧缓存', type: 'holiday' }
    ]
    seedCache(2026, JSON.stringify(stale), NOW - HOLIDAY_CACHE_TTL_MS - 1)
    const fetchYear = successFetch()
    const onUpdated = vi.fn()
    const service = new HolidayService({
      db,
      fetchYear,
      now: () => NOW,
      onUpdated
    })

    expect(service.getYear(2026)).toEqual({
      year: 2026,
      entries: stale,
      source: 'cache'
    })

    await service.refresh(2026)

    expect(onUpdated).toHaveBeenCalledTimes(1)
    expect(onUpdated).toHaveBeenCalledWith({
      year: 2026,
      entries: REMOTE_ENTRIES,
      source: 'remote'
    })
    expect(fetchedAt(2026)).toBe(NOW)
    expect(service.getYear(2026)).toEqual({
      year: 2026,
      entries: REMOTE_ENTRIES,
      source: 'cache'
    })
  })
})

describe('HolidayService.refresh 失败与并发', () => {
  it('刷新失败保留原缓存，不回调也不抛错', async () => {
    const stale: HolidayEntry[] = [
      { date: '2026-01-01', name: '旧缓存', type: 'holiday' }
    ]
    const oldFetchedAt = NOW - HOLIDAY_CACHE_TTL_MS - 1
    seedCache(2026, JSON.stringify(stale), oldFetchedAt)
    const fetchYear = vi.fn(async (): Promise<HolidayFetchResult> => ({
      ok: false,
      reason: 'network'
    }))
    const onUpdated = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = new HolidayService({
      db,
      fetchYear,
      now: () => NOW,
      onUpdated
    })

    expect(service.getYear(2026).source).toBe('cache')
    await expect(service.refresh(2026)).resolves.toBeUndefined()

    expect(onUpdated).not.toHaveBeenCalled()
    expect(fetchedAt(2026)).toBe(oldFetchedAt)
    expect(service.getYear(2026).entries).toEqual(stale)
    // 收敛 getYear 触发的后台刷新，避免 mock 恢复后仍有警告输出
    await service.refresh(2026)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('同一年份并发 refresh 只调用一次 fetchYear', async () => {
    let resolveFetch: (result: HolidayFetchResult) => void = () => undefined
    const fetchYear = vi.fn(
      () =>
        new Promise<HolidayFetchResult>((resolve) => {
          resolveFetch = resolve
        })
    )
    const service = new HolidayService({
      db,
      fetchYear,
      now: () => NOW
    })

    const first = service.refresh(2026)
    const second = service.refresh(2026)

    expect(fetchYear).toHaveBeenCalledTimes(1)
    resolveFetch({ ok: true, entries: REMOTE_ENTRIES })
    await Promise.all([first, second])

    expect(fetchYear).toHaveBeenCalledTimes(1)
    expect(service.getYear(2026).source).toBe('cache')
  })
})

describe('HolidayService 缺失、损坏与非法年份', () => {
  it('无内置数据的年份首次为 none，刷新成功后变为 remote', async () => {
    const fetchYear = successFetch()
    const onUpdated = vi.fn()
    const service = new HolidayService({
      db,
      fetchYear,
      now: () => NOW,
      onUpdated
    })

    expect(service.getYear(2030)).toEqual({
      year: 2030,
      entries: [],
      source: 'none'
    })

    await service.refresh(2030)

    expect(onUpdated).toHaveBeenCalledWith({
      year: 2030,
      entries: REMOTE_ENTRIES,
      source: 'remote'
    })
    expect(service.getYear(2030)).toEqual({
      year: 2030,
      entries: REMOTE_ENTRIES,
      source: 'cache'
    })
  })

  it('损坏缓存按无缓存处理，删除后能被刷新覆盖', async () => {
    seedCache(2026, '{not json', NOW)
    let result: HolidayFetchResult = { ok: false, reason: 'invalid' }
    const fetchYear = vi.fn(async (): Promise<HolidayFetchResult> => result)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = new HolidayService({
      db,
      fetchYear,
      now: () => NOW
    })

    expect(service.getYear(2026).source).toBe('builtin')
    await service.refresh(2026)
    expect(countCache(2026)).toBe(0)

    result = { ok: true, entries: REMOTE_ENTRIES }
    await service.refresh(2026)

    expect(countCache(2026)).toBe(1)
    expect(service.getYear(2026)).toEqual({
      year: 2026,
      entries: REMOTE_ENTRIES,
      source: 'cache'
    })
    warn.mockRestore()
  })

  it('非法年份返回 none 且不发请求', async () => {
    const fetchYear = successFetch()
    const service = new HolidayService({
      db,
      fetchYear,
      now: () => NOW
    })

    for (const year of [0, 1800, 2101, 2026.5]) {
      expect(service.getYear(year)).toEqual({
        year,
        entries: [],
        source: 'none'
      })
    }
    await service.refresh(2026.5)

    expect(fetchYear).not.toHaveBeenCalled()
  })
})
