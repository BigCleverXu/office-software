// 行情看板共享契约：类型 + 纯函数 + 常量
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

import type { AppModuleId } from './navigation'

/** 市场标识：沪 / 深 / 美 */
export type MarketId = 'sh' | 'sz' | 'us'

/** 市场区域：中国 / 美国 */
export type MarketRegion = 'cn' | 'us'

/** 单只标的的行情快照 */
export interface Quote {
  /** 带市场前缀的代码，如 'sh600519' */
  symbol: string
  /** 6 位纯数字代码 */
  code: string
  market: MarketId
  /** 名称，无数据时为空字符串 */
  name: string
  /** 现价 */
  price: number | null
  /** 昨收 */
  prevClose: number | null
  /** 涨跌额 */
  change: number | null
  /** 涨跌幅（百分数值，如 1.23 表示 +1.23%） */
  changePercent: number | null
  /** 今开 */
  open: number | null
  /** 最高 */
  high: number | null
  /** 最低 */
  low: number | null
  /** 成交额，单位：元 */
  amount: number | null
  /** 数据时间 'HH:mm:ss' */
  quoteTime: string | null
  /** true = 无数据 / 停牌 */
  missing: boolean
}

/** 自选股条目 */
export interface WatchItem {
  code: string
  symbol: string
  market: MarketId
  /** 名称缓存 */
  name: string
  /** 加入时间戳（毫秒），默认排序依据 */
  addedAt: number
  /** 排序值 */
  sortOrder: number
}

/** 页面设置 */
export interface MarketSettings {
  paused: boolean
  lastPage: AppModuleId
  /** 当前选中的市场，默认 'cn' */
  region: MarketRegion
}

/** 行情页整体状态 */
export type MarketStatus =
  | 'loading' // 首次加载且无数据
  | 'refreshing' // 有请求在途
  | 'ok' // 最近一轮成功
  | 'failed' // 有请求失败但仍有旧数据
  | 'load-failed' // 启动即失败且无任何数据
  | 'closed' // 休市（非交易时段或识别为节假日）
  | 'paused' // 用户暂停

/** 推送给渲染层的完整快照 */
export interface MarketSnapshot {
  status: MarketStatus
  /** 当前是否交易时段 */
  trading: boolean
  /** 指数行情，顺序固定为 INDEX_SYMBOLS 的顺序 */
  indices: Quote[]
  /** 自选股行情，顺序与自选股列表一致 */
  quotes: Quote[]
  /** 最近一次成功刷新的时间戳（毫秒） */
  updatedAt: number | null
  /** 'HH:mm:ss'；无则为 null */
  updatedAtLabel: string | null
  /** 连续失败次数 */
  failureCount: number
  /** 下一次开盘时间戳（毫秒）；交易中为 null */
  nextOpenAt: number | null
  /** 休市提示文案，如 '13:00 恢复'、'04-13 09:30 开盘' */
  nextOpenLabel: string | null
  /** 休市原因文案，如 '午间休市'、'已收盘'、'周末休市' */
  closedReason: string | null
}

export interface MarketState {
  /** A 股（中国）快照，字段与现在完全一致 */
  snapshot: MarketSnapshot
  /** 美股快照 */
  us: MarketSnapshot
  watchlist: WatchItem[]
  settings: MarketSettings
}

/** IPC 通道 */
export const MARKET_CHANNELS = {
  getState: 'market:get-state',
  addWatch: 'market:add-watch',
  removeWatch: 'market:remove-watch',
  refreshNow: 'market:refresh-now',
  setPaused: 'market:set-paused',
  setLastPage: 'market:set-last-page',
  setRegion: 'market:set-region',
  stateChanged: 'market:state-changed',
  navigate: 'market:navigate'
} as const

/** 添加自选股的结果 */
export type AddWatchResult =
  | { ok: true; item: WatchItem }
  | {
      ok: false
      reason: 'invalid-code' | 'duplicate' | 'not-found' | 'unavailable'
    }

/** preload 暴露给渲染层的行情 API */
export interface MarketApi {
  getState: () => Promise<MarketState>
  addWatch: (code: string) => Promise<AddWatchResult>
  removeWatch: (symbol: string) => Promise<WatchItem[]>
  refreshNow: () => Promise<void>
  setPaused: (paused: boolean) => Promise<void>
  setLastPage: (page: AppModuleId) => Promise<void>
  setRegion: (region: MarketRegion) => Promise<void>
  onStateChanged: (callback: (state: MarketState) => void) => () => void
  onNavigate: (callback: (module: AppModuleId) => void) => () => void
}

/** 三个固定指数，顺序即页面展示顺序 */
export const INDEX_SYMBOLS: readonly string[] = [
  'sh000001',
  'sz399001',
  'sz399006'
]

/** 指数名称映射 */
export const INDEX_NAMES: Record<string, string> = {
  sh000001: '上证指数',
  sz399001: '深证成指',
  sz399006: '创业板指'
}

/** 美股四个固定指数的 symbol，顺序即展示顺序 */
export const US_INDEX_SYMBOLS: readonly string[] = [
  'usDJI',
  'usIXIC',
  'usNDX',
  'usINX'
]

/** 美股指数名称映射 */
export const US_INDEX_NAMES: Record<string, string> = {
  usDJI: '道琼斯',
  usIXIC: '纳斯达克',
  usNDX: '纳斯达克100',
  usINX: '标普500'
}

/** 按市场返回指数 symbol 列表；cn 返回现有 INDEX_SYMBOLS */
export function indexSymbolsOf(region: MarketRegion): readonly string[] {
  return region === 'us' ? US_INDEX_SYMBOLS : INDEX_SYMBOLS
}

/** 按 symbol 返回指数中文名；未知返回 symbol 本身 */
export function indexNameOf(symbol: string): string {
  return INDEX_NAMES[symbol] ?? US_INDEX_NAMES[symbol] ?? symbol
}

/** 校验是否为合法市场区域 */
export function isMarketRegion(value: unknown): value is MarketRegion {
  return value === 'cn' || value === 'us'
}

/** 交易时段内的刷新间隔 */
export const REFRESH_INTERVAL_MS = 3000
/** 美股交易时段内刷新间隔 */
export const US_REFRESH_INTERVAL_MS = 5000
/** 连续失败后的退避间隔 */
export const BACKOFF_INTERVAL_MS = 30000
/** 连续失败达到该值即退避 */
export const FAILURE_THRESHOLD = 3
/** 数据时间戳停滞多久判定节假日休市 */
export const STALE_LIMIT_MS = 60000
/** 距开盘多久恢复刷新 */
export const RESUME_AHEAD_MS = 60000

/** 上午盘起点（秒） 09:30:00 */
const MORNING_START = 9 * 3600 + 30 * 60
/** 上午盘终点（秒） 11:30:00 */
const MORNING_END = 11 * 3600 + 30 * 60
/** 下午盘起点（秒） 13:00:00 */
const AFTERNOON_START = 13 * 3600
/** 下午盘终点（秒） 15:00:00 */
const AFTERNOON_END = 15 * 3600

/** 取当日某个时刻的绝对时间（毫秒） */
function atClock(date: Date, hour: number, minute: number): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0
  ).getTime()
}

/**
 * 从 date 之后的下一个交易日起，取第一个交易日 09:30 的绝对时间。
 * 严格晚于当日（即使当日是交易日也返回「下次」）。
 */
function nextTradingDayOpen(date: Date): number {
  const cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  cursor.setDate(cursor.getDate() + 1)
  while (!isTradingDay(cursor)) {
    cursor.setDate(cursor.getDate() + 1)
  }
  return atClock(cursor, 9, 30)
}

/** 校验 6 位代码并推导市场与带前缀 symbol */
export function normalizeCode(
  input: string
): { code: string; symbol: string; market: MarketId } | null {
  const code = input.trim()
  if (!/^\d{6}$/.test(code)) {
    return null
  }
  const first = code[0]
  let market: MarketId
  if (first === '6' || first === '9') {
    market = 'sh'
  } else if (first === '0' || first === '3') {
    market = 'sz'
  } else {
    // 含北交所 8 / 4 开头，本轮不支持
    return null
  }
  return { code, symbol: symbolFromCode(code, market), market }
}

/** 由代码与市场拼出带前缀 symbol */
export function symbolFromCode(code: string, market: MarketId): string {
  return `${market}${code}`
}

/**
 * 规范化美股 ticker：trim + 转大写，仅允许 A-Z、数字、'.'、'-'，
 * 长度 1–10，且首字符必须是字母。非法返回 null。
 */
export function normalizeUsSymbol(
  input: string
): { code: string; symbol: string; market: MarketId } | null {
  const code = input.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(code)) {
    return null
  }
  return { code, symbol: symbolFromCode(code, 'us'), market: 'us' }
}

/** 去掉 symbol 的 sh / sz / us 前缀，得到纯代码 */
export function codeFromSymbol(symbol: string): string {
  return symbol.replace(/^(sh|sz|us)/i, '')
}

/** 由 symbol 前缀推导市场：sz → 深市、us → 美股、其余 → 沪市 */
export function marketFromSymbol(symbol: string): MarketId {
  if (symbol.startsWith('sz')) {
    return 'sz'
  }
  if (symbol.startsWith('us')) {
    return 'us'
  }
  return 'sh'
}

/** 周一至周五视为交易日（本地时间） */
export function isTradingDay(date: Date): boolean {
  const day = date.getDay()
  return day >= 1 && day <= 5
}

/** 是否处于交易时段：交易日 09:30–11:30 或 13:00–15:00 */
export function isTradingTime(date: Date): boolean {
  if (!isTradingDay(date)) {
    return false
  }
  const sec =
    date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
  const morning = sec >= MORNING_START && sec < MORNING_END
  const afternoon = sec >= AFTERNOON_START && sec < AFTERNOON_END
  return morning || afternoon
}

/**
 * 下一个开盘时间与原因。
 * 约定：本函数仅供非交易时段使用；若传入的交易中时间（或任意工作日的
 * 盘中时间），按「已收盘」处理并取下一个交易日 09:30。
 */
export function nextOpenAt(date: Date): {
  at: number
  label: string
  reason: 'pre-open' | 'lunch' | 'closed' | 'weekend'
} {
  if (!isTradingDay(date)) {
    const at = nextTradingDayOpen(date)
    return {
      at,
      label: `${formatDateLabel(new Date(at))} 09:30 开盘`,
      reason: 'weekend'
    }
  }
  if (isTradingTime(date)) {
    const at = nextTradingDayOpen(date)
    return {
      at,
      label: `${formatDateLabel(new Date(at))} 09:30 开盘`,
      reason: 'closed'
    }
  }
  const sec =
    date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
  if (sec < MORNING_START) {
    return {
      at: atClock(date, 9, 30),
      label: '09:30 开盘',
      reason: 'pre-open'
    }
  }
  if (sec >= MORNING_END && sec < AFTERNOON_START) {
    return {
      at: atClock(date, 13, 0),
      label: '13:00 恢复',
      reason: 'lunch'
    }
  }
  const at = nextTradingDayOpen(date)
  return {
    at,
    label: `${formatDateLabel(new Date(at))} 09:30 开盘`,
    reason: 'closed'
  }
}

/** 非交易时段的原因文案；交易时段返回空字符串 */
export function closedReasonText(date: Date): string {
  if (isTradingTime(date)) {
    return ''
  }
  if (!isTradingDay(date)) {
    return '周末休市'
  }
  const sec =
    date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
  if (sec < MORNING_START) {
    return '开盘前'
  }
  if (sec >= MORNING_END && sec < AFTERNOON_START) {
    return '午间休市'
  }
  return '已收盘'
}

/** 取时间戳所属交易时段的起点；不在交易时段返回 null */
function tradingSessionStart(ms: number): number | null {
  const date = new Date(ms)
  if (!isTradingTime(date)) {
    return null
  }
  if (date.getHours() * 3600 + date.getMinutes() * 60 < MORNING_END) {
    return atClock(date, 9, 30)
  }
  return atClock(date, 13, 0)
}

/** 两个时间戳是否属于同一个交易时段 */
export function isSameTradingSession(a: number, b: number): boolean {
  const startA = tradingSessionStart(a)
  if (startA === null) {
    return false
  }
  return startA === tradingSessionStart(b)
}

/** 美东本地时间片段；weekday 采用 0=周日 … 6=周六 */
export interface EtParts {
  year: number
  /** 1-12 */
  month: number
  day: number
  /** 0-23 */
  hour: number
  minute: number
  weekday: number
}

/**
 * 美东时间格式化器。hourCycle 固定为 'h23'，
 * 避免午夜被格式化为 24 点而误判日期。
 */
const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23'
})

/** 英文星期缩写到 0–6 的映射（0 = 周日） */
const ET_WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
}

/** 美股开盘时刻（美东当日分钟数） 09:30 */
const US_OPEN_MINUTE = 9 * 60 + 30
/** 美股收盘时刻（美东当日分钟数） 16:00 */
const US_CLOSE_MINUTE = 16 * 60

/** 下一次美股开盘信息 */
export interface UsOpenStart {
  /** 绝对时间戳（毫秒） */
  at: number
  /** 同一天：'09:30 开盘'；跨天：'10-26 09:30 开盘' */
  label: string
}

/** 数字补零到两位 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 用 Intl.DateTimeFormat + 'America/New_York' 求美东本地时间。
 * hourCycle 取 'h23'，并对个别引擎返回的 24 点做取模兜底。
 */
export function etParts(date: Date): EtParts {
  const parts = ET_FORMATTER.formatToParts(date)
  const read = (type: string): string => {
    const hit = parts.find((part) => part.type === type)
    return hit === undefined ? '' : hit.value
  }
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
    weekday: ET_WEEKDAY_INDEX[read('weekday')] ?? 0
  }
}

/** 当前是否为美股开盘时段：美东周一至周五 09:30–16:00（左闭右开） */
export function usMarketOpen(date: Date): boolean {
  const parts = etParts(date)
  if (parts.weekday === 0 || parts.weekday === 6) {
    return false
  }
  const minutes = parts.hour * 60 + parts.minute
  return minutes >= US_OPEN_MINUTE && minutes < US_CLOSE_MINUTE
}

/** 休市原因：'周末休市' / '开盘前' / '已收盘'；开盘时返回 '' */
export function usClosedReason(date: Date): string {
  const parts = etParts(date)
  if (parts.weekday === 0 || parts.weekday === 6) {
    return '周末休市'
  }
  const minutes = parts.hour * 60 + parts.minute
  if (minutes < US_OPEN_MINUTE) {
    return '开盘前'
  }
  if (minutes >= US_CLOSE_MINUTE) {
    return '已收盘'
  }
  return ''
}

/**
 * 美东墙上时间 → 绝对时间戳（毫秒）。
 * 先按 Date.UTC 猜测，再用 etParts 求偏差修正，迭代两次即可收敛；
 * 不硬编码 UTC-5 / UTC-4，自动适配夏令时。
 */
function etTimestampOf(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  let guess = target
  for (let i = 0; i < 2; i += 1) {
    const parts = etParts(new Date(guess))
    const wall = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0
    )
    guess += target - wall
  }
  return guess
}

/**
 * 严格晚于 date 的下一次美股开盘（跳过周末），最多向后找 8 天。
 * 不硬编码 UTC-5 / UTC-4，由 etTimestampOf 自动适配夏令时。
 */
export function nextUsOpenStart(date: Date): UsOpenStart {
  const nowMs = date.getTime()
  const nowParts = etParts(date)
  for (let offset = 0; offset < 8; offset += 1) {
    const at = etTimestampOf(
      nowParts.year,
      nowParts.month,
      nowParts.day + offset,
      9,
      30
    )
    const startParts = etParts(new Date(at))
    if (startParts.weekday === 0 || startParts.weekday === 6) {
      continue
    }
    if (at <= nowMs) {
      continue
    }
    const clock = `${pad2(startParts.hour)}:${pad2(startParts.minute)}`
    const sameDay =
      startParts.year === nowParts.year &&
      startParts.month === nowParts.month &&
      startParts.day === nowParts.day
    if (sameDay) {
      return { at, label: `${clock} 开盘` }
    }
    const dateLabel = formatDateLabel(
      new Date(startParts.year, startParts.month - 1, startParts.day)
    )
    return { at, label: `${dateLabel} ${clock} 开盘` }
  }
  throw new Error('美股开盘时间计算失败：8 天内未找到')
}

/** 涨跌方向：负 -1、零或空 0、正 1 */
export function directionOf(value: number | null): -1 | 0 | 1 {
  if (value === null || value === 0) {
    return 0
  }
  return value > 0 ? 1 : -1
}

/** 现价等数值：空显示 '--'，否则保留 2 位小数 */
export function formatPrice(value: number | null): string {
  if (value === null) {
    return '--'
  }
  return value.toFixed(2)
}

/** 带正负号的数值：空 '--'、零无符号、正数 '+'、负数 '-' */
export function formatSigned(value: number | null): string {
  if (value === null) {
    return '--'
  }
  const abs = Math.abs(value).toFixed(2)
  if (value > 0) {
    return `+${abs}`
  }
  if (value < 0) {
    return `-${abs}`
  }
  return abs
}

/** 带正负号的百分比，如 '+1.23%' */
export function formatPercent(value: number | null): string {
  if (value === null) {
    return '--'
  }
  return `${formatSigned(value)}%`
}

/** 成交额：空 '--'；小于 1 亿用万元（0 位小数），否则用亿元（2 位小数） */
export function formatAmount(value: number | null): string {
  if (value === null) {
    return '--'
  }
  const abs = Math.abs(value)
  if (abs < 1e8) {
    return `${Math.round(abs / 1e4)} 万元`
  }
  return `${(abs / 1e8).toFixed(2)} 亿元`
}

/** 时间戳转本机时间 'HH:mm:ss'；空返回 null */
export function formatClockTime(ms: number | null): string | null {
  if (ms === null) {
    return null
  }
  const date = new Date(ms)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** 日期转 'MM-DD' */
export function formatDateLabel(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}
