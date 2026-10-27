import { describe, expect, it } from 'vitest'
import type { FestivalEntry } from './festivals'
import { getYearFestivals } from './festivals'

/** 测试共用的 2026 年条目 */
const ENTRIES_2026 = getYearFestivals(2026)

/** 取指定日期与名称的条目，缺失时直接抛错 */
function loadEntry(date: string, name: string): FestivalEntry {
  const entry = ENTRIES_2026.find(
    (item) => item.date === date && item.name === name
  )
  if (!entry) {
    throw new Error(`缺少条目 ${date} ${name}`)
  }
  return entry
}

describe('getYearFestivals', () => {
  it('2026 年共有 24 个节气条目', () => {
    const terms = ENTRIES_2026.filter((entry) => entry.kind === 'solarTerm')

    expect(terms.length).toBe(24)
  })

  it('元旦节归一化为元旦，并保留农历标签', () => {
    const entry = loadEntry('2026-01-01', '元旦')

    expect(entry.kind).toBe('solarFestival')
    expect(entry.lunarLabel).toBe('冬月十三')
    expect(entry.month).toBe(1)
    expect(entry.day).toBe(1)
    expect(
      ENTRIES_2026.some(
        (item) => item.date === '2026-01-01' && item.name === '元旦节'
      )
    ).toBe(false)
  })

  it('2026-02-04 为立春节气', () => {
    const entry = loadEntry('2026-02-04', '立春')

    expect(entry.kind).toBe('solarTerm')
  })

  it('2026-02-17 为春节', () => {
    const entry = loadEntry('2026-02-17', '春节')

    expect(entry.kind).toBe('lunarFestival')
  })

  it('2026-03-20 同时存在春分与龙头节', () => {
    const chunFen = loadEntry('2026-03-20', '春分')
    const longTou = loadEntry('2026-03-20', '龙头节')

    expect(chunFen.kind).toBe('solarTerm')
    expect(longTou.kind).toBe('lunarFestival')
    expect(ENTRIES_2026.indexOf(chunFen)).toBeLessThan(
      ENTRIES_2026.indexOf(longTou)
    )
  })

  it('2026-12-22 为冬至节气', () => {
    const entry = loadEntry('2026-12-22', '冬至')

    expect(entry.kind).toBe('solarTerm')
  })

  it('不存在重复的日期与名称组合', () => {
    const keys = ENTRIES_2026.map((entry) => `${entry.date}|${entry.name}`)

    expect(new Set(keys).size).toBe(ENTRIES_2026.length)
  })

  it('条目按日期升序排列', () => {
    const dates = ENTRIES_2026.map((entry) => entry.date)

    expect(dates).toEqual([...dates].sort())
  })

  it('非法年份返回空数组', () => {
    expect(getYearFestivals(1800)).toEqual([])
    expect(getYearFestivals(2026.5)).toEqual([])
    expect(getYearFestivals(2101)).toEqual([])
    expect(getYearFestivals(Number.NaN)).toEqual([])
  })

  it('重复调用结果稳定', () => {
    expect(getYearFestivals(2026)).toEqual(ENTRIES_2026)
  })
})
