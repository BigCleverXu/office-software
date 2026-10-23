// 日历与倒计日共享契约：类型 + 常量 + 纯函数
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 节假日类型 */
export type HolidayType = 'holiday' | 'workday'

/** 一条节假日 / 调休记录 */
export interface HolidayEntry {
  /** YYYY-MM-DD */
  date: string
  /** 节日 / 补班名称 */
  name: string
  /** holiday=法定休假，workday=调休补班 */
  type: HolidayType
}

/** 年份节假日数据来源 */
export type HolidayYearSource = 'cache' | 'builtin' | 'remote' | 'none'

/** 某一年的节假日数据 */
export interface HolidayYear {
  year: number
  entries: HolidayEntry[]
  source: HolidayYearSource
}

/** 一条倒计日 */
export interface Countdown {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
  createdAt: number
  updatedAt: number
}

/** 创建 / 编辑倒计日时提交的数据 */
export interface CountdownDraft {
  title: string
  date: string
}

/** 倒计日标题最大长度 */
export const COUNTDOWN_TITLE_MAX_LENGTH = 50

/** 倒计日状态描述 */
export interface CountdownDescription {
  status: 'future' | 'today' | 'past'
  /** 绝对天数，今天为 0 */
  days: number
}

/** IPC 通道名称 */
export const CALENDAR_CHANNELS = {
  listCountdowns: 'calendar:countdowns:list',
  createCountdown: 'calendar:countdowns:create',
  updateCountdown: 'calendar:countdowns:update',
  removeCountdown: 'calendar:countdowns:delete',
  countdownsChanged: 'calendar:countdowns:changed',
  getHolidays: 'calendar:holidays:get',
  holidaysChanged: 'calendar:holidays:changed'
} as const

/** 渲染进程可用的日历 API（由 preload 暴露） */
export interface CalendarApi {
  listCountdowns: () => Promise<Countdown[]>
  createCountdown: (draft: CountdownDraft) => Promise<Countdown>
  updateCountdown: (
    id: string,
    draft: CountdownDraft
  ) => Promise<Countdown | null>
  removeCountdown: (id: string) => Promise<void>
  getHolidays: (year: number) => Promise<HolidayYear>
  onCountdownsChanged: (callback: (items: Countdown[]) => void) => () => void
  onHolidaysChanged: (callback: (data: HolidayYear) => void) => () => void
}

/** 月视图单元格 */
export interface MonthCell {
  /** YYYY-MM-DD */
  date: string
  /** 几号 */
  day: number
  /** 是否属于目标月份 */
  inMonth: boolean
}

/** YYYY-MM-DD 严格格式 */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 一天的毫秒数 */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 月视图最少展示的周数 */
const MIN_GRID_WEEKS = 5

/** 每周天数 */
const DAYS_PER_WEEK = 7

/**
 * 由年月日计算 UTC 日序号（自 1970-01-01 起的天数）。
 * 使用 setUTCFullYear 而非 Date.UTC，避免 0-99 年被映射到 19xx。
 */
function utcDayNumber(year: number, month: number, day: number): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getTime() / MS_PER_DAY
}

/** 拆分 YYYY-MM-DD 为年 / 月 / 日数字 */
function splitDateOnly(value: string): {
  year: number
  month: number
  day: number
} {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10))
  }
}

/** 把 Date 格式化为 YYYY-MM-DD（按本地时区） */
function formatDateOnly(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 判断 value 是否为合法的 YYYY-MM-DD 且日期真实存在。
 * 例如 2026-02-29 非法，2024-02-29 合法。
 */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  // 回填一次 UTC 日期，越界值会滚动到相邻月份从而被排除
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** 按本地时区把 YYYY-MM-DD 解析为当天 00:00，非法返回 null */
export function parseDateOnly(value: string): Date | null {
  if (!isDateOnly(value)) {
    return null
  }
  const { year, month, day } = splitDateOnly(value)
  return new Date(year, month - 1, day)
}

/**
 * 目标日期与今天的整日差：未来为正、今天为 0、过去为负。
 * 用 UTC 日序号计算，避免时区与夏令时误差；非法日期返回 null。
 */
export function daysUntil(
  date: string,
  today: Date = new Date()
): number | null {
  if (!isDateOnly(date)) {
    return null
  }
  const { year, month, day } = splitDateOnly(date)
  const target = utcDayNumber(year, month, day)
  const base = utcDayNumber(
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate()
  )
  return target - base
}

/** 描述倒计日状态，days 为绝对值；非法日期返回 null */
export function describeCountdown(
  date: string,
  today: Date = new Date()
): CountdownDescription | null {
  const diff = daysUntil(date, today)
  if (diff === null) {
    return null
  }
  const status = diff > 0 ? 'future' : diff === 0 ? 'today' : 'past'
  return { status, days: Math.abs(diff) }
}

/**
 * 倒计日排序：未来（含今天）按日期升序在前，
 * 过期按日期倒序在后，日期非法的条目排在最后。
 * 返回新数组，不修改入参。
 */
export function sortCountdowns(
  items: Countdown[],
  today: Date = new Date()
): Countdown[] {
  const copy = items.slice()
  copy.sort((left, right) => {
    const leftDiff = daysUntil(left.date, today)
    const rightDiff = daysUntil(right.date, today)
    if (leftDiff === null && rightDiff === null) {
      return 0
    }
    if (leftDiff === null) {
      return 1
    }
    if (rightDiff === null) {
      return -1
    }
    const leftFuture = leftDiff >= 0
    const rightFuture = rightDiff >= 0
    if (leftFuture !== rightFuture) {
      return leftFuture ? -1 : 1
    }
    if (leftDiff !== rightDiff) {
      return leftFuture ? leftDiff - rightDiff : rightDiff - leftDiff
    }
    return 0
  })
  return copy
}

/**
 * 构建月视图网格：month 为 1-12，周一为每周第一天。
 * 从当月第一天所在周的周一连续排到结束，固定返回 35 或 42 个单元格。
 */
export function buildMonthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  // getDay() 中周日为 0，转换为以周一为 0 的序数
  const lead = (first.getDay() + 6) % DAYS_PER_WEEK
  const weeks = Math.max(
    MIN_GRID_WEEKS,
    Math.ceil((lead + daysInMonth) / DAYS_PER_WEEK)
  )
  const cells: MonthCell[] = []
  for (let index = 0; index < weeks * DAYS_PER_WEEK; index += 1) {
    const current = new Date(year, month - 1, 1 - lead + index)
    cells.push({
      date: formatDateOnly(current),
      day: current.getDate(),
      inMonth:
        current.getFullYear() === year && current.getMonth() === month - 1
    })
  }
  return cells
}
