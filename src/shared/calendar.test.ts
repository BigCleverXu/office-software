import { describe, expect, it } from 'vitest'
import {
  buildMonthGrid,
  daysUntil,
  describeCountdown,
  isDateOnly,
  parseDateOnly,
  sortCountdowns
} from './calendar'
import type { Countdown } from './calendar'
import { BUILTIN_HOLIDAYS_2026, getBuiltinHolidays } from './holidays-2026'

/** 构造一条倒计日，便于排序测试 */
function countdown(id: string, date: string): Countdown {
  return { id, title: id, date, createdAt: 0, updatedAt: 0 }
}

/** 固定「今天」：2026-10-23 */
const today = new Date(2026, 9, 23, 15, 30, 45)

describe('isDateOnly', () => {
  it('合法的 YYYY-MM-DD 返回 true', () => {
    expect(isDateOnly('2026-10-23')).toBe(true)
    expect(isDateOnly('2024-02-29')).toBe(true)
    expect(isDateOnly('2026-12-31')).toBe(true)
  })

  it('格式错误返回 false', () => {
    expect(isDateOnly('2026-1-1')).toBe(false)
    expect(isDateOnly('2026/10/23')).toBe(false)
    expect(isDateOnly('2026-10-23 ')).toBe(false)
    expect(isDateOnly('2026-10-23T00:00')).toBe(false)
    expect(isDateOnly('')).toBe(false)
  })

  it('非字符串返回 false', () => {
    expect(isDateOnly(null)).toBe(false)
    expect(isDateOnly(undefined)).toBe(false)
    expect(isDateOnly(20261023)).toBe(false)
    expect(isDateOnly(new Date(2026, 9, 23))).toBe(false)
  })

  it('不存在的日期返回 false', () => {
    expect(isDateOnly('2026-02-29')).toBe(false)
    expect(isDateOnly('2026-02-30')).toBe(false)
    expect(isDateOnly('2026-04-31')).toBe(false)
    expect(isDateOnly('2026-13-01')).toBe(false)
    expect(isDateOnly('2026-00-10')).toBe(false)
    expect(isDateOnly('2026-10-00')).toBe(false)
  })
})

describe('parseDateOnly', () => {
  it('解析为本地时区当天 00:00', () => {
    const date = parseDateOnly('2026-10-23')
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(9)
    expect(date?.getDate()).toBe(23)
    expect(date?.getHours()).toBe(0)
    expect(date?.getMinutes()).toBe(0)
    expect(date?.getSeconds()).toBe(0)
    expect(date?.getMilliseconds()).toBe(0)
  })

  it('非法日期返回 null', () => {
    expect(parseDateOnly('2026-02-29')).toBeNull()
    expect(parseDateOnly('abc')).toBeNull()
  })
})

describe('daysUntil', () => {
  it('今天为 0，且忽略时分秒', () => {
    expect(daysUntil('2026-10-23', today)).toBe(0)
    expect(daysUntil('2026-10-23', new Date(2026, 9, 23, 0, 0, 0))).toBe(0)
    expect(daysUntil('2026-10-23', new Date(2026, 9, 23, 23, 59, 59))).toBe(0)
  })

  it('未来为正，过去为负', () => {
    expect(daysUntil('2026-10-24', today)).toBe(1)
    expect(daysUntil('2026-10-22', today)).toBe(-1)
    expect(daysUntil('2026-11-23', today)).toBe(31)
  })

  it('跨年计算正确', () => {
    expect(daysUntil('2027-01-01', new Date(2026, 11, 31))).toBe(1)
    expect(daysUntil('2026-01-01', new Date(2025, 11, 31))).toBe(1)
    expect(daysUntil('2027-10-23', today)).toBe(365)
  })

  it('跨夏令时的区间仍是整日差', () => {
    // 2026 年美国夏令时 3 月 8 日、11 月 1 日，整日差不应偏移
    expect(daysUntil('2026-11-02', new Date(2026, 10, 1, 12))).toBe(1)
    expect(daysUntil('2026-03-09', new Date(2026, 2, 8, 12))).toBe(1)
  })

  it('非法日期返回 null', () => {
    expect(daysUntil('2026-02-29', today)).toBeNull()
    expect(daysUntil('not-a-date', today)).toBeNull()
  })
})

describe('describeCountdown', () => {
  it('未来状态', () => {
    expect(describeCountdown('2026-10-30', today)).toEqual({
      status: 'future',
      days: 7
    })
  })

  it('今天状态，days 为 0', () => {
    expect(describeCountdown('2026-10-23', today)).toEqual({
      status: 'today',
      days: 0
    })
  })

  it('已过状态，days 为绝对值', () => {
    expect(describeCountdown('2026-10-20', today)).toEqual({
      status: 'past',
      days: 3
    })
  })

  it('非法日期返回 null', () => {
    expect(describeCountdown('2026-02-29', today)).toBeNull()
  })
})

describe('sortCountdowns', () => {
  it('未来按日期升序在前', () => {
    const items = [
      countdown('c', '2026-12-01'),
      countdown('a', '2026-10-24'),
      countdown('b', '2026-11-05')
    ]
    expect(sortCountdowns(items, today).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c'
    ])
  })

  it('今天排在未来之前、过去的之后', () => {
    const items = [
      countdown('past', '2026-10-01'),
      countdown('future', '2026-10-24'),
      countdown('today', '2026-10-23')
    ]
    expect(sortCountdowns(items, today).map((item) => item.id)).toEqual([
      'today',
      'future',
      'past'
    ])
  })

  it('过期条目按日期倒序', () => {
    const items = [
      countdown('older', '2026-01-01'),
      countdown('newer', '2026-10-22'),
      countdown('middle', '2026-05-01')
    ]
    expect(sortCountdowns(items, today).map((item) => item.id)).toEqual([
      'newer',
      'middle',
      'older'
    ])
  })

  it('非法日期的条目排在最后', () => {
    const items = [
      countdown('bad', '2026-02-29'),
      countdown('past', '2026-10-01'),
      countdown('future', '2026-11-01')
    ]
    expect(sortCountdowns(items, today).map((item) => item.id)).toEqual([
      'future',
      'past',
      'bad'
    ])
  })

  it('不修改入参并返回新数组', () => {
    const items = [countdown('b', '2026-12-01'), countdown('a', '2026-10-24')]
    const sorted = sortCountdowns(items, today)
    expect(sorted).not.toBe(items)
    expect(items.map((item) => item.id)).toEqual(['b', 'a'])
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('buildMonthGrid', () => {
  it('2026 年 10 月从 2026-09-28 周一开始，共 35 格', () => {
    const cells = buildMonthGrid(2026, 10)
    expect(cells).toHaveLength(35)
    expect(cells[0].date).toBe('2026-09-28')
    expect(cells[0].day).toBe(28)
    expect(cells[0].inMonth).toBe(false)
    expect(cells[3].date).toBe('2026-10-01')
    expect(cells[3].inMonth).toBe(true)
    expect(cells[34].date).toBe('2026-11-01')
    expect(cells[34].inMonth).toBe(false)
  })

  it('2024 年 2 月闰月共 29 天，网格从 2024-01-29 开始', () => {
    const cells = buildMonthGrid(2024, 2)
    expect(cells[0].date).toBe('2024-01-29')
    expect(cells[0].day).toBe(29)
    const inMonth = cells.filter((cell) => cell.inMonth)
    expect(inMonth).toHaveLength(29)
    expect(inMonth[0].date).toBe('2024-02-01')
    expect(inMonth[28].date).toBe('2024-02-29')
    expect(cells[cells.length - 1].date).toBe('2024-03-03')
  })

  it('2025 年 2 月平月共 28 天', () => {
    const cells = buildMonthGrid(2025, 2)
    const inMonth = cells.filter((cell) => cell.inMonth)
    expect(inMonth).toHaveLength(28)
  })

  it('单元格数量只可能是 35 或 42', () => {
    for (let month = 1; month <= 12; month += 1) {
      for (let year = 2024; year <= 2027; year += 1) {
        const cells = buildMonthGrid(year, month)
        expect([35, 42]).toContain(cells.length)
      }
    }
  })

  it('日期连续且以周一开头、周日结尾', () => {
    const cells = buildMonthGrid(2026, 8)
    const toLocal = (value: string): Date => {
      const parts = value.split('-').map(Number)
      return new Date(parts[0], parts[1] - 1, parts[2])
    }
    expect(toLocal(cells[0].date).getDay()).toBe(1)
    for (let index = 1; index < cells.length; index += 1) {
      const prev = toLocal(cells[index - 1].date)
      const expected = new Date(
        prev.getFullYear(),
        prev.getMonth(),
        prev.getDate() + 1
      )
      expect(toLocal(cells[index].date).getTime()).toBe(expected.getTime())
    }
    const last = toLocal(cells[cells.length - 1].date)
    expect(last.getDay()).toBe(0)
  })

  it('inMonth 标记与目标月份一致', () => {
    const cells = buildMonthGrid(2026, 10)
    cells.forEach((cell) => {
      expect(cell.inMonth).toBe(cell.date.startsWith('2026-10-'))
    })
  })
})

describe('内置节假日数据', () => {
  it('2026 年数据非空且按日期升序', () => {
    expect(BUILTIN_HOLIDAYS_2026.length).toBeGreaterThan(0)
    const dates = BUILTIN_HOLIDAYS_2026.map((entry) => entry.date)
    expect(dates).toEqual([...dates].sort())
    expect(dates[0]).toBe('2026-01-01')
    expect(dates[dates.length - 1]).toBe('2026-10-10')
  })

  it('2026 返回浅拷贝，其他年份为空数组', () => {
    const entries = getBuiltinHolidays(2026)
    expect(entries).toHaveLength(BUILTIN_HOLIDAYS_2026.length)
    expect(entries).not.toBe(BUILTIN_HOLIDAYS_2026)
    expect(entries[0]).not.toBe(BUILTIN_HOLIDAYS_2026[0])
    expect(getBuiltinHolidays(2025)).toEqual([])
  })
})
