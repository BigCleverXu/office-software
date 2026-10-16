import type { Alarm, Weekday } from '../shared/types'

/** 格式化为 'HH:mm'（补零） */
export function formatHM(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 格式化为 'YYYY-MM-DD'（补零） */
function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 判断提醒的重复规则是否命中给定日期 */
export function matchesRepeat(alarm: Alarm, date: Date): boolean {
  switch (alarm.repeat) {
    case 'none':
      return true
    case 'daily':
      return true
    case 'interval':
      return true
    case 'weekdays': {
      const day = date.getDay()
      return day >= 1 && day <= 5
    }
    case 'weekly':
      return alarm.weekdays.includes(date.getDay() as Weekday)
    default:
      return false
  }
}

/** 是否应在该时刻触发（启用 + 时间匹配 + 重复规则命中） */
export function shouldFire(alarm: Alarm, date: Date): boolean {
  if (alarm.repeat === 'interval') {
    return (
      alarm.enabled &&
      alarm.nextFireAt !== null &&
      date.getTime() >= alarm.nextFireAt
    )
  }
  return (
    alarm.enabled && formatHM(date) === alarm.time && matchesRepeat(alarm, date)
  )
}

/** 去重键：`${id}|YYYY-MM-DD|HH:mm` */
export function fireKey(alarm: Alarm, date: Date): string {
  return `${alarm.id}|${formatDate(date)}|${formatHM(date)}`
}

/**
 * 定时检查调度器（纯逻辑，不依赖 electron，便于单元测试）。
 */
export class AlarmScheduler {
  private readonly getAlarms: () => Alarm[]
  private readonly onFire: (alarm: Alarm, firedAt: Date) => void
  private readonly intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly firedKeys = new Set<string>()

  constructor(
    getAlarms: () => Alarm[],
    onFire: (alarm: Alarm, firedAt: Date) => void,
    intervalMs = 15000
  ) {
    this.getAlarms = getAlarms
    this.onFire = onFire
    this.intervalMs = intervalMs
  }

  /** 启动定时器，并立即检查一次 */
  start(): void {
    if (this.timer !== null) {
      return
    }
    this.check()
    this.timer = setInterval(() => {
      this.check()
    }, this.intervalMs)
  }

  /** 清除定时器 */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 手动检查一次（默认使用当前时间） */
  check(now: Date = new Date()): void {
    const today = formatDate(now)
    this.clearExpiredKeys(today)

    for (const alarm of this.getAlarms()) {
      if (!shouldFire(alarm, now)) {
        continue
      }
      const key = fireKey(alarm, now)
      if (this.firedKeys.has(key)) {
        continue
      }
      this.firedKeys.add(key)
      this.onFire(alarm, now)
    }
  }

  /** 清理非当天的去重键 */
  private clearExpiredKeys(today: string): void {
    for (const key of this.firedKeys) {
      const parts = key.split('|')
      if (parts[1] !== today) {
        this.firedKeys.delete(key)
      }
    }
  }
}
