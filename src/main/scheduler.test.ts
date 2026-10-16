import { describe, expect, it, vi } from 'vitest'
import type { Alarm } from '../shared/types'
import {
  AlarmScheduler,
  fireKey,
  formatHM,
  matchesRepeat,
  shouldFire
} from './scheduler'

function makeAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id: 'test-id',
    label: '测试提醒',
    time: '07:30',
    repeat: 'none',
    weekdays: [],
    intervalValue: 0,
    intervalUnit: 'minutes',
    nextFireAt: null,
    enabled: true,
    createdAt: 0,
    lastFiredAt: null,
    ...overrides
  }
}

// 2026-01-05 是周一；2026-01-04 是周日；2026-01-03 是周六
const monday = new Date(2026, 0, 5, 7, 30)
const tuesday = new Date(2026, 0, 6, 7, 30)
const saturday = new Date(2026, 0, 3, 7, 30)
const sunday = new Date(2026, 0, 4, 7, 30)

describe('formatHM', () => {
  it('补零输出 HH:mm', () => {
    expect(formatHM(new Date(2026, 0, 5, 7, 5))).toBe('07:05')
    expect(formatHM(new Date(2026, 0, 5, 0, 0))).toBe('00:00')
    expect(formatHM(new Date(2026, 0, 5, 23, 9))).toBe('23:09')
  })
})

describe('matchesRepeat', () => {
  it("'none' 任意日期都命中", () => {
    const alarm = makeAlarm({ repeat: 'none' })
    expect(matchesRepeat(alarm, monday)).toBe(true)
    expect(matchesRepeat(alarm, sunday)).toBe(true)
  })

  it("'daily' 任意日期都命中", () => {
    const alarm = makeAlarm({ repeat: 'daily' })
    expect(matchesRepeat(alarm, saturday)).toBe(true)
  })

  it("'weekdays' 仅周一至周五命中", () => {
    const alarm = makeAlarm({ repeat: 'weekdays' })
    expect(matchesRepeat(alarm, monday)).toBe(true)
    expect(matchesRepeat(alarm, tuesday)).toBe(true)
    expect(matchesRepeat(alarm, saturday)).toBe(false)
    expect(matchesRepeat(alarm, sunday)).toBe(false)
  })

  it("'weekly' 仅在选中的星期命中", () => {
    const alarm = makeAlarm({ repeat: 'weekly', weekdays: [1, 3, 5] })
    expect(matchesRepeat(alarm, monday)).toBe(true)
    expect(matchesRepeat(alarm, tuesday)).toBe(false)
    expect(matchesRepeat(alarm, sunday)).toBe(false)
  })

  it("'interval' 对任意日期都命中", () => {
    const alarm = makeAlarm({ repeat: 'interval' })
    expect(matchesRepeat(alarm, monday)).toBe(true)
    expect(matchesRepeat(alarm, sunday)).toBe(true)
  })
})

describe('shouldFire', () => {
  it('时间匹配且启用时返回 true', () => {
    const alarm = makeAlarm({ time: '07:30', repeat: 'daily' })
    expect(shouldFire(alarm, monday)).toBe(true)
  })

  it('时间不匹配时返回 false', () => {
    const alarm = makeAlarm({ time: '08:00', repeat: 'daily' })
    expect(shouldFire(alarm, monday)).toBe(false)
  })

  it('未启用时返回 false', () => {
    const alarm = makeAlarm({ time: '07:30', repeat: 'daily', enabled: false })
    expect(shouldFire(alarm, monday)).toBe(false)
  })

  it('重复规则不命中时返回 false', () => {
    const alarm = makeAlarm({ time: '07:30', repeat: 'weekly', weekdays: [2] })
    expect(shouldFire(alarm, monday)).toBe(false)
  })

  it('间隔提醒到达 nextFireAt 时返回 true', () => {
    const alarm = makeAlarm({
      repeat: 'interval',
      nextFireAt: monday.getTime()
    })
    expect(shouldFire(alarm, monday)).toBe(true)
  })

  it('间隔提醒未到达 nextFireAt 时返回 false', () => {
    const alarm = makeAlarm({
      repeat: 'interval',
      nextFireAt: monday.getTime() + 60_000
    })
    expect(shouldFire(alarm, monday)).toBe(false)
  })

  it('间隔提醒未启用或 nextFireAt 为空时返回 false', () => {
    const disabled = makeAlarm({
      repeat: 'interval',
      nextFireAt: monday.getTime(),
      enabled: false
    })
    const noSchedule = makeAlarm({ repeat: 'interval', nextFireAt: null })
    expect(shouldFire(disabled, monday)).toBe(false)
    expect(shouldFire(noSchedule, monday)).toBe(false)
  })
})

describe('fireKey', () => {
  it('生成 id|YYYY-MM-DD|HH:mm 形式的键', () => {
    const alarm = makeAlarm({ id: 'abc', time: '07:30' })
    expect(fireKey(alarm, monday)).toBe('abc|2026-01-05|07:30')
  })
})

describe('AlarmScheduler', () => {
  it('同一分钟只触发一次', () => {
    const onFire = vi.fn()
    const alarm = makeAlarm({ time: '07:30', repeat: 'daily' })
    const scheduler = new AlarmScheduler(() => [alarm], onFire)

    scheduler.check(monday)
    scheduler.check(monday)

    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith(alarm, monday)
  })

  it('单次(none)提醒在同一分钟内也只触发一次', () => {
    const onFire = vi.fn()
    const alarm = makeAlarm({ time: '07:30', repeat: 'none' })
    const scheduler = new AlarmScheduler(() => [alarm], onFire)

    scheduler.check(monday)
    scheduler.check(new Date(2026, 0, 5, 7, 30, 45))

    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('跨天后同一时刻会重新触发', () => {
    const onFire = vi.fn()
    const alarm = makeAlarm({ time: '07:30', repeat: 'daily' })
    const scheduler = new AlarmScheduler(() => [alarm], onFire)

    scheduler.check(monday)
    scheduler.check(tuesday)

    expect(onFire).toHaveBeenCalledTimes(2)
  })

  it('间隔提醒在同一 nextFireAt 下只触发一次', () => {
    const onFire = vi.fn()
    const alarm = makeAlarm({
      repeat: 'interval',
      nextFireAt: monday.getTime()
    })
    const scheduler = new AlarmScheduler(() => [alarm], onFire)

    scheduler.check(monday)
    scheduler.check(new Date(monday.getTime() + 5000))

    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('间隔提醒 nextFireAt 前移后按周期再次触发', () => {
    const onFire = vi.fn()
    let alarm = makeAlarm({
      repeat: 'interval',
      nextFireAt: monday.getTime()
    })
    const scheduler = new AlarmScheduler(
      () => [alarm],
      (_firedAlarm, firedAt) => {
        alarm = { ...alarm, nextFireAt: firedAt.getTime() + 60_000 }
        onFire(firedAt)
      }
    )

    scheduler.check(monday)
    expect(onFire).toHaveBeenCalledTimes(1)

    scheduler.check(new Date(monday.getTime() + 30_000))
    expect(onFire).toHaveBeenCalledTimes(1)

    scheduler.check(new Date(monday.getTime() + 60_000))
    expect(onFire).toHaveBeenCalledTimes(2)
  })

  it('未启用或时间不匹配时不触发', () => {
    const onFire = vi.fn()
    const disabled = makeAlarm({ time: '07:30', enabled: false })
    const otherTime = makeAlarm({ id: 'b', time: '09:00' })
    const scheduler = new AlarmScheduler(() => [disabled, otherTime], onFire)

    scheduler.check(monday)

    expect(onFire).not.toHaveBeenCalled()
  })

  it('start() 立即检查一次并在间隔内不重复触发', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(monday)
      const onFire = vi.fn()
      const alarm = makeAlarm({ time: '07:30', repeat: 'daily' })
      const scheduler = new AlarmScheduler(() => [alarm], onFire, 15000)

      scheduler.start()
      expect(onFire).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(15000)
      expect(onFire).toHaveBeenCalledTimes(1)

      scheduler.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
