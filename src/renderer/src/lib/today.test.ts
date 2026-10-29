import { describe, expect, it } from 'vitest'
import { msUntilNextMidnight, toDateKey } from './today'

/** 一小时、一天的毫秒数 */
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('toDateKey', () => {
  it('按本地时区输出 YYYY-MM-DD', () => {
    expect(toDateKey(new Date(2026, 9, 29, 10, 30))).toBe('2026-10-29')
  })

  it('月和日补零', () => {
    expect(toDateKey(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05')
  })

  it('零点前后只按本地日期取值', () => {
    expect(toDateKey(new Date(2026, 9, 29, 0, 0, 0, 0))).toBe('2026-10-29')
    expect(toDateKey(new Date(2026, 9, 29, 23, 59, 59, 999))).toBe('2026-10-29')
  })
})

describe('msUntilNextMidnight', () => {
  it('白天返回距离次日零点的毫秒数', () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 29, 10, 30))).toBe(13.5 * HOUR)
  })

  it('23:59:59 距离零点只剩 1 秒', () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 29, 23, 59, 59))).toBe(1000)
  })

  it('零点整返回整整一天', () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 29, 0, 0, 0, 0))).toBe(DAY)
  })

  it('跨月时指向下月 1 日零点', () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 31, 12, 0, 0))).toBe(12 * HOUR)
  })

  it('跨年时指向次年 1 月 1 日零点', () => {
    expect(msUntilNextMidnight(new Date(2026, 11, 31, 18, 0, 0))).toBe(6 * HOUR)
  })

  it('结果始终大于 0', () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 29, 10, 30))).toBeGreaterThan(
      0
    )
  })
})
