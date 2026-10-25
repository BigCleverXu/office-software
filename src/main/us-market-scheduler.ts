// 主进程美股行情调度器：开盘时段定频刷新，休市期间复用最近一次数据。
// 不依赖 electron，时钟与定时器均可注入，便于单元测试。
import {
  BACKOFF_INTERVAL_MS,
  FAILURE_THRESHOLD,
  US_REFRESH_INTERVAL_MS,
  codeFromSymbol,
  formatClockTime,
  indexNameOf,
  indexSymbolsOf,
  marketFromSymbol,
  nextUsOpenStart,
  usClosedReason,
  usMarketOpen,
  type MarketSettings,
  type MarketSnapshot,
  type MarketStatus,
  type Quote,
  type WatchItem
} from '../shared/market'

/** 暂停时的轮询间隔：等待外部 setPaused 后调用 reevaluate */
const PAUSE_POLL_MS = 1000

/** 排定时器统一多留的余量，避免边界抖动 */
const TIMER_SLACK_MS = 500

/** 闭市兜底取数失败后的重试间隔 */
export const US_CLOSED_RETRY_MS = 60_000

/** 最近一次成功取数结果 */
interface SessionCache {
  quotes: Quote[]
  /** 该轮成功取数时的时间戳（毫秒） */
  updatedAt: number
}

export interface UsMarketSchedulerDeps {
  /** 取数函数；测试时注入假实现 */
  fetchQuotes: (symbols: string[]) => Promise<Quote[]>
  /** 读取当前美股自选股（调用方已过滤为 market === 'us'） */
  getWatchlist: () => WatchItem[]
  /** 读取页面设置（读取 paused） */
  getSettings: () => MarketSettings
  /** 每次快照变化时回调 */
  onSnapshot: (snapshot: MarketSnapshot) => void
  /** 注入时钟，默认 Date.now */
  now?: () => number
  /** 注入定时器，默认 setTimeout/clearTimeout（便于测试） */
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

/** 构造空 Quote（无数据），供快照补齐用 */
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

/** 在缓存中查找 symbol，大小写不敏感 */
function findQuoteIn(cache: SessionCache | null, symbol: string): Quote | null {
  if (cache === null) {
    return null
  }
  const target = symbol.toLowerCase()
  return (
    cache.quotes.find((quote) => quote.symbol.toLowerCase() === target) ?? null
  )
}

/** 闭市信息：原因、下一次开盘时间与文案 */
interface ClosedInfo {
  reason: string | null
  at: number | null
  label: string | null
}

/**
 * 美股行情调度器（纯逻辑）。
 *
 * 决策顺序：暂停 → 是否开盘 → 开盘定频取数 / 休市只推快照。
 * 单一缓存：最近一次成功取数结果，失败时保留旧值，
 * 保证收盘 / 周末打开应用也能展示最近行情。
 */
export class UsMarketScheduler {
  private readonly deps: UsMarketSchedulerDeps
  private readonly now: () => number
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false

  /** 构造时的初始状态；尚未评估前对外保持 loading / paused */
  private readonly initialStatus: MarketStatus
  /** 是否已执行过至少一轮评估（含 refreshNow） */
  private evaluated = false

  /** 连续失败次数 */
  private failureCount = 0
  /** 同一时刻只允许一轮请求在途 */
  private inFlight = false
  /** 最近一轮取数结果 */
  private lastOutcome: 'none' | 'ok' | 'failed' = 'none'

  /** 最近一次成功取数结果；失败时保留旧值 */
  private cache: SessionCache | null = null

  constructor(deps: UsMarketSchedulerDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout
    this.initialStatus = deps.getSettings().paused ? 'paused' : 'loading'
  }

  /** 开始调度（立即评估一轮并排出下一个定时器） */
  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    this.tick()
  }

  /** 停止调度并清掉定时器 */
  stop(): void {
    this.running = false
    this.clearTimer()
  }

  /**
   * 手动立即刷新一轮：休市时也会请求并推快照，
   * 用户手动刷新即可拿到最近数据；失败不抛异常。
   */
  async refreshNow(): Promise<void> {
    if (this.inFlight) {
      return
    }
    const now = this.now()
    this.evaluated = true
    await this.fetchAndApply(now)
    this.emit()
  }

  /** 设置变化后重新评估调度（例如用户暂停 / 恢复） */
  reevaluate(): void {
    if (!this.running) {
      return
    }
    this.clearTimer()
    this.tick()
  }

  /** 读取当前快照（未评估过则返回初始 loading / paused 快照） */
  getSnapshot(): MarketSnapshot {
    return this.buildSnapshot()
  }

  /** 触发一轮评估（异步过程自身吞掉异常，避免未处理拒绝） */
  private tick(): void {
    void this.evaluate()
  }

  private async evaluate(): Promise<void> {
    if (!this.running) {
      return
    }
    this.evaluated = true
    const now = this.now()

    // 1. 用户暂停：不请求，只轮询等待 reevaluate
    if (this.deps.getSettings().paused) {
      this.emit()
      this.schedule(PAUSE_POLL_MS)
      return
    }

    // 2. 休市：已有缓存只推快照，否则先取一轮兜底数据
    if (!usMarketOpen(new Date(now))) {
      if (this.inFlight) {
        this.emit()
        this.schedule(US_REFRESH_INTERVAL_MS)
        return
      }
      if (this.cache !== null) {
        this.emit()
        this.scheduleUntilNextOpen(now)
        return
      }
      await this.fetchAndApply(now)
      if (!this.running) {
        return
      }
      this.emit()
      if (this.lastOutcome === 'failed' && this.cache === null) {
        this.schedule(US_CLOSED_RETRY_MS)
        return
      }
      this.scheduleUntilNextOpen(now)
      return
    }

    // 3. 开盘：单轮在途则跳过本轮，仍按当前节奏排下一个定时器
    if (this.inFlight) {
      this.emit()
      this.schedule(this.nextInterval())
      return
    }

    await this.fetchAndApply(now)
    if (!this.running) {
      return
    }
    this.emit()
    this.schedule(this.nextInterval())
  }

  /**
   * 发起一轮取数并更新缓存；不做定时器安排与快照推送。
   * 成功写入缓存，失败保留旧数据并累计失败次数。
   */
  private async fetchAndApply(now: number): Promise<void> {
    const watchlist = this.deps.getWatchlist()
    const symbols = [
      ...indexSymbolsOf('us'),
      ...watchlist.map((item) => item.symbol)
    ]
    this.inFlight = true
    try {
      const result = await this.deps.fetchQuotes(symbols)
      this.inFlight = false
      this.failureCount = 0
      this.lastOutcome = 'ok'
      this.cache = { quotes: result, updatedAt: now }
    } catch {
      this.inFlight = false
      this.failureCount += 1
      this.lastOutcome = 'failed'
    }
  }

  /** 当前节奏下的刷新间隔：连续失败达阈值后退避 */
  private nextInterval(): number {
    return this.failureCount >= FAILURE_THRESHOLD
      ? BACKOFF_INTERVAL_MS
      : US_REFRESH_INTERVAL_MS
  }

  /** 排到下一次开盘（含余量），休市期间不复取数 */
  private scheduleUntilNextOpen(now: number): void {
    const next = nextUsOpenStart(new Date(now))
    this.schedule(Math.max(0, next.at + TIMER_SLACK_MS - now))
  }

  /** 排下一个定时器（递归 setTimeout，便于动态改变间隔） */
  private schedule(delayMs: number): void {
    if (!this.running) {
      return
    }
    this.clearTimer()
    this.timer = this.setTimeoutFn(
      () => {
        this.timer = null
        this.tick()
      },
      Math.max(0, delayMs)
    )
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer)
      this.timer = null
    }
  }

  private emit(): void {
    this.deps.onSnapshot(this.buildSnapshot())
  }

  /** 按当前状态生成快照；数据来自单一缓存 */
  private buildSnapshot(): MarketSnapshot {
    const now = this.now()
    const settings = this.deps.getSettings()
    const open = usMarketOpen(new Date(now))
    const cache = this.cache
    const status = this.evaluated
      ? this.resolveStatus(open, settings.paused)
      : this.initialStatus
    const closed = settings.paused
      ? { reason: null, at: null, label: null }
      : this.closedInfo(now, open)
    const updatedAt = cache === null ? null : cache.updatedAt
    return {
      status,
      trading: open,
      indices: this.buildIndices(cache),
      quotes: this.buildWatchQuotes(cache),
      updatedAt,
      updatedAtLabel: formatClockTime(updatedAt),
      failureCount: this.failureCount,
      nextOpenAt: closed.at,
      nextOpenLabel: closed.label,
      closedReason: closed.reason
    }
  }

  /** 状态映射：暂停 → 休市 → 在途 → 失败 / 成功 */
  private resolveStatus(open: boolean, paused: boolean): MarketStatus {
    if (paused) {
      return 'paused'
    }
    if (!open) {
      return 'closed'
    }
    if (this.inFlight) {
      return 'refreshing'
    }
    if (this.lastOutcome === 'failed') {
      return this.cache !== null ? 'failed' : 'load-failed'
    }
    if (this.lastOutcome === 'ok') {
      return 'ok'
    }
    return 'loading'
  }

  /** 闭市文案与下一次开盘信息；开盘时全为 null */
  private closedInfo(now: number, open: boolean): ClosedInfo {
    if (open) {
      return { reason: null, at: null, label: null }
    }
    const date = new Date(now)
    const next = nextUsOpenStart(date)
    return {
      reason: usClosedReason(date),
      at: next.at,
      label: next.label
    }
  }

  /** 指数固定为美股四只，缺失补空 Quote 并带指数名 */
  private buildIndices(cache: SessionCache | null): Quote[] {
    return indexSymbolsOf('us').map((symbol) => {
      const cached = findQuoteIn(cache, symbol)
      if (cached) {
        return cached.name ? cached : { ...cached, name: indexNameOf(symbol) }
      }
      return emptyQuote(symbol, indexNameOf(symbol))
    })
  }

  /** 自选股与列表顺序一一对齐，缺失补空 Quote 并回落 item.name */
  private buildWatchQuotes(cache: SessionCache | null): Quote[] {
    return this.deps.getWatchlist().map((item) => {
      const cached = findQuoteIn(cache, item.symbol)
      if (cached) {
        return cached.name ? cached : { ...cached, name: item.name }
      }
      return emptyQuote(item.symbol, item.name)
    })
  }
}
