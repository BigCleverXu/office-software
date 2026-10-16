import type { IntervalUnit } from './types'

/** 间隔数量的取值范围（含端点） */
export const INTERVAL_LIMITS: Record<
  IntervalUnit,
  { min: number; max: number }
> = {
  minutes: { min: 1, max: 1440 },
  hours: { min: 1, max: 24 }
}

/** 间隔单位下拉选项 */
export const INTERVAL_UNIT_OPTIONS: {
  value: IntervalUnit
  label: string
}[] = [
  { value: 'minutes', label: '分钟' },
  { value: 'hours', label: '小时' }
]

/** 按单位把间隔数量换算为毫秒 */
export function getIntervalMs(value: number, unit: IntervalUnit): number {
  const unitMs = unit === 'hours' ? 3_600_000 : 60_000
  return value * unitMs
}

/** 生成可读的间隔描述，如「每隔 30 分钟」 */
export function formatIntervalLabel(value: number, unit: IntervalUnit): string {
  const unitLabel = unit === 'hours' ? '小时' : '分钟'
  return `每隔 ${value} ${unitLabel}`
}
