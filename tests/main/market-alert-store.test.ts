import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MarketId, PriceAlertDraft } from '../../src/shared/market'
import {
  closeDatabase,
  openDatabase,
  SCHEMA_VERSION
} from '../../src/main/database'
import { MarketAlertStore } from '../../src/main/market-alert-store'
import { MarketStore } from '../../src/main/market-store'

let db: DatabaseSync
let store: MarketAlertStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new MarketAlertStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

const aboveDraft: PriceAlertDraft = {
  symbol: 'sh600519',
  name: '贵州茅台',
  kind: 'above',
  threshold: 1800,
  rangeLow: null,
  rangeHigh: null
}

const belowDraft: PriceAlertDraft = {
  symbol: 'sh600519',
  name: '贵州茅台',
  kind: 'below',
  threshold: 1500,
  rangeLow: null,
  rangeHigh: null
}

const rangeDraft: PriceAlertDraft = {
  symbol: 'sz000001',
  name: '平安银行',
  kind: 'range',
  threshold: null,
  rangeLow: 10,
  rangeHigh: 12
}

interface WatchInput {
  code: string
  symbol: string
  market: MarketId
  name: string
}

describe('MarketAlertStore 空库', () => {
  it('getAll 为空数组', () => {
    expect(store.getAll()).toEqual([])
  })
})

describe('MarketAlertStore.create', () => {
  it('三种类型字段正确，默认启用且未触发', () => {
    const above = store.create(aboveDraft)
    const below = store.create(belowDraft)
    const range = store.create(rangeDraft)

    expect(above).toMatchObject({
      symbol: 'sh600519',
      name: '贵州茅台',
      kind: 'above',
      threshold: 1800,
      rangeLow: null,
      rangeHigh: null,
      enabled: true,
      lastTriggeredAt: null
    })
    expect(above.id).toBeTruthy()
    expect(typeof above.createdAt).toBe('number')

    expect(below).toMatchObject({
      kind: 'below',
      threshold: 1500,
      rangeLow: null,
      rangeHigh: null,
      enabled: true,
      lastTriggeredAt: null
    })
    expect(typeof below.createdAt).toBe('number')

    expect(range).toMatchObject({
      symbol: 'sz000001',
      kind: 'range',
      threshold: null,
      rangeLow: 10,
      rangeHigh: 12,
      enabled: true,
      lastTriggeredAt: null
    })
    expect(typeof range.createdAt).toBe('number')

    expect(store.getAll()).toHaveLength(3)
  })
})

describe('MarketAlertStore.getBySymbol', () => {
  it('只返回该 symbol 的提醒，按创建顺序返回', () => {
    const first = store.create(aboveDraft)
    store.create(rangeDraft)
    const second = store.create(belowDraft)

    const alerts = store.getBySymbol('sh600519')
    expect(alerts.map((alert) => alert.id)).toEqual([first.id, second.id])
    expect(alerts.every((alert) => alert.symbol === 'sh600519')).toBe(true)
    expect(store.getBySymbol('sh000000')).toEqual([])
  })
})

describe('MarketAlertStore.setEnabled', () => {
  it('切换启用状态并持久化', () => {
    const created = store.create(aboveDraft)

    const disabled = store.setEnabled(created.id, false)
    expect(disabled).toMatchObject({ id: created.id, enabled: false })
    expect(store.getAll()[0].enabled).toBe(false)

    const enabled = store.setEnabled(created.id, true)
    expect(enabled).toMatchObject({ id: created.id, enabled: true })
    expect(store.getAll()[0].enabled).toBe(true)
  })

  it('不存在 id 返回 null 且不写库', () => {
    const created = store.create(aboveDraft)

    expect(store.setEnabled('missing-id', false)).toBeNull()
    expect(store.getAll()).toEqual([created])
  })
})

describe('MarketAlertStore.markTriggered', () => {
  it('写入触发时间并停用提醒', () => {
    const created = store.create(aboveDraft)

    const triggered = store.markTriggered(created.id, 123456789)
    expect(triggered).toMatchObject({
      id: created.id,
      enabled: false,
      lastTriggeredAt: 123456789
    })

    const reloaded = new MarketAlertStore(db).getAll()[0]
    expect(reloaded.enabled).toBe(false)
    expect(reloaded.lastTriggeredAt).toBe(123456789)
  })

  it('不存在 id 返回 null', () => {
    expect(store.markTriggered('missing-id', 123456789)).toBeNull()
  })
})

describe('MarketAlertStore 删除', () => {
  it('remove 只删除指定提醒', () => {
    const first = store.create(aboveDraft)
    const second = store.create(belowDraft)

    store.remove(first.id)

    expect(store.getAll().map((alert) => alert.id)).toEqual([second.id])
  })

  it('removeBySymbol 删除该 symbol 的全部提醒', () => {
    store.create(aboveDraft)
    store.create(belowDraft)
    const other = store.create(rangeDraft)

    store.removeBySymbol('sh600519')

    expect(store.getAll().map((alert) => alert.id)).toEqual([other.id])
  })
})

describe('删除自选股级联删除价格提醒', () => {
  it('removeWatch 清空该 symbol 的提醒并保留其它 symbol', () => {
    const marketStore = new MarketStore(db)
    const maotai: WatchInput = {
      code: '600519',
      symbol: 'sh600519',
      market: 'sh',
      name: '贵州茅台'
    }
    const pingan: WatchInput = {
      code: '000001',
      symbol: 'sz000001',
      market: 'sz',
      name: '平安银行'
    }
    marketStore.addWatch(maotai)
    marketStore.addWatch(pingan)
    store.create(aboveDraft)
    store.create(belowDraft)
    store.create(rangeDraft)

    const remaining = marketStore.removeWatch('sh600519')

    expect(remaining.map((item) => item.symbol)).toEqual(['sz000001'])
    expect(store.getBySymbol('sh600519')).toEqual([])
    expect(store.getBySymbol('sz000001')).toHaveLength(1)
  })
})

describe('行情价格提醒表迁移', () => {
  it('新建库版本号为 13 且 market_alerts 表可查询', () => {
    const versionRow = db.prepare('PRAGMA user_version').get() as unknown as {
      user_version: number
    }

    expect(SCHEMA_VERSION).toBe(13)
    expect(versionRow.user_version).toBe(13)
    expect(() => db.prepare('SELECT * FROM market_alerts').all()).not.toThrow()
    expect(store.getAll()).toEqual([])
  })
})
