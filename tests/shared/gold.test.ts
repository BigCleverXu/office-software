import { describe, expect, it } from 'vitest'
import {
  computeGoldSummary,
  DEFAULT_GOLD_HOLDING,
  formatGoldAmount,
  formatGoldPrice,
  formatGrams,
  formatSignedGoldAmount,
  formatUpdatedLabel,
  GOLD_NAMES,
  GOLD_SYMBOLS,
  hasHolding,
  isValidHolding,
  normalizeHolding,
  quoteOf,
  xauCnyPerGram
} from '../../src/shared/gold'
import type { GoldQuote, GoldSnapshot } from '../../src/shared/gold'

/** 构造一条行情，未指定的字段默认为 null / false */
function makeQuote(overrides: Partial<GoldQuote> = {}): GoldQuote {
  return {
    symbol: 'au9999',
    name: '沪金 99',
    price: null,
    prevClose: null,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    quoteTime: null,
    missing: false,
    ...overrides
  }
}

describe('GOLD_SYMBOLS', () => {
  it('顺序为沪金 99 / 伦敦金 / 离岸人民币', () => {
    expect(GOLD_SYMBOLS).toEqual(['au9999', 'xau', 'cnh'])
    expect(GOLD_NAMES.au9999).toBe('沪金 99')
    expect(GOLD_NAMES.xau).toBe('伦敦金')
    expect(GOLD_NAMES.cnh).toBe('离岸人民币')
  })
})

describe('quoteOf', () => {
  it('按 symbol 取行情，不存在返回 null', () => {
    const snapshot: GoldSnapshot = {
      status: 'ok',
      quotes: [makeQuote({ symbol: 'au9999', price: 869 })],
      holding: DEFAULT_GOLD_HOLDING,
      updatedAt: null,
      updatedAtLabel: null,
      failureCount: 0
    }
    expect(quoteOf(snapshot, 'au9999')?.price).toBe(869)
    expect(quoteOf(snapshot, 'xau')).toBeNull()
  })
})

describe('computeGoldSummary', () => {
  it('按规格示例计算今日与累计盈亏', () => {
    const quote = makeQuote({ price: 869, prevClose: 883.42 })
    const summary = computeGoldSummary(quote, {
      grams: 10,
      costPerGram: 800,
      updatedAt: null
    })
    expect(summary.grams).toBe(10)
    expect(summary.totalCost).toBeCloseTo(8000)
    expect(summary.marketValue).toBeCloseTo(8690)
    expect(summary.todayPnl).toBeCloseTo(-144.2)
    expect(summary.totalPnl).toBeCloseTo(690)
    expect(summary.totalPnlPercent).toBeCloseTo(8.625)
    expect(summary.todayPnlPercent).toBeCloseTo((-144.2 / 8834.2) * 100)
  })

  it('现价为 null 时市值与盈亏为 null', () => {
    const summary = computeGoldSummary(makeQuote({ price: null }), {
      grams: 10,
      costPerGram: 800,
      updatedAt: null
    })
    expect(summary.totalCost).toBeCloseTo(8000)
    expect(summary.marketValue).toBeNull()
    expect(summary.todayPnl).toBeNull()
    expect(summary.todayPnlPercent).toBeNull()
    expect(summary.totalPnl).toBeNull()
    expect(summary.totalPnlPercent).toBeNull()
  })

  it('行情缺失（missing）时市值与盈亏为 null', () => {
    const summary = computeGoldSummary(
      makeQuote({ price: 869, prevClose: 883.42, missing: true }),
      { grams: 10, costPerGram: 800, updatedAt: null }
    )
    expect(summary.marketValue).toBeNull()
    expect(summary.todayPnl).toBeNull()
    expect(summary.totalPnl).toBeNull()
    expect(summary.totalPnlPercent).toBeNull()
  })

  it('行情为 null 时市值与盈亏为 null', () => {
    const summary = computeGoldSummary(null, {
      grams: 10,
      costPerGram: 800,
      updatedAt: null
    })
    expect(summary.marketValue).toBeNull()
    expect(summary.todayPnl).toBeNull()
    expect(summary.totalPnl).toBeNull()
    expect(summary.totalPnlPercent).toBeNull()
  })

  it('克数为 0 时除克数外全部为 null', () => {
    const summary = computeGoldSummary(
      makeQuote({ price: 869, prevClose: 883.42 }),
      { grams: 0, costPerGram: 800, updatedAt: null }
    )
    expect(summary).toEqual({
      grams: 0,
      totalCost: null,
      marketValue: null,
      todayPnl: null,
      todayPnlPercent: null,
      totalPnl: null,
      totalPnlPercent: null
    })
  })

  it('成本为 0 时累计盈亏与收益率为 null，市值与今日盈亏仍有值', () => {
    const summary = computeGoldSummary(
      makeQuote({ price: 869, prevClose: 883.42 }),
      { grams: 10, costPerGram: 0, updatedAt: null }
    )
    expect(summary.marketValue).toBeCloseTo(8690)
    expect(summary.todayPnl).toBeCloseTo(-144.2)
    expect(summary.todayPnlPercent).toBeCloseTo((-144.2 / 8834.2) * 100)
    expect(summary.totalPnl).toBeNull()
    expect(summary.totalPnlPercent).toBeNull()
  })

  it('昨收缺失时今日盈亏与今日盈亏率为 null', () => {
    const summary = computeGoldSummary(
      makeQuote({ price: 869, prevClose: null }),
      { grams: 10, costPerGram: 800, updatedAt: null }
    )
    expect(summary.marketValue).toBeCloseTo(8690)
    expect(summary.totalPnl).toBeCloseTo(690)
    expect(summary.todayPnl).toBeNull()
    expect(summary.todayPnlPercent).toBeNull()
  })

  it('不产生 NaN / Infinity', () => {
    const summary = computeGoldSummary(
      makeQuote({ price: Number.POSITIVE_INFINITY, prevClose: 0 }),
      { grams: 10, costPerGram: 800, updatedAt: null }
    )
    for (const value of [
      summary.totalCost,
      summary.marketValue,
      summary.todayPnl,
      summary.todayPnlPercent,
      summary.totalPnl,
      summary.totalPnlPercent
    ]) {
      expect(value === null || Number.isFinite(value)).toBe(true)
    }
  })
})

describe('xauCnyPerGram', () => {
  it('美元金价按汇率折算为人民币每克', () => {
    expect(xauCnyPerGram(4045.5, 6.6742)).toBeCloseTo(868, 0)
    expect(xauCnyPerGram(4045.5, 6.6742) ?? 0).toBeGreaterThan(867.5)
    expect(xauCnyPerGram(4045.5, 6.6742) ?? 0).toBeLessThan(868.5)
  })

  it('任一为 null 或非正数返回 null', () => {
    expect(xauCnyPerGram(null, 6.6742)).toBeNull()
    expect(xauCnyPerGram(4045.5, null)).toBeNull()
    expect(xauCnyPerGram(0, 6.6742)).toBeNull()
    expect(xauCnyPerGram(4045.5, 0)).toBeNull()
    expect(xauCnyPerGram(-1, 6.6742)).toBeNull()
  })
})

describe('持仓校验与规范化', () => {
  it('合法持仓通过校验', () => {
    expect(isValidHolding({ grams: 10, costPerGram: 800 })).toBe(true)
    expect(isValidHolding({ grams: 0, costPerGram: 0 })).toBe(true)
  })

  it('非法持仓不通过校验', () => {
    expect(isValidHolding(null)).toBe(false)
    expect(isValidHolding('10')).toBe(false)
    expect(isValidHolding({ grams: 10 })).toBe(false)
    expect(isValidHolding({ grams: -1, costPerGram: 800 })).toBe(false)
    expect(isValidHolding({ grams: 10, costPerGram: -1 })).toBe(false)
    expect(isValidHolding({ grams: 1e6 + 1, costPerGram: 800 })).toBe(false)
    expect(isValidHolding({ grams: 10, costPerGram: 1e6 + 1 })).toBe(false)
    expect(isValidHolding({ grams: Number.NaN, costPerGram: 800 })).toBe(false)
    expect(
      isValidHolding({ grams: 10, costPerGram: Number.POSITIVE_INFINITY })
    ).toBe(false)
  })

  it('合法持仓保留数值与 updatedAt', () => {
    expect(
      normalizeHolding({ grams: 5.5, costPerGram: 800, updatedAt: 123 })
    ).toEqual({ grams: 5.5, costPerGram: 800, updatedAt: 123 })
  })

  it('缺省 updatedAt 时回退为 null', () => {
    expect(normalizeHolding({ grams: 5, costPerGram: 800 })).toEqual({
      grams: 5,
      costPerGram: 800,
      updatedAt: null
    })
  })

  it('非法或缺失持仓回退为全 0', () => {
    expect(normalizeHolding(undefined)).toEqual({
      grams: 0,
      costPerGram: 0,
      updatedAt: null
    })
    expect(normalizeHolding({ grams: -1, costPerGram: 800 })).toEqual({
      grams: 0,
      costPerGram: 0,
      updatedAt: null
    })
    expect(normalizeHolding('bad')).toEqual({
      grams: 0,
      costPerGram: 0,
      updatedAt: null
    })
  })

  it('hasHolding 仅在克数大于 0 时为 true', () => {
    expect(hasHolding({ grams: 0, costPerGram: 0, updatedAt: null })).toBe(
      false
    )
    expect(hasHolding({ grams: 0.1, costPerGram: 0, updatedAt: null })).toBe(
      true
    )
  })
})

describe('格式化函数', () => {
  it('金价与克数为空显示 --，否则两位小数', () => {
    expect(formatGoldPrice(null)).toBe('--')
    expect(formatGoldPrice(869)).toBe('869.00')
    expect(formatGrams(null)).toBe('--')
    expect(formatGrams(10.5)).toBe('10.50')
  })

  it('金额带千分位，带符号金额区分正负', () => {
    expect(formatGoldAmount(null)).toBe('--')
    expect(formatGoldAmount(8690)).toBe('8,690.00')
    expect(formatSignedGoldAmount(null)).toBe('--')
    expect(formatSignedGoldAmount(690)).toBe('+690.00')
    expect(formatSignedGoldAmount(-144.2)).toBe('-144.20')
  })

  it('时间标签为空返回 null，否则为 HH:mm:ss', () => {
    expect(formatUpdatedLabel(null)).toBeNull()
    expect(formatUpdatedLabel(new Date(2026, 0, 5, 9, 57, 40).getTime())).toBe(
      '09:57:40'
    )
  })
})
