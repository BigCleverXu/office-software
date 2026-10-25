// 主进程美股行情取数层：请求腾讯行情快照接口并解析为共享 Quote
// 与 A 股取数层分开：字段单位与时间格式不同，避免相互污染
import { codeFromSymbol, marketFromSymbol, type Quote } from '../shared/market'

/** 请求基础地址，symbol 以逗号拼接在末尾 */
export const US_QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q='

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 5000

export interface UsQuoteProviderOptions {
  /** 请求超时（毫秒），默认 5000 */
  timeoutMs?: number
  /** 注入的 fetch 实现，便于测试 */
  fetchImpl?: typeof fetch
}

/**
 * 解析单个字段为数字。
 * 空串、'--' 等非法内容一律返回 null（缺失值不写 0 冒充）。
 */
function toFinite(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null
  }
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** 四舍五入到 4 位小数，抑制浮点噪声（最终格式化交给展示层） */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4
}

/** 从 'YYYY-MM-DD HH:mm:ss' 取后 8 位转为 'HH:mm:ss' */
function clockFromTimestamp(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null
  }
  const stamp = raw.trim()
  if (stamp.length < 8) {
    return null
  }
  const clock = stamp.slice(-8)
  return /^\d{2}:\d{2}:\d{2}$/.test(clock) ? clock : null
}

/** 匹配单行 `v_<symbol>="<payload>"` 并返回 symbol 与拆分后的字段 */
function parseLine(line: string): { symbol: string; payload: string[] } | null {
  const match = line.match(/v_(\w+)="(.*)"/)
  if (!match) {
    return null
  }
  return { symbol: match[1], payload: match[2].split('~') }
}

/** 构造无数据 Quote：数值与时间全为 null，code/market 由 symbol 推导 */
function emptyQuote(symbol: string, name: string): Quote {
  return {
    symbol,
    code: codeFromSymbol(symbol),
    market: marketFromSymbol(symbol),
    name,
    price: null,
    prevClose: null,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    amount: null,
    quoteTime: null,
    missing: true
  }
}

/** 由 symbol 与 payload 组装一条 Quote */
function buildQuote(symbol: string, payload: string[] | undefined): Quote {
  if (!payload) {
    // 响应中未出现该 symbol 或 pv_none_match 行
    return emptyQuote(symbol, '')
  }
  const name = (payload[1] ?? '').trim()
  const rawPrice = toFinite(payload[3])
  // 现价为 0 或非法一律视为缺失，归一到 null
  const price = rawPrice === 0 ? null : rawPrice
  const prevClose = toFinite(payload[4])
  const open = toFinite(payload[5])
  const high = toFinite(payload[33])
  const low = toFinite(payload[34])
  // 美股成交额接口单位即为元，与 A 股的万元口径不同，不做换算
  const amount = toFinite(payload[37])
  const missing = price === null
  // 不使用 payload[31]/[32] 自带的涨跌额与涨跌幅，按现价与昨收计算
  const canDiff = price !== null && prevClose !== null && prevClose !== 0
  const change = canDiff ? round4(price - prevClose) : null
  const changePercent = canDiff
    ? round4(((price - prevClose) / prevClose) * 100)
    : null
  return {
    symbol,
    code: codeFromSymbol(symbol),
    market: marketFromSymbol(symbol),
    name,
    price,
    prevClose,
    change,
    changePercent,
    open,
    high,
    low,
    amount,
    quoteTime: clockFromTimestamp(payload[30]),
    missing
  }
}

/**
 * 纯解析函数：把已解码的响应文本解析为 Quote[]。
 * 输出顺序严格按 requested，缺失的 symbol 返回空 Quote 以便调用方对齐。
 */
export function parseUsQuoteResponse(
  text: string,
  requested: string[]
): Quote[] {
  const bySymbol = new Map<string, string[]>()
  for (const rawLine of text.split(/\r?\n/)) {
    const entry = parseLine(rawLine.trim())
    if (entry) {
      bySymbol.set(entry.symbol.toLowerCase(), entry.payload)
    }
  }
  return requested.map((symbol) =>
    buildQuote(symbol, bySymbol.get(symbol.toLowerCase()))
  )
}

/** GBK 解码；不支持时回退 UTF-8，解码失败不应让整轮请求失败 */
function decodeGbk(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/**
 * 批量获取美股行情：对每个请求的 symbol 都返回一条 Quote。
 * 响应中缺失的 symbol 返回 { missing: true } 的空 Quote，保证按 symbol 对齐。
 */
export async function fetchUsQuotes(
  symbols: string[],
  options: UsQuoteProviderOptions = {}
): Promise<Quote[]> {
  if (symbols.length === 0) {
    return []
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = `${US_QUOTE_ENDPOINT}${symbols.join(',')}`
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`行情请求失败：HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    return parseUsQuoteResponse(decodeGbk(buffer), symbols)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('行情请求超时')
    }
    throw error
  } finally {
    // 避免定时器泄漏
    clearTimeout(timer)
  }
}
