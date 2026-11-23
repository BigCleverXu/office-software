import { describe, expect, it } from 'vitest'
import {
  computeWaterSummary,
  DEFAULT_CUP_ML,
  DEFAULT_WATER_SETTINGS,
  formatDrinkTime,
  formatWaterAmount,
  isValidCupMl,
  localDayRange,
  MAX_CUP_ML,
  MIN_CUP_ML,
  normalizeCupMl,
  WATER_CUP_PRESETS
} from '../../src/shared/water'
import type { WaterRecord } from '../../src/shared/water'

/** 构造一条饮水记录，未指定的字段使用默认值 */
function makeRecord(overrides: Partial<WaterRecord> = {}): WaterRecord {
  return {
    id: 'record-1',
    amountMl: 500,
    drankAt: new Date(2026, 10, 23, 9, 5).getTime(),
    syncedAt: null,
    ...overrides
  }
}

describe('容量常量', () => {
  it('预设为 300 / 500 / 750 / 1000，区间为 50 到 2000', () => {
    expect(WATER_CUP_PRESETS).toEqual([300, 500, 750, 1000])
    expect(MIN_CUP_ML).toBe(50)
    expect(MAX_CUP_ML).toBe(2000)
    expect(DEFAULT_CUP_ML).toBe(500)
    expect(DEFAULT_WATER_SETTINGS).toEqual({ cupMl: 500, updatedAt: null })
  })
})

describe('isValidCupMl', () => {
  it('区间内的整数为合法容量', () => {
    expect(isValidCupMl(50)).toBe(true)
    expect(isValidCupMl(2000)).toBe(true)
    expect(isValidCupMl(300)).toBe(true)
  })

  it('越界、非整数、非数字与非法数值均为不合法', () => {
    expect(isValidCupMl(49)).toBe(false)
    expect(isValidCupMl(2001)).toBe(false)
    expect(isValidCupMl(500.5)).toBe(false)
    expect(isValidCupMl('500')).toBe(false)
    expect(isValidCupMl(Number.NaN)).toBe(false)
    expect(isValidCupMl(null)).toBe(false)
    expect(isValidCupMl(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('normalizeCupMl', () => {
  it('合法容量原样返回', () => {
    expect(normalizeCupMl(650)).toBe(650)
    expect(normalizeCupMl(50)).toBe(50)
  })

  it('非法容量回退为默认 500', () => {
    expect(normalizeCupMl(49)).toBe(500)
    expect(normalizeCupMl(500.5)).toBe(500)
    expect(normalizeCupMl('500')).toBe(500)
    expect(normalizeCupMl(Number.NaN)).toBe(500)
    expect(normalizeCupMl(null)).toBe(500)
  })
})

describe('computeWaterSummary', () => {
  it('空数组返回 0 杯 / 0 ml', () => {
    expect(computeWaterSummary([])).toEqual({ count: 0, totalMl: 0 })
  })

  it('累加杯数与总毫升数', () => {
    const records = [
      makeRecord({ id: 'a', amountMl: 500 }),
      makeRecord({ id: 'b', amountMl: 300 }),
      makeRecord({ id: 'c', amountMl: 500 })
    ]
    expect(computeWaterSummary(records)).toEqual({ count: 3, totalMl: 1300 })
  })

  it('忽略 0、负数与 NaN 的条目', () => {
    const records = [
      makeRecord({ id: 'a', amountMl: 500 }),
      makeRecord({ id: 'b', amountMl: 0 }),
      makeRecord({ id: 'c', amountMl: -100 }),
      makeRecord({ id: 'd', amountMl: Number.NaN }),
      makeRecord({ id: 'e', amountMl: Number.POSITIVE_INFINITY })
    ]
    expect(computeWaterSummary(records)).toEqual({ count: 1, totalMl: 500 })
  })
})

describe('localDayRange', () => {
  it('返回本地自然日的 00:00 到次日 00:00 区间', () => {
    const timestamp = new Date(2026, 10, 23, 15, 30).getTime()
    const range = localDayRange(timestamp)
    expect(range.from).toBe(new Date(2026, 10, 23).getTime())
    expect(range.to).toBe(new Date(2026, 10, 24).getTime())
  })

  it('当天 00:00 的记录属于当天区间', () => {
    const midnight = new Date(2026, 10, 23).getTime()
    const range = localDayRange(midnight)
    expect(range.from).toBe(midnight)
    expect(midnight).toBeGreaterThanOrEqual(range.from)
    expect(midnight).toBeLessThan(range.to)
  })

  it('非法时间戳回退为当前时间且区间合法', () => {
    const range = localDayRange(Number.NaN)
    expect(Number.isFinite(range.from)).toBe(true)
    expect(range.to).toBeGreaterThan(range.from)
  })
})

describe('formatWaterAmount', () => {
  it('四舍五入取整且不带千分位', () => {
    expect(formatWaterAmount(1300)).toBe('1300 ml')
    expect(formatWaterAmount(299.6)).toBe('300 ml')
  })

  it('负数与非法数值按 0 处理', () => {
    expect(formatWaterAmount(-10)).toBe('0 ml')
    expect(formatWaterAmount(Number.NaN)).toBe('0 ml')
    expect(formatWaterAmount(Number.POSITIVE_INFINITY)).toBe('0 ml')
  })
})

describe('formatDrinkTime', () => {
  it('输出本地 HH:mm 且两位补零', () => {
    expect(formatDrinkTime(new Date(2026, 10, 23, 9, 5).getTime())).toBe('09:05')
    expect(formatDrinkTime(new Date(2026, 10, 23, 15, 30).getTime())).toBe(
      '15:30'
    )
  })

  it('非法时间戳返回 --:--', () => {
    expect(formatDrinkTime(Number.NaN)).toBe('--:--')
    expect(formatDrinkTime(Number.POSITIVE_INFINITY)).toBe('--:--')
  })
})
