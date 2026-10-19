// 主进程行情取数层：请求腾讯行情快照接口并解析为共享 Quote
// 仅在 Electron 主进程使用；渲染层受 CSP 限制不直接发起外部请求
import { codeFromSymbol, marketFromSymbol, type Quote } from '../shared/market'

/** 请求基础地址，symbol 以逗号拼接在末尾 */
export const QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q='

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 5000

export interface QuoteProviderOptions {
  /** 请求超时（毫秒），默认 5000 */
  timeoutMs?: number
  /** 注入的 fetch 实现，便于测试；默认使用全局 fetch */
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

/** 把 14 位时间戳（YYYYMMDDHHmmss）后 6 位转为 'HH:mm:ss' */
function clockFromStamp(stamp: string): string | null {
  const hhmmss = stamp.slice(8)
  if (!/^\d{6}$/.test(hhmmss)) {
    return null
  }
  const hh = hhmmss.slice(0, 2)
  const mm = hhmmss.slice(2, 4)
  const ss = hhmmss.slice(4, 6)
  return `${hh}:${mm}:${ss}`
}

/** 在 payload 中查找 14 位数据时间字段并转为 'HH:mm:ss' */
function extractQuoteTime(payload: string[]): string | null {
  for (const field of payload) {
    const match = field.match(/\d{14}/)
    if (match) {
      return clockFromStamp(match[0])
    }
  }
  return null
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
    // 响应中未出现该 symbol
    return emptyQuote(symbol, '')
  }
  const name = (payload[1] ?? '').trim()
  const rawPrice = toFinite(payload[3])
  // 现价为 0 视为停牌，归一到 null（缺失值一律 null）
  const price = rawPrice === 0 ? null : rawPrice
  const prevClose = toFinite(payload[4])
  const open = toFinite(payload[5])
  const high = toFinite(payload[33])
  const low = toFinite(payload[34])
  const amountWan = toFinite(payload[37])
  // 成交额：接口单位为万元，换算为元
  const amount = amountWan === null ? null : amountWan * 10000
  const codeRaw = (payload[2] ?? '').trim()
  const missing = price === null
  // 不使用 payload[31]/[32] 的涨跌额与涨跌幅，按 PRD 规则自行计算
  const change =
    !missing && prevClose !== null ? round4(price - prevClose) : null
  const changePercent =
    !missing && prevClose !== null && prevClose !== 0
      ? round4(((price - prevClose) / prevClose) * 100)
      : null
  return {
    symbol,
    code: /^\d{6}$/.test(codeRaw) ? codeRaw : codeFromSymbol(symbol),
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
    quoteTime: extractQuoteTime(payload),
    missing
  }
}

/**
 * 纯解析函数：把已解码的响应文本解析为 Quote[]。
 * 输出顺序严格按 requested，缺失的 symbol 返回空 Quote 以便调用方对齐。
 */
export function parseQuoteResponse(text: string, requested: string[]): Quote[] {
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
 * 批量获取行情：对每个请求的 symbol 都返回一条 Quote。
 * 响应中缺失的 symbol 返回 { missing: true } 的空 Quote，保证按 symbol 对齐。
 */
export async function fetchQuotes(
  symbols: string[],
  options: QuoteProviderOptions = {}
): Promise<Quote[]> {
  if (symbols.length === 0) {
    return []
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = `${QUOTE_ENDPOINT}${symbols.join(',')}`
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`行情请求失败：HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    return parseQuoteResponse(decodeGbk(buffer), symbols)
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
