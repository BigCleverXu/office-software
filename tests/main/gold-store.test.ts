import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../../src/main/database'
import { GoldStore } from '../../src/main/gold-store'

let db: DatabaseSync
let store: GoldStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new GoldStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

describe('GoldStore 空库', () => {
  it('无记录时返回未持有', () => {
    expect(store.getHolding()).toEqual({
      grams: 0,
      costPerGram: 0,
      updatedAt: null
    })
  })
})

describe('GoldStore.updateHolding', () => {
  it('写入成功、返回最新持仓并可重新读取', () => {
    const updated = store.updateHolding({ grams: 10, costPerGram: 800 })

    expect(updated).not.toBeNull()
    expect(updated).toMatchObject({ grams: 10, costPerGram: 800 })
    expect(updated?.updatedAt).toBeTypeOf('number')
    expect(updated?.updatedAt).toBeGreaterThan(0)

    expect(store.getHolding()).toEqual(updated)
    // 重新实例化仍能读到同一份数据（已落库）
    expect(new GoldStore(db).getHolding()).toEqual(updated)
  })

  it('重复写入只保留一行，updated_at 随之更新', () => {
    const first = store.updateHolding({ grams: 10, costPerGram: 800 })
    const second = store.updateHolding({ grams: 20, costPerGram: 810 })

    expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0)
    expect(store.getHolding()).toMatchObject({
      grams: 20,
      costPerGram: 810,
      updatedAt: second?.updatedAt
    })

    const row = db
      .prepare('SELECT COUNT(*) AS n FROM gold_holding')
      .get() as unknown as { n: number }
    expect(row.n).toBe(1)
  })

  it('非法值返回 null 且原值不变', () => {
    store.updateHolding({ grams: 10, costPerGram: 800 })

    expect(store.updateHolding({ grams: -1, costPerGram: 800 })).toBeNull()
    expect(store.updateHolding({ grams: 10, costPerGram: -1 })).toBeNull()
    expect(
      store.updateHolding({ grams: Number.NaN, costPerGram: 800 })
    ).toBeNull()
    expect(store.updateHolding({ grams: 1e6 + 1, costPerGram: 800 })).toBeNull()
    expect(store.updateHolding({ grams: 10, costPerGram: 1e6 + 1 })).toBeNull()
    expect(store.updateHolding({ grams: '10', costPerGram: 800 })).toBeNull()
    expect(store.updateHolding(null)).toBeNull()
    expect(store.updateHolding(undefined)).toBeNull()

    expect(store.getHolding()).toMatchObject({ grams: 10, costPerGram: 800 })
  })

  it('读取时对历史脏数据兜底为未持有', () => {
    db.prepare(
      `INSERT OR REPLACE INTO gold_holding (id, grams, cost, updated_at)
       VALUES (1, ?, ?, ?)`
    ).run(-5, 800, 0)

    expect(store.getHolding()).toEqual({
      grams: 0,
      costPerGram: 0,
      updatedAt: null
    })
  })
})
