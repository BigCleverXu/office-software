import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CalendarEventStore } from '../../src/main/calendar-event-store'
import { closeDatabase, openDatabase } from '../../src/main/database'
import type { WaterRecord } from '../../src/shared/water'

let db: DatabaseSync
let store: CalendarEventStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new CalendarEventStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 构造一条饮水记录，时间按本地时区传入 */
function makeRecord(
  id: string,
  amountMl: number,
  year: number,
  month: number,
  day: number,
  hour = 9,
  minute = 0
): WaterRecord {
  return {
    id,
    amountMl,
    drankAt: new Date(year, month - 1, day, hour, minute, 0).getTime(),
    syncedAt: null
  }
}

describe('CalendarEventStore.upsertWaterRecords', () => {
  it('按记录写入事件并返回新增条数，字段与标题正确', () => {
    const records = [
      makeRecord('w1', 500, 2026, 11, 20),
      makeRecord('w2', 300, 2026, 11, 21)
    ]

    expect(store.upsertWaterRecords(records)).toBe(2)

    const events = store.listByDateRange('2026-11-01', '2026-11-30')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      title: '喝水 500 ml',
      date: '2026-11-20',
      startAt: records[0].drankAt,
      amountMl: 500,
      source: 'water',
      sourceId: 'w1'
    })
    expect(events[1]).toMatchObject({
      title: '喝水 300 ml',
      date: '2026-11-21',
      amountMl: 300,
      sourceId: 'w2'
    })
    expect(events[0].id).toBeTruthy()
    expect(events[0].createdAt).toBeTypeOf('number')
  })

  it('同一批记录重复写入按来源记录去重，返回 0 且总数不变', () => {
    const records = [
      makeRecord('w1', 500, 2026, 11, 20),
      makeRecord('w2', 300, 2026, 11, 21)
    ]

    expect(store.upsertWaterRecords(records)).toBe(2)
    expect(store.upsertWaterRecords(records)).toBe(0)
    expect(store.listByDateRange('2026-11-01', '2026-11-30')).toHaveLength(2)
  })

  it('空数组直接返回 0', () => {
    expect(store.upsertWaterRecords([])).toBe(0)
    expect(store.listByDateRange('2026-11-01', '2026-11-30')).toEqual([])
  })
})

describe('CalendarEventStore.listByDateRange', () => {
  it('按日期升序、同日按开始时间升序返回区间内事件', () => {
    store.upsertWaterRecords([
      makeRecord('w1', 300, 2026, 11, 21, 8, 0),
      makeRecord('w2', 500, 2026, 11, 20, 9, 0),
      makeRecord('w3', 250, 2026, 11, 20, 8, 30)
    ])

    const events = store.listByDateRange('2026-11-01', '2026-11-30')
    expect(events.map((event) => event.sourceId)).toEqual(['w3', 'w2', 'w1'])
  })

  it('区间外事件不返回，闭区间边界包含在内', () => {
    store.upsertWaterRecords([
      makeRecord('w1', 500, 2026, 10, 31),
      makeRecord('w2', 300, 2026, 11, 1),
      makeRecord('w3', 250, 2026, 11, 30),
      makeRecord('w4', 200, 2026, 12, 1)
    ])

    const events = store.listByDateRange('2026-11-01', '2026-11-30')
    expect(events.map((event) => event.sourceId)).toEqual(['w2', 'w3'])
  })

  it('非法区间返回空数组', () => {
    store.upsertWaterRecords([makeRecord('w1', 500, 2026, 11, 20)])

    expect(store.listByDateRange('2026-11-30', '2026-11-01')).toEqual([])
    expect(store.listByDateRange('2026-2-3', '2026-11-30')).toEqual([])
    expect(store.listByDateRange('2026-11-01', '2026-13-01')).toEqual([])
    expect(store.listByDateRange('', '')).toEqual([])
  })
})

describe('CalendarEventStore.removeBySourceIds', () => {
  it('按来源记录 id 删除对应事件并返回删除条数', () => {
    store.upsertWaterRecords([
      makeRecord('w1', 500, 2026, 11, 20),
      makeRecord('w2', 300, 2026, 11, 21)
    ])

    expect(store.removeBySourceIds(['w1'])).toBe(1)
    const events = store.listByDateRange('2026-11-01', '2026-11-30')
    expect(events).toHaveLength(1)
    expect(events[0].sourceId).toBe('w2')
  })

  it('空数组返回 0，未知 id 返回 0', () => {
    store.upsertWaterRecords([makeRecord('w1', 500, 2026, 11, 20)])

    expect(store.removeBySourceIds([])).toBe(0)
    expect(store.removeBySourceIds(['missing'])).toBe(0)
    expect(store.listByDateRange('2026-11-01', '2026-11-30')).toHaveLength(1)
  })
})
