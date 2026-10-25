import { describe, expect, it } from 'vitest'
import type { DayAlmanac } from './almanac'
import { getDayAlmanac, getLunarLabel } from './almanac'

/** 取断言用的黄历数据，解析失败时直接抛错 */
function loadAlmanac(date: string): DayAlmanac {
  const almanac = getDayAlmanac(date)
  if (!almanac) {
    throw new Error(`无法解析日期 ${date}`)
  }
  return almanac
}

describe('getLunarLabel', () => {
  it('节气优先于其他标签', () => {
    expect(getLunarLabel('2026-10-23')).toBe('霜降')
  })

  it('农历传统节日优先于农历日', () => {
    expect(getLunarLabel('2026-02-17')).toBe('春节')
    expect(getLunarLabel('2026-09-25')).toBe('中秋节')
  })

  it('农历初一回落到月份名', () => {
    expect(getLunarLabel('2026-10-10')).toBe('九月')
  })

  it('普通日期返回农历日', () => {
    expect(getLunarLabel('2026-10-25')).toBe('十六')
  })

  it('非法日期返回空字符串', () => {
    expect(getLunarLabel('2026-13-01')).toBe('')
    expect(getLunarLabel('2026-02-30')).toBe('')
  })
})

describe('getDayAlmanac', () => {
  it('返回公历与农历的组合信息', () => {
    const almanac = loadAlmanac('2026-10-25')

    expect(almanac.date).toBe('2026-10-25')
    expect(almanac.day).toBe(25)
    expect(almanac.weekdayLabel).toBe('周日')
    expect(almanac.lunarFull).toBe('二〇二六年九月十六')
    expect(almanac.ganZhiYear).toBe('丙午')
    expect(almanac.zodiac).toBe('马')
    expect(almanac.yearLabel).toBe('丙午(马)年')
    expect(almanac.shengXiao).toBe('马')
    expect(almanac.xingZuo).toBe('天蝎')
    expect(almanac.weekOfYear).toBe(43)
    expect(almanac.dayOfYear).toBe(298)
    expect(almanac.yueXiang).toBe('既望')
  })

  it('返回节气候与宜忌', () => {
    const almanac = loadAlmanac('2026-10-25')

    expect(almanac.hou).toContain('霜降')
    expect(Array.isArray(almanac.yi)).toBe(true)
    expect(almanac.yi.length).toBeGreaterThan(0)
    expect(Array.isArray(almanac.ji)).toBe(true)
    expect(almanac.ji.length).toBeGreaterThan(0)
  })

  it('返回非空的五神方位', () => {
    const { positions } = loadAlmanac('2026-10-25')

    expect(positions.xi).not.toBe('')
    expect(positions.yangGui).not.toBe('')
    expect(positions.yinGui).not.toBe('')
    expect(positions.fu).not.toBe('')
    expect(positions.cai).not.toBe('')
  })

  it('非法日期返回 null', () => {
    expect(getDayAlmanac('2026-13-01')).toBeNull()
    expect(getDayAlmanac('2026-02-30')).toBeNull()
  })
})
