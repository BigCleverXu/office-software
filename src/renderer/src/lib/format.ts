import type { Alarm, RepeatType, Weekday } from '@shared/types'
import { formatIntervalLabel } from '@shared/interval'

/** 重复周期下拉选项 */
export const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'none', label: '不重复（单次）' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'weekdays', label: '工作日' },
  { value: 'interval', label: '自定义间隔' }
]

/** 星期选项（周一在前，符合日常习惯） */
export const WEEKDAY_OPTIONS: {
  value: Weekday
  label: string
  short: string
}[] = [
  { value: 1, label: '周一', short: '一' },
  { value: 2, label: '周二', short: '二' },
  { value: 3, label: '周三', short: '三' },
  { value: 4, label: '周四', short: '四' },
  { value: 5, label: '周五', short: '五' },
  { value: 6, label: '周六', short: '六' },
  { value: 0, label: '周日', short: '日' }
]

/** 生成重复周期的可读描述，用于列表标签 */
export function repeatSummary(alarm: Alarm): string {
  if (alarm.repeat === 'none') return '单次'
  if (alarm.repeat === 'daily') return '每天'
  if (alarm.repeat === 'weekdays') return '工作日'
  if (alarm.repeat === 'interval') {
    return formatIntervalLabel(alarm.intervalValue, alarm.intervalUnit)
  }

  const shorts = WEEKDAY_OPTIONS.filter((option) =>
    alarm.weekdays.includes(option.value)
  ).map((option) => option.short)

  return shorts.length > 0 ? `每周 ${shorts.join('、')}` : '每周'
}

/** 格式化为 'HH:mm'（补零） */
function formatHM(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * 卡片主时间文案：
 * - 间隔提醒：显示下次提醒的 HH:mm；未启用或无下次时间显示 '--:--'；
 * - 其他类型：显示设定的触发时间。
 */
export function primaryTimeLabel(alarm: Alarm): string {
  if (alarm.repeat === 'interval') {
    if (!alarm.enabled || alarm.nextFireAt === null) return '--:--'
    return formatHM(new Date(alarm.nextFireAt))
  }
  return alarm.time
}
