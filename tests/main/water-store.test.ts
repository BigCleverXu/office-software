import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../../src/main/database'
import { WaterStore } from '../../src/main/water-store'
import { DEFAULT_CUP_ML, localDayRange } from '../../src/shared/water'

let db: DatabaseSync
let store: WaterStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new WaterStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 今日基准时间：2026-05-20 15:30（本地时区） */
const TODAY = new Date(2026, 4, 20, 15, 30, 0).getTime()
/** 今日更早的一杯：14:30 */
const EARLIER = new Date(2026, 4, 20, 14, 30, 0).getTime()
/** 昨日同一时刻：2026-05-19 15:30 */
const YESTERDAY = new Date(2026, 4, 19, 15, 30, 0).getTime()

describe('WaterStore 容量设置', () => {
  it('无记录时默认 500ml 且未修改过', () => {
    expect(store.getSettings()).toEqual({
      cupMl: DEFAULT_CUP_ML,
      updatedAt: null
    })
  })

  it('写入合法容量后可重新读取，updatedAt 为正数', () => {
    const saved = store.setCupMl(650)

    expect(saved).not.toBeNull()
    expect(saved?.cupMl).toBe(650)
    expect(saved?.updatedAt).toBeTypeOf('number')
    expect(saved?.updatedAt ?? 0).toBeGreaterThan(0)

    expect(store.getSettings()).toEqual(saved)
    // 已落库：新实例也能读到
    expect(new WaterStore(db).getSettings()).toEqual(saved)
  })

  it('非法容量返回 null 且原值不变', () => {
    store.setCupMl(650)

    expect(store.setCupMl(49)).toBeNull()
    expect(store.setCupMl(2001)).toBeNull()
    expect(store.setCupMl(2000.5)).toBeNull()
    expect(store.setCupMl('500')).toBeNull()
    expect(store.setCupMl(Number.NaN)).toBeNull()

    expect(store.getSettings().cupMl).toBe(650)
  })

  it('读取时对脏容量兜底为默认 500ml', () => {
    db.prepare(
      `INSERT OR REPLACE INTO water_settings (id, cup_ml, updated_at)
       VALUES (1, ?, ?)`
    ).run(-10, 0)

    expect(store.getSettings()).toEqual({
      cupMl: DEFAULT_CUP_ML,
      updatedAt: null
    })
  })
})

describe('WaterStore 记录读写', () => {
  it('新增记录后按时间倒序返回今日区间内的条目', () => {
    const first = store.addCup(500, EARLIER)
    const second = store.addCup(300, TODAY)

    expect(first).toMatchObject({
      amountMl: 500,
      drankAt: EARLIER,
      syncedAt: null
    })
    expect(second).toMatchObject({ amountMl: 300, drankAt: TODAY })

    const range = localDayRange(TODAY)
    const records = store.listRecords(range.from, range.to)
    expect(records).toHaveLength(2)
    expect(records.map((record) => record.amountMl)).toEqual([300, 500])
    expect(records[0].id).toBe(second?.id)
    expect(records[1].id).toBe(first?.id)
  })

  it('非法毫升数返回 null 且不写库', () => {
    expect(store.addCup(49, TODAY)).toBeNull()
    expect(store.addCup(2001, TODAY)).toBeNull()
    expect(store.addCup(2000.5, TODAY)).toBeNull()
    expect(store.addCup(0, TODAY)).toBeNull()

    const range = localDayRange(TODAY)
    expect(store.listRecords(range.from, range.to)).toEqual([])
  })

  it('昨日记录不出现在今日区间', () => {
    store.addCup(500, YESTERDAY)
    store.addCup(300, TODAY)

    const todayRange = localDayRange(TODAY)
    const todayRecords = store.listRecords(todayRange.from, todayRange.to)
    expect(todayRecords).toHaveLength(1)
    expect(todayRecords[0].drankAt).toBe(TODAY)

    const yesterdayRange = localDayRange(YESTERDAY)
    const yesterdayRecords = store.listRecords(
      yesterdayRange.from,
      yesterdayRange.to
    )
    expect(yesterdayRecords).toHaveLength(1)
    expect(yesterdayRecords[0].drankAt).toBe(YESTERDAY)
  })

  it('忽略 amount_ml 非正数的脏行', () => {
    store.addCup(500, TODAY)
    db.prepare(
      `INSERT INTO water_records (
        id, amount_ml, drank_at, synced_at, created_at
      ) VALUES (?, ?, ?, NULL, ?)`
    ).run('dirty', -1, TODAY, TODAY)

    const range = localDayRange(TODAY)
    const records = store.listRecords(range.from, range.to)
    expect(records).toHaveLength(1)
    expect(records[0].id).not.toBe('dirty')
  })
})

describe('WaterStore.removeLast', () => {
  it('删除今日最晚一条并返回该记录，昨日记录保留', () => {
    store.addCup(500, YESTERDAY)
    store.addCup(500, EARLIER)
    const latest = store.addCup(300, TODAY)

    const removed = store.removeLast(TODAY)

    expect(removed).not.toBeNull()
    expect(removed?.id).toBe(latest?.id)
    expect(removed?.amountMl).toBe(300)
    expect(removed?.drankAt).toBe(TODAY)

    const todayRange = localDayRange(TODAY)
    const todayRecords = store.listRecords(todayRange.from, todayRange.to)
    expect(todayRecords).toHaveLength(1)
    expect(todayRecords[0].drankAt).toBe(EARLIER)
    expect(todayRecords[0].id).not.toBe(latest?.id)

    const yesterdayRange = localDayRange(YESTERDAY)
    expect(
      store.listRecords(yesterdayRange.from, yesterdayRange.to)
    ).toHaveLength(1)
  })

  it('今日没有记录时返回 null 且昨日记录保留', () => {
    store.addCup(500, YESTERDAY)

    expect(store.removeLast(TODAY)).toBeNull()

    const yesterdayRange = localDayRange(YESTERDAY)
    expect(
      store.listRecords(yesterdayRange.from, yesterdayRange.to)
    ).toHaveLength(1)
  })
})

describe('WaterStore.markSynced', () => {
  it('标记指定记录已同步，重复调用不覆盖时间戳', () => {
    const first = store.addCup(500, EARLIER)
    const second = store.addCup(300, TODAY)
    const syncedAt = TODAY + 1000

    expect(store.markSynced([first?.id ?? ''], syncedAt)).toBe(1)
    const range = localDayRange(TODAY)
    const records = store.listRecords(range.from, range.to)
    expect(records.find((record) => record.id === first?.id)?.syncedAt).toBe(
      syncedAt
    )
    // 其它记录保持未同步
    expect(
      records.find((record) => record.id === second?.id)?.syncedAt
    ).toBeNull()

    // 再次标记同一记录：不覆盖已有时间戳
    expect(store.markSynced([first?.id ?? ''], syncedAt + 5000)).toBe(0)
    expect(
      store
        .listRecords(range.from, range.to)
        .find((record) => record.id === first?.id)?.syncedAt
    ).toBe(syncedAt)
  })

  it('空数组直接返回 0', () => {
    store.addCup(500, TODAY)
    expect(store.markSynced([], TODAY)).toBe(0)
  })
})
