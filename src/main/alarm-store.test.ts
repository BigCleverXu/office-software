import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AlarmDraft } from '../shared/types'
import { AlarmStore } from './alarm-store'
import { closeDatabase, openDatabase } from './database'

const MINUTE = 60_000
const HOUR = 3_600_000

let db: DatabaseSync
let store: AlarmStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new AlarmStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 构造一份提醒草稿，默认单次提醒 */
function makeDraft(overrides: Partial<AlarmDraft> = {}): AlarmDraft {
  return {
    label: '提醒',
    time: '08:00',
    repeat: 'none',
    weekdays: [],
    intervalValue: 0,
    intervalUnit: 'minutes',
    enabled: true,
    ...overrides
  }
}

describe('AlarmStore.create', () => {
  it('返回完整的提醒对象', () => {
    const alarm = store.create(makeDraft({ weekdays: [2, 4] }))

    expect(alarm.id).toBeTruthy()
    expect(typeof alarm.createdAt).toBe('number')
    expect(alarm.lastFiredAt).toBeNull()
    expect(alarm.nextFireAt).toBeNull()
    expect(alarm.weekdays).toEqual([2, 4])
    expect(alarm.enabled).toBe(true)
    expect(store.getAll()).toEqual([alarm])
  })

  it('非 interval 提醒的 nextFireAt 为 null', () => {
    const daily = store.create(makeDraft({ repeat: 'daily' }))
    const weekly = store.create(makeDraft({ repeat: 'weekly', weekdays: [1] }))
    const weekdays = store.create(makeDraft({ repeat: 'weekdays' }))

    expect(daily.nextFireAt).toBeNull()
    expect(weekly.nextFireAt).toBeNull()
    expect(weekdays.nextFireAt).toBeNull()
  })
})

describe('AlarmStore interval', () => {
  it('create 设置的 nextFireAt 落在「调用前 + 间隔」区间内', () => {
    const before = Date.now()
    const alarm = store.create(
      makeDraft({ repeat: 'interval', intervalValue: 30 })
    )
    const after = Date.now()

    expect(alarm.nextFireAt).not.toBeNull()
    expect(alarm.nextFireAt).toBeGreaterThanOrEqual(before + 30 * MINUTE)
    expect(alarm.nextFireAt).toBeLessThanOrEqual(after + 30 * MINUTE)
    expect(store.getAll()[0].nextFireAt).toBe(alarm.nextFireAt)
  })

  it('update 按新的间隔单位重算 nextFireAt', () => {
    const created = store.create(
      makeDraft({ repeat: 'interval', intervalValue: 5 })
    )

    const before = Date.now()
    const updated = store.update(
      created.id,
      makeDraft({ repeat: 'interval', intervalValue: 2, intervalUnit: 'hours' })
    )
    const after = Date.now()

    expect(updated).not.toBeNull()
    expect(updated?.nextFireAt).toBeGreaterThanOrEqual(before + 2 * HOUR)
    expect(updated?.nextFireAt).toBeLessThanOrEqual(after + 2 * HOUR)
    expect(store.getAll()[0].nextFireAt).toBe(updated?.nextFireAt)
  })

  it('改为非 interval 后 nextFireAt 变为 null', () => {
    const created = store.create(
      makeDraft({ repeat: 'interval', intervalValue: 5 })
    )
    const updated = store.update(created.id, makeDraft({ repeat: 'daily' }))

    expect(updated?.nextFireAt).toBeNull()
    expect(store.getAll()[0].nextFireAt).toBeNull()
  })
})

describe('AlarmStore.getAll', () => {
  it('按 created_at 升序返回，连续创建顺序与创建顺序一致', () => {
    const first = store.create(makeDraft({ label: '一' }))
    const second = store.create(makeDraft({ label: '二' }))
    const third = store.create(makeDraft({ label: '三' }))

    expect(store.getAll().map((alarm) => alarm.id)).toEqual([
      first.id,
      second.id,
      third.id
    ])
  })
})

describe('AlarmStore.update', () => {
  it('不存在的 id 返回 null', () => {
    expect(store.update('missing', makeDraft())).toBeNull()
    expect(store.getAll()).toEqual([])
  })

  it('更新字段并保留 id 与 createdAt', () => {
    const created = store.create(
      makeDraft({
        label: '旧标题',
        time: '09:00',
        repeat: 'daily'
      })
    )

    const updated = store.update(
      created.id,
      makeDraft({
        label: '新标题',
        time: '10:30',
        repeat: 'weekly',
        weekdays: [1, 5],
        enabled: false
      })
    )

    expect(updated).toMatchObject({
      id: created.id,
      createdAt: created.createdAt,
      label: '新标题',
      time: '10:30',
      repeat: 'weekly',
      enabled: false,
      lastFiredAt: null,
      nextFireAt: null
    })
    expect(updated?.weekdays).toEqual([1, 5])
    expect(store.getAll()).toHaveLength(1)
    expect(store.getAll()[0]).toEqual(updated)
  })
})

describe('AlarmStore.remove', () => {
  it('删除后不再出现，删除不存在的 id 不抛错', () => {
    const keep = store.create(makeDraft({ label: '保留' }))
    const drop = store.create(makeDraft({ label: '删除' }))

    store.remove(drop.id)

    expect(store.getAll().map((alarm) => alarm.id)).toEqual([keep.id])
    expect(() => store.remove('missing')).not.toThrow()
    expect(store.getAll()).toHaveLength(1)
  })
})

describe('AlarmStore.setEnabled', () => {
  it('启用 interval 提醒时重置 nextFireAt', () => {
    const created = store.create(
      makeDraft({
        repeat: 'interval',
        intervalValue: 15,
        enabled: false
      })
    )
    store.markFired(created.id, created.createdAt, 1)
    expect(store.getAll()[0].nextFireAt).toBe(1)

    const before = Date.now()
    const enabled = store.setEnabled(created.id, true)
    const after = Date.now()

    expect(enabled?.enabled).toBe(true)
    expect(enabled?.nextFireAt).toBeGreaterThanOrEqual(before + 15 * MINUTE)
    expect(enabled?.nextFireAt).toBeLessThanOrEqual(after + 15 * MINUTE)
    expect(store.getAll()[0]).toEqual(enabled)
  })

  it('不存在的 id 返回 null', () => {
    expect(store.setEnabled('missing', true)).toBeNull()
    expect(store.setEnabled('missing', false)).toBeNull()
  })
})

describe('AlarmStore.markFired', () => {
  it('写入 lastFiredAt，undefined 保持原 nextFireAt', () => {
    const created = store.create(
      makeDraft({ repeat: 'interval', intervalValue: 5 })
    )

    const fired = store.markFired(created.id, 12345, undefined)

    expect(fired?.lastFiredAt).toBe(12345)
    expect(fired?.nextFireAt).toBe(created.nextFireAt)
    expect(store.getAll()[0]).toMatchObject({
      lastFiredAt: 12345,
      nextFireAt: created.nextFireAt
    })
  })

  it('传入 nextFireAt 时写入新值，传 null 时清空', () => {
    const created = store.create(
      makeDraft({ repeat: 'interval', intervalValue: 5 })
    )

    const advanced = store.markFired(created.id, 23456, 99999)
    expect(advanced?.lastFiredAt).toBe(23456)
    expect(advanced?.nextFireAt).toBe(99999)
    expect(store.getAll()[0].nextFireAt).toBe(99999)

    const cleared = store.markFired(created.id, 34567, null)
    expect(cleared?.lastFiredAt).toBe(34567)
    expect(cleared?.nextFireAt).toBeNull()
    expect(store.getAll()[0].nextFireAt).toBeNull()
  })

  it('不存在的 id 返回 null', () => {
    expect(store.markFired('missing', 1)).toBeNull()
    expect(store.getAll()).toEqual([])
  })
})
