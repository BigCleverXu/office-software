// 积存金共享契约：类型 + 纯函数 + 常量
// 仅依赖语言内置能力与 ./market 的格式化函数，主进程 / preload / 渲染层共用

import { formatClockTime, formatMoney, formatSignedMoney } from './market'

/** 积存金关注的标的：上金所金价 / 国际金价 / 离岸人民币汇率 */
export type GoldSymbol = 'au9999' | 'xau' | 'cnh'

/** 全部标的，顺序即展示顺序 */
export const GOLD_SYMBOLS: readonly GoldSymbol[] = ['au9999', 'xau', 'cnh']

/** 标的名称映射 */
export const GOLD_NAMES: Record<GoldSymbol, string> = {
  au9999: '沪金 99',
  xau: '伦敦金',
  cnh: '离岸人民币'
}

/** 标的计价单位映射 */
export const GOLD_UNITS: Record<GoldSymbol, string> = {
  au9999: '元/克',
  xau: '美元/盎司',
  cnh: 'CNH'
}

/** 单个标的的行情快照 */
export interface GoldQuote {
  symbol: GoldSymbol
  /** 名称，无数据时回退为 GOLD_NAMES */
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
  /** 数据时间 'HH:mm:ss' */
  quoteTime: string | null
  /** true = 无数据 */
  missing: boolean
}

/** 积存金持仓 */
export interface GoldHolding {
  /** 持有克数，0 表示未持有 */
  grams: number
  /** 每克成本价，0 表示未填写 */
  costPerGram: number
  /** 最近一次修改时间戳（毫秒） */
  updatedAt: number | null
}

/** 持仓盈亏汇总 */
export interface GoldSummary {
  grams: number
  /** 持仓成本合计；无持仓或行情缺失时为 null */
  totalCost: number | null
  /** 持仓市值；行情缺失时为 null */
  marketValue: number | null
  /** 今日盈亏；行情或昨收缺失时为 null */
  todayPnl: number | null
  /** 今日盈亏率（百分数值）；基数为 0 时为 null */
  todayPnlPercent: number | null
  /** 累计盈亏；行情缺失或成本为 0 时为 null */
  totalPnl: number | null
  /** 累计收益率（百分数值）；成本为 0 时为 null */
  totalPnlPercent: number | null
}

/** 积存金页整体状态 */
export type GoldStatus =
  | 'loading' // 首次加载且无数据
  | 'refreshing' // 有请求在途
  | 'ok' // 最近一轮成功
  | 'failed' // 连续失败

/** 推送给渲染层的完整快照 */
export interface GoldSnapshot {
  status: GoldStatus
  /** 行情，顺序固定为 GOLD_SYMBOLS */
  quotes: GoldQuote[]
  holding: GoldHolding
  /** 最近一次成功刷新的时间戳（毫秒） */
  updatedAt: number | null
  /** 'HH:mm:ss'；无则为 null */
  updatedAtLabel: string | null
  /** 连续失败次数 */
  failureCount: number
}

export interface GoldState {
  snapshot: GoldSnapshot
}

/** IPC 通道 */
export const GOLD_CHANNELS = {
  getState: 'gold:get-state',
  updateHolding: 'gold:update-holding',
  refreshNow: 'gold:refresh-now',
  stateChanged: 'gold:state-changed'
} as const

/** preload 暴露给渲染层的积存金 API */
export interface GoldApi {
  getState: () => Promise<GoldState>
  updateHolding: (holding: {
    grams: number
    costPerGram: number
  }) => Promise<GoldHolding | null>
  refreshNow: () => Promise<void>
  onStateChanged: (callback: (state: GoldState) => void) => () => void
}

/** 常规刷新间隔 */
export const GOLD_REFRESH_INTERVAL_MS = 10000
/** 连续失败后的退避间隔 */
export const GOLD_BACKOFF_INTERVAL_MS = 30000
/** 连续失败达到该值即退避 */
export const GOLD_FAILURE_THRESHOLD = 3
/** 1 金衡盎司对应的克数 */
export const TROY_OUNCE_GRAMS = 31.1035
/** 持仓克数上限 */
export const MAX_GOLD_GRAMS = 1e6
/** 每克成本上限 */
export const MAX_GOLD_COST = 1e6

/** 默认持仓：未持有 */
export const DEFAULT_GOLD_HOLDING: GoldHolding = {
  grams: 0,
  costPerGram: 0,
  updatedAt: null
}

/** 按 symbol 取行情；快照中不存在时返回 null */
export function quoteOf(
  snapshot: GoldSnapshot,
  symbol: GoldSymbol
): GoldQuote | null {
  return snapshot.quotes.find((quote) => quote.symbol === symbol) ?? null
}

/** 是否持有积存金（克数大于 0） */
export function hasHolding(holding: GoldHolding): boolean {
  return holding.grams > 0
}

/** 校验持仓数值：均为有限数且落在允许区间内 */
export function isValidHolding(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') {
    return false
  }
  const { grams, costPerGram } = raw as Partial<GoldHolding>
  return (
    typeof grams === 'number' &&
    Number.isFinite(grams) &&
    grams >= 0 &&
    grams <= MAX_GOLD_GRAMS &&
    typeof costPerGram === 'number' &&
    Number.isFinite(costPerGram) &&
    costPerGram >= 0 &&
    costPerGram <= MAX_GOLD_COST
  )
}

/** 规范化持仓：缺省或非法一律回退为全 0 且 updatedAt 为 null */
export function normalizeHolding(raw: unknown): GoldHolding {
  if (!isValidHolding(raw)) {
    return { grams: 0, costPerGram: 0, updatedAt: null }
  }
  const source = raw as Partial<GoldHolding>
  const updatedAt =
    typeof source.updatedAt === 'number' &&
    Number.isFinite(source.updatedAt) &&
    source.updatedAt > 0
      ? source.updatedAt
      : null
  return {
    grams: (raw as GoldHolding).grams,
    costPerGram: (raw as GoldHolding).costPerGram,
    updatedAt
  }
}

/** 有限数返回自身，NaN / Infinity 返回 null */
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

/**
 * 汇总积存金持仓盈亏。
 *
 * 无持仓（grams ≤ 0）时除 grams 外全部为 null；行情缺失（quote 缺失、
 * missing、price 非有限数）时市值与盈亏均为 null；成本为 0 时累计盈亏
 * 与收益率均为 null；昨收缺失或基数为 0 时今日盈亏率均为 null。
 * 计算结果统一过滤 NaN / Infinity。
 */
export function computeGoldSummary(
  quote: GoldQuote | null,
  holding: GoldHolding
): GoldSummary {
  const grams = holding.grams
  if (!Number.isFinite(grams) || grams <= 0) {
    return {
      grams,
      totalCost: null,
      marketValue: null,
      todayPnl: null,
      todayPnlPercent: null,
      totalPnl: null,
      totalPnlPercent: null
    }
  }
  const costPerGram = holding.costPerGram
  const price =
    quote && !quote.missing && quote.price !== null
      ? finiteOrNull(quote.price)
      : null
  const totalCost = finiteOrNull(grams * costPerGram)
  if (price === null) {
    return {
      grams,
      totalCost,
      marketValue: null,
      todayPnl: null,
      todayPnlPercent: null,
      totalPnl: null,
      totalPnlPercent: null
    }
  }
  const marketValue = finiteOrNull(price * grams)
  const hasCost = Number.isFinite(costPerGram) && costPerGram > 0
  const totalPnl = hasCost ? finiteOrNull((price - costPerGram) * grams) : null
  const totalPnlPercent =
    totalPnl !== null && totalCost !== null && totalCost > 0
      ? finiteOrNull((totalPnl / totalCost) * 100)
      : null
  const prevClose =
    quote && quote.prevClose !== null ? finiteOrNull(quote.prevClose) : null
  const todayPnl =
    prevClose !== null ? finiteOrNull((price - prevClose) * grams) : null
  const todayBase = prevClose !== null ? prevClose * grams : 0
  const todayPnlPercent =
    todayPnl !== null && todayBase > 0
      ? finiteOrNull((todayPnl / todayBase) * 100)
      : null
  return {
    grams,
    totalCost,
    marketValue,
    todayPnl,
    todayPnlPercent,
    totalPnl,
    totalPnlPercent
  }
}

/** 国际金价（美元/盎司）按汇率折算为人民币/克；任一缺失或非正数返回 null */
export function xauCnyPerGram(
  xauPrice: number | null,
  cnhRate: number | null
): number | null {
  if (xauPrice === null || cnhRate === null) {
    return null
  }
  if (
    !Number.isFinite(xauPrice) ||
    !Number.isFinite(cnhRate) ||
    xauPrice <= 0 ||
    cnhRate <= 0
  ) {
    return null
  }
  return finiteOrNull((xauPrice * cnhRate) / TROY_OUNCE_GRAMS)
}

/** 金价：空显示 '--'，否则保留 2 位小数 */
export function formatGoldPrice(value: number | null): string {
  if (value === null) {
    return '--'
  }
  return value.toFixed(2)
}

/** 克数：空显示 '--'，否则保留 2 位小数（不带单位） */
export function formatGrams(value: number | null): string {
  if (value === null) {
    return '--'
  }
  return value.toFixed(2)
}

/** 金额：空显示 '--'，否则千分位 + 两位小数 */
export function formatGoldAmount(value: number | null): string {
  return value === null ? '--' : formatMoney(value)
}

/** 带正负号的金额：空显示 '--' */
export function formatSignedGoldAmount(value: number | null): string {
  return value === null ? '--' : formatSignedMoney(value)
}

/** 时间戳转本机时间 'HH:mm:ss'；空返回 null */
export function formatUpdatedLabel(ms: number | null): string | null {
  return formatClockTime(ms)
}
