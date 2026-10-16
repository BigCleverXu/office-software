// 主进程与渲染进程共享的类型定义（仅类型，无运行时依赖）

/** 重复周期类型 */
export type RepeatType = 'none' | 'daily' | 'weekly' | 'weekdays' | 'interval'

/** 间隔重复的单位 */
export type IntervalUnit = 'minutes' | 'hours'

/**
 * 星期几：0 = 周日，1 = 周一 ... 6 = 周六
 * 与 JS Date.getDay() 保持一致
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** 一条提醒 */
export interface Alarm {
  /** 唯一标识 */
  id: string
  /** 提醒标题/内容 */
  label: string
  /** 触发时间，格式 HH:mm（24 小时制） */
  time: string
  /** 重复周期 */
  repeat: RepeatType
  /** 每周重复时选中的星期；其他重复类型为空数组 */
  weekdays: Weekday[]
  /** 间隔重复的数量（正整数）；其他重复类型为 0 */
  intervalValue: number
  /** 间隔重复的单位；其他重复类型为 'minutes' */
  intervalUnit: IntervalUnit
  /**
   * 下一次应触发的绝对时间戳（毫秒），仅间隔重复使用；
   * 其他重复类型为 null。间隔调度以此为唯一数据源。
   */
  nextFireAt: number | null
  /** 是否启用 */
  enabled: boolean
  /** 创建时间戳（毫秒） */
  createdAt: number
  /** 最近一次触发时间戳（毫秒），未触发为 null */
  lastFiredAt: number | null
}

/** 创建/编辑提醒时提交的数据 */
export interface AlarmDraft {
  label: string
  time: string
  repeat: RepeatType
  weekdays: Weekday[]
  intervalValue: number
  intervalUnit: IntervalUnit
  enabled: boolean
}

/** IPC 通道名称 */
export const ALARM_CHANNELS = {
  list: 'alarms:list',
  create: 'alarms:create',
  update: 'alarms:update',
  remove: 'alarms:delete',
  toggle: 'alarms:toggle',
  changed: 'alarms:changed'
} as const

/** 渲染进程可用的提醒 API（由 preload 暴露） */
export interface AlarmApi {
  list: () => Promise<Alarm[]>
  create: (draft: AlarmDraft) => Promise<Alarm>
  update: (id: string, draft: AlarmDraft) => Promise<Alarm | null>
  remove: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<Alarm | null>
  onChanged: (callback: (alarms: Alarm[]) => void) => () => void
}
