import dayjs from 'dayjs'

/** 按本地时区格式化为 YYYY-MM-DD（月、日补零） */
export function toDateKey(date: Date): string {
  return dayjs(date).format('YYYY-MM-DD')
}

/**
 * 距离下一个本地零点的毫秒数。
 * 用「次日 0 点」与入参相减，由日历日期推进，
 * 避免直接加 24 小时在夏令时切换日产生偏差。
 */
export function msUntilNextMidnight(date: Date): number {
  const next = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
    0,
    0,
    0,
    0
  )
  return next.getTime() - date.getTime()
}
