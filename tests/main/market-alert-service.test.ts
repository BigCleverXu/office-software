import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type {
  MarketId,
  PriceAlert,
  PriceAlertDraft,
  Quote
} from '../../src/shared/market'
import { closeDatabase, openDatabase } from '../../src/main/database'
import { MarketAlertStore } from '../../src/main/market-alert-store'
import { MarketAlertService } from '../../src/main/market-alert-service'

let db: DatabaseSync
let store: MarketAlertStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new MarketAlertStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 构造一条行情，未指定的字段一律为空 / 正常 */
function quoteOf(
  symbol: string,
  price: number | null,
  options: { missing?: boolean; market?: MarketId } = {}
): Quote {
  return {
    symbol,
    code: symbol.replace(/^(sh|sz|us)/i, ''),
    market: options.market ?? 'sh',
    name: '',
    price,
    prevClose: null,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    amount: null,
    quoteTime: null,
    missing: options.missing ?? false
  }
}

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

/** 创建带 spy 的服务；时钟固定为 123456789 */
function createService(): {
  service: MarketAlertService
  onTrigger: Mock
  onChange: Mock
} {
  const onTrigger = vi.fn<(alert: PriceAlert, price: number) => void>()
  const onChange = vi.fn<() => void>()
  const service = new MarketAlertService({
    store,
    onTrigger,
    onChange,
    now: () => 123456789
  })
  return { service, onTrigger, onChange }
}

describe('MarketAlertService above / below 命中', () => {
  it('above 命中时触发一次、通知参数正确并停用提醒', () => {
    const created = store.create(aboveDraft)
    const { service, onTrigger, onChange } = createService()

    const count = service.evaluate([quoteOf('sh600519', 1800)], true)

    expect(count).toBe(1)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    const [alert, price] = onTrigger.mock.calls[0]
    expect(alert.name).toBe('贵州茅台')
    expect(alert.enabled).toBe(false)
    expect(price).toBe(1800)
    expect(onChange).toHaveBeenCalledTimes(1)

    const saved = store.getAll().find((item) => item.id === created.id)
    expect(saved?.enabled).toBe(false)
    expect(saved?.lastTriggeredAt).toBe(123456789)
  })

  it('below 命中时触发一次', () => {
    store.create(belowDraft)
    const { service, onTrigger } = createService()

    const count = service.evaluate([quoteOf('sh600519', 1499.5)], true)

    expect(count).toBe(1)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(onTrigger.mock.calls[0][1]).toBe(1499.5)
  })

  it('above / below 未满足条件时不触发', () => {
    store.create(aboveDraft)
    store.create(belowDraft)
    const { service, onTrigger, onChange } = createService()

    expect(service.evaluate([quoteOf('sh600519', 1700)], true)).toBe(0)
    expect(onTrigger).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('MarketAlertService range 区间判定', () => {
  it('等于下限命中', () => {
    store.create(rangeDraft)
    const { service } = createService()

    expect(service.evaluate([quoteOf('sz000001', 10)], true)).toBe(1)
  })

  it('等于上限命中', () => {
    store.create(rangeDraft)
    const { service } = createService()

    expect(service.evaluate([quoteOf('sz000001', 12)], true)).toBe(1)
  })

  it('区间外（低于下限 / 高于上限）不命中', () => {
    store.create(rangeDraft)
    const { service, onTrigger } = createService()

    expect(service.evaluate([quoteOf('sz000001', 9.99)], true)).toBe(0)
    expect(service.evaluate([quoteOf('sz000001', 12.01)], true)).toBe(0)
    expect(onTrigger).not.toHaveBeenCalled()
  })
})

describe('MarketAlertService 跳过条件', () => {
  it('非交易时段不触发', () => {
    store.create(aboveDraft)
    const { service, onTrigger, onChange } = createService()

    expect(service.evaluate([quoteOf('sh600519', 1900)], false)).toBe(0)
    expect(onTrigger).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('行情缺失或现价为空的标的不触发', () => {
    store.create(aboveDraft)
    const { service, onTrigger } = createService()

    expect(
      service.evaluate([quoteOf('sh600519', 1900, { missing: true })], true)
    ).toBe(0)
    expect(service.evaluate([quoteOf('sh600519', null)], true)).toBe(0)
    // 行情列表中完全没有该标的
    expect(service.evaluate([], true)).toBe(0)
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('已停用的提醒不触发', () => {
    const created = store.create(aboveDraft)
    store.setEnabled(created.id, false)
    const { service, onTrigger } = createService()

    expect(service.evaluate([quoteOf('sh600519', 1900)], true)).toBe(0)
    expect(onTrigger).not.toHaveBeenCalled()
  })
})

describe('MarketAlertService 一次性触发', () => {
  it('同一提醒连续两轮只触发一次', () => {
    store.create(aboveDraft)
    const { service, onTrigger, onChange } = createService()

    expect(service.evaluate([quoteOf('sh600519', 1900)], true)).toBe(1)
    expect(service.evaluate([quoteOf('sh600519', 1900)], true)).toBe(0)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('MarketAlertService 多条同时命中', () => {
  it('计数正确且 onChange 只调用一次', () => {
    store.create(aboveDraft)
    store.create({
      symbol: 'sz000001',
      name: '平安银行',
      kind: 'below',
      threshold: 20,
      rangeLow: null,
      rangeHigh: null
    })
    const { service, onTrigger, onChange } = createService()

    const count = service.evaluate(
      [quoteOf('sh600519', 1900), quoteOf('sz000001', 15, { market: 'sz' })],
      true
    )

    expect(count).toBe(2)
    expect(onTrigger).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(store.getAll().every((alert) => !alert.enabled)).toBe(true)
  })
})
