// 主进程金价取数层：请求新浪公开行情接口并解析为共享 GoldQuote
// 仅在 Electron 主进程使用；接口返回 GBK 文本，需先解码再解析
import {
  GOLD_NAMES,
  GOLD_SYMBOLS,
  type GoldQuote,
  type GoldSymbol
} from '../shared/gold'

/** 金价请求地址，接口代码顺序与 GOLD_SYMBOLS 保持一致 */
export const GOLD_QUOTE_ENDPOINT =
  'https://hq.sinajs.cn/list=gds_AU9999,hf_XAU,fx_susdcnh'

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 5000

/** 新浪行情接口要求携带站内 Referer，否则会被拒绝 */
const REFERER = 'https://finance.sina.com.cn'

/** 桌面浏览器 UA，避免接口按移动端返回不同格式 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 接口代码 → 共享 symbol 映射 */
const CODE_TO_SYMBOL: Record<string, GoldSymbol> = {
  gds_AU9999: 'au9999',
  hf_XAU: 'xau',
  fx_susdcnh: 'cnh'
}

export interface GoldProviderOptions {
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

/** 价格类字段：仅接受正数，0 与负数视为缺失 */
function toPrice(raw: string | undefined): number | null {
  const value = toFinite(raw)
  return value !== null && value > 0 ? value : null
}

/** 四舍五入到 4 位小数，抑制浮点噪声（最终格式化交给展示层） */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4
}

/** 校验并返回 'HH:mm:ss'；格式不符返回 null */
function toClock(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null
  }
  const trimmed = raw.trim()
  return /^\d{2}:\d{2}:\d{2}$/.test(trimmed) ? trimmed : null
}

/** 匹配单行 `var hq_str_<code>="<payload>"` 并返回 code 与拆分后的字段 */
function parseLine(line: string): { code: string; payload: string[] } | null {
  const match = line.match(/hq_str_(\w+)="([^"]*)"/)
  if (!match) {
    return null
  }
  return { code: match[1], payload: match[2].split(',') }
}

/** 构造无数据 Quote：数值与时间全为 null，名称回退 GOLD_NAMES */
function emptyQuote(symbol: GoldSymbol): GoldQuote {
  return {
    symbol,
    name: GOLD_NAMES[symbol],
    price: null,
    prevClose: null,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    quoteTime: null,
    missing: true
  }
}

/** 取字段名称，空值回退 GOLD_NAMES */
function nameOf(symbol: GoldSymbol, raw: string | undefined): string {
  const name = (raw ?? '').trim()
  return name === '' ? GOLD_NAMES[symbol] : name
}

/** 按现价与昨收自行计算涨跌额与涨跌幅（4 位小数） */
function diffOf(
  price: number | null,
  prevClose: number | null
): { change: number | null; changePercent: number | null } {
  if (price === null || prevClose === null || prevClose === 0) {
    return { change: null, changePercent: null }
  }
  return {
    change: round4(price - prevClose),
    changePercent: round4(((price - prevClose) / prevClose) * 100)
  }
}

/** 沪金 99：现价 0、最高 4、最低 5、时间 6、昨收 7、今开 8、名称 13 */
function buildAu9999(payload: string[]): GoldQuote {
  const price = toPrice(payload[0])
  const prevClose = toPrice(payload[7])
  const { change, changePercent } = diffOf(price, prevClose)
  return {
    symbol: 'au9999',
    name: nameOf('au9999', payload[13]),
    price,
    prevClose,
    change,
    changePercent,
    open: toPrice(payload[8]),
    high: toPrice(payload[4]),
    low: toPrice(payload[5]),
    quoteTime: toClock(payload[6]),
    missing: price === null
  }
}

/** 伦敦金：现价 0、昨收优先 7（为空取 1）、最高 4、最低 5、时间 6、名称 13 */
function buildXau(payload: string[]): GoldQuote {
  const price = toPrice(payload[0])
  const prevClose = toPrice(payload[7]) ?? toPrice(payload[1])
  const { change, changePercent } = diffOf(price, prevClose)
  return {
    symbol: 'xau',
    name: nameOf('xau', payload[13]),
    price,
    prevClose,
    change,
    changePercent,
    // 伦敦金接口不提供今开
    open: null,
    high: toPrice(payload[4]),
    low: toPrice(payload[5]),
    quoteTime: toClock(payload[6]),
    missing: price === null
  }
}

/** 汇率：时间 0、买价 1（作为 price）、卖价 2、涨跌幅 10、涨跌额 11、名称 9 */
function buildCnh(payload: string[]): GoldQuote {
  const price = toPrice(payload[1])
  const rawChange = toFinite(payload[11])
  const change = rawChange === null ? null : round4(rawChange)
  const rawPercent = toFinite(payload[10])
  const changePercent = rawPercent === null ? null : round4(rawPercent)
  // 汇率接口不直接给昨收，由现价与涨跌额反推
  const prevClose =
    price !== null && change !== null ? round4(price - change) : null
  return {
    symbol: 'cnh',
    name: nameOf('cnh', payload[9]),
    price,
    prevClose,
    change,
    changePercent,
    // 汇率接口不提供今开 / 最高 / 最低
    open: null,
    high: null,
    low: null,
    quoteTime: toClock(payload[0]),
    missing: price === null
  }
}

/** 由 symbol 与 payload 组装一条 Quote，payload 缺失时返回空 Quote */
function buildQuote(
  symbol: GoldSymbol,
  payload: string[] | undefined
): GoldQuote {
  if (!payload) {
    return emptyQuote(symbol)
  }
  switch (symbol) {
    case 'au9999':
      return buildAu9999(payload)
    case 'xau':
      return buildXau(payload)
    case 'cnh':
      return buildCnh(payload)
  }
}

/**
 * 纯解析函数：把已解码的响应文本解析为 GoldQuote[]。
 * 输出顺序严格按 GOLD_SYMBOLS，缺失的品种返回空 Quote 以便调用方对齐。
 */
export function parseGoldResponse(text: string): GoldQuote[] {
  const bySymbol = new Map<GoldSymbol, string[]>()
  for (const rawLine of text.split(/\r?\n/)) {
    const entry = parseLine(rawLine.trim())
    if (!entry) {
      continue
    }
    const symbol = CODE_TO_SYMBOL[entry.code]
    if (symbol) {
      bySymbol.set(symbol, entry.payload)
    }
  }
  return GOLD_SYMBOLS.map((symbol) => buildQuote(symbol, bySymbol.get(symbol)))
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
 * 获取三类金价：任何情况下都返回与 GOLD_SYMBOLS 对齐的 3 条 Quote。
 * 响应中缺失的品种返回 { missing: true } 的空 Quote。
 */
export async function fetchGoldQuotes(
  options: GoldProviderOptions = {}
): Promise<GoldQuote[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(GOLD_QUOTE_ENDPOINT, {
      method: 'GET',
      headers: {
        Referer: REFERER,
        'User-Agent': USER_AGENT
      },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`金价请求失败：HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    return parseGoldResponse(decodeGbk(buffer))
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('金价请求超时')
    }
    throw error
  } finally {
    // 避免定时器泄漏
    clearTimeout(timer)
  }
}
