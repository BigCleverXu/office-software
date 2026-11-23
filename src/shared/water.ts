// 喝水记录共享契约：类型 + 常量 + 纯函数
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 喝水设置（单行） */
export interface WaterSettings {
  /** 单杯容量（毫升） */
  cupMl: number
  /** 最近一次修改时间戳，未设置过为 null */
  updatedAt: number | null
}

/** 单条饮水记录 */
export interface WaterRecord {
  id: string
  /** 本次饮水量（毫升） */
  amountMl: number
  /** 饮水时间戳（毫秒） */
  drankAt: number
  /** 同步到应用日历的时间戳，未同步为 null */
  syncedAt: number | null
}

/** 喝水页整体状态 */
export interface WaterState {
  settings: WaterSettings
  /** 今日记录，按饮水时间倒序 */
  records: WaterRecord[]
  todayCount: number
  todayTotalMl: number
}

/** 同步到应用日历的结果 */
export interface WaterSyncResult {
  ok: boolean
  eventCount: number
  message: string
}

/** IPC 通道 */
export const WATER_CHANNELS = {
  getState: 'water:state',
  addCup: 'water:add-cup',
  setCup: 'water:set-cup',
  removeLast: 'water:remove-last',
  syncCalendar: 'water:sync-calendar'
} as const

/** preload 暴露给渲染层的喝水 API */
export interface WaterApi {
  getState: () => Promise<WaterState>
  addCup: () => Promise<WaterState>
  setCupMl: (cupMl: number) => Promise<WaterState | null>
  removeLast: () => Promise<WaterState>
  syncCalendar: () => Promise<WaterSyncResult>
}

/** 单杯容量预设 */
export const WATER_CUP_PRESETS = [300, 500, 750, 1000] as const
/** 单杯容量下限（毫升） */
export const MIN_CUP_ML = 50
/** 单杯容量上限（毫升） */
export const MAX_CUP_ML = 2000
/** 默认单杯容量（毫升） */
export const DEFAULT_CUP_ML = 500
/** 长按触发记录所需时长 */
export const LONG_PRESS_MS = 500
/** 注水动画时长 */
export const POUR_DURATION_MS = 1400

/** 默认喝水设置：500ml 且未修改过 */
export const DEFAULT_WATER_SETTINGS: WaterSettings = {
  cupMl: DEFAULT_CUP_ML,
  updatedAt: null
}

/** 数字补零到两位 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 非法时间戳回退为当前时间，并保证返回合法 Date */
function toDate(timestamp: number): Date {
  const raw = new Date(Number.isFinite(timestamp) ? timestamp : Date.now())
  return Number.isFinite(raw.getTime()) ? raw : new Date()
}

/** 校验单杯容量：必须是整数且落在 [MIN_CUP_ML, MAX_CUP_ML] 内 */
export function isValidCupMl(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_CUP_ML &&
    value <= MAX_CUP_ML
  )
}

/** 规范化单杯容量：合法返回原值，非法一律回退为默认值 */
export function normalizeCupMl(value: unknown): number {
  return isValidCupMl(value) ? (value as number) : DEFAULT_CUP_ML
}

/** 汇总记录杯数与总量：忽略非有限数或非正数的条目 */
export function computeWaterSummary(
  records: readonly WaterRecord[]
): { count: number; totalMl: number } {
  let count = 0
  let totalMl = 0
  for (const record of records) {
    const amount = record.amountMl
    if (!Number.isFinite(amount) || amount <= 0) {
      continue
    }
    count += 1
    totalMl += amount
  }
  return { count, totalMl }
}

/** 返回时间戳所在本地自然日的 [当天 00:00, 次日 00:00) 毫秒区间 */
export function localDayRange(timestamp: number): { from: number; to: number } {
  const date = toDate(timestamp)
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()
  return {
    from: new Date(year, month, day).getTime(),
    to: new Date(year, month, day + 1).getTime()
  }
}

/** 饮水量展示：非有限或负数按 0，四舍五入取整，如 '1300 ml' */
export function formatWaterAmount(ml: number): string {
  const value = Number.isFinite(ml) && ml > 0 ? ml : 0
  return `${Math.round(value)} ml`
}

/** 饮水时间展示：本地 'HH:mm'，非法返回 '--:--' */
export function formatDrinkTime(drankAt: number): string {
  if (!Number.isFinite(drankAt)) {
    return '--:--'
  }
  const date = new Date(drankAt)
  if (!Number.isFinite(date.getTime())) {
    return '--:--'
  }
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}
