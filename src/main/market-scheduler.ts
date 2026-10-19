// 主进程行情刷新调度器：交易时段定频请求、休市 / 暂停 / 失败退避的纯逻辑实现。
// 不依赖 electron，时钟与定时器均可注入，便于单元测试。
import {
  BACKOFF_INTERVAL_MS,
  closedReasonText,
  codeFromSymbol,
  FAILURE_THRESHOLD,
  formatClockTime,
  formatDateLabel,
  INDEX_NAMES,
  INDEX_SYMBOLS,
  isSameTradingSession,
  isTradingDay,
  isTradingTime,
  marketFromSymbol,
  nextOpenAt,
  REFRESH_INTERVAL_MS,
  RESUME_AHEAD_MS,
  STALE_LIMIT_MS,
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

/** 时段起点后多久才允许开始停滞计时（刚开盘数据可能尚未推进） */
const HOLIDAY_GRACE_MS = 90000

/** 上午盘起点（秒） 09:30:00 */
const MORNING_START_SEC = 9 * 3600 + 30 * 60
/** 上午盘终点（秒） 11:30:00 */
const MORNING_END_SEC = 11 * 3600 + 30 * 60

export interface MarketSchedulerDeps {
  /** 取数函数；默认用 quote-provider 的 fetchQuotes，测试时注入假实现 */
  fetchQuotes: (symbols: string[]) => Promise<Quote[]>
  /** 读取当前自选股（每次 tick 现读，保证增删后立即生效） */
  getWatchlist: () => WatchItem[]
  /** 读取页面设置（用于 paused 判定） */
  getSettings: () => MarketSettings
  /** 每轮状态变化时回调（含休市、失败、暂停等状态切换） */
  onSnapshot: (snapshot: MarketSnapshot) => void
  /** 注入时钟，默认 Date.now */
  now?: () => number
  /** 注入定时器，默认 setTimeout/clearTimeout（便于测试） */
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

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

/** date 之后第一个交易日 09:30 的绝对时间 */
function nextTradingDayOpen(date: Date): number {
  const cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  cursor.setDate(cursor.getDate() + 1)
  while (!isTradingDay(cursor)) {
    cursor.setDate(cursor.getDate() + 1)
  }
  return atClock(cursor, 9, 30)
}

/** 取时间戳所属交易时段起点；不在交易时段返回 null */
function sessionStartOf(ms: number): number | null {
  const date = new Date(ms)
  if (!isTradingTime(date)) {
    return null
  }
  const sec = date.getHours() * 3600 + date.getMinutes() * 60
  return sec < MORNING_END_SEC ? atClock(date, 9, 30) : atClock(date, 13, 0)
}

/** 把 'HH:mm:ss' 折算为「今日该时刻」的毫秒；非法 / 为空返回 null */
function clockTimeMsToday(now: number, clock: string | null): number | null {
  if (!clock) {
    return null
  }
  const match = clock.match(/^(\d{2}):(\d{2}):(\d{2})$/)
  if (!match) {
    return null
  }
  const date = new Date(now)
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  ).getTime()
}

/** 本轮数据里最大的数据时间（毫秒）；全为空则返回 null */
function maxQuoteTimeMs(now: number, quotes: Quote[]): number | null {
  let max: number | null = null
  for (const quote of quotes) {
    const ms = clockTimeMsToday(now, quote.quoteTime)
    if (ms !== null && (max === null || ms > max)) {
      max = ms
    }
  }
  return max
}

/**
 * 下一次「交易时段起点」（用于节假日休市后重新尝试）：
 * now 处于上午盘（09:30–11:30）→ 当日 13:00；
 * 否则（含午休 / 下午盘后 / 非交易日）→ 下一个工作日 09:30。
 */
export function nextSessionStart(now: number): number {
  const date = new Date(now)
  const sec =
    date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
  if (isTradingDay(date) && sec >= MORNING_START_SEC && sec < MORNING_END_SEC) {
    return atClock(date, 13, 0)
  }
  return nextTradingDayOpen(date)
}

/** 构造空 Quote（无数据 / 停牌），供快照补齐用 */
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

/**
 * 行情刷新调度器（纯逻辑）。
 *
 * 决策顺序：暂停 → 节假日 → 预热 / 交易时段取数 → 非交易时段休市。
 * 每轮结束都会推送一次快照，保证渲染层时间戳与状态同步。
 */
export class MarketScheduler {
  private readonly deps: MarketSchedulerDeps
  private readonly now: () => number
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false

  /** 内部状态 */
  private paused: boolean
  private failureCount = 0
  private inFlight = false
  private holiday = false
  private holidaySince: number | null = null
  private lastDataTimeMs: number | null = null
  private dataSessionRef: number | null = null
  private stagnantSince: number | null = null
  private lastSuccessAt: number | null = null
  private lastQuotes: Quote[] | null = null

  /** 快照字段 */
  private status: MarketStatus
  private trading = false
  private nextOpen: number | null = null
  private nextOpenLabel: string | null = null
  private closedReason: string | null = null

  constructor(deps: MarketSchedulerDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout
    this.paused = deps.getSettings().paused
    this.status = this.paused ? 'paused' : 'loading'
  }

  /** 开始调度（立即跑一轮 tick，并根据结果排下一个定时器） */
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

  /** 手动立即刷新（无视交易时段），失败不抛异常 */
  async refreshNow(): Promise<void> {
    if (this.inFlight) {
      return
    }
    const now = this.now()
    this.trading = isTradingTime(new Date(now))
    if (!this.trading && !this.holiday) {
      const open = nextOpenAt(new Date(now))
      this.nextOpen = open.at
      this.nextOpenLabel = open.label
      this.closedReason = closedReasonText(new Date(now))
    }
    await this.fetchAndApply(now)
    this.emit()
  }

  /** 设置变化后重新评估调度（例如用户切换暂停开关） */
  reevaluate(): void {
    if (!this.running) {
      return
    }
    this.clearTimer()
    this.tick()
  }

  /** 读取当前快照（未跑过则返回初始 loading / paused 快照） */
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
    const now = this.now()
    this.paused = this.deps.getSettings().paused

    // 1. 用户暂停：不请求，只轮询等待 reevaluate
    if (this.paused) {
      this.status = 'paused'
      this.trading = isTradingTime(new Date(now))
      this.nextOpen = null
      this.nextOpenLabel = null
      this.closedReason = null
      this.emit()
      this.schedule(PAUSE_POLL_MS)
      return
    }

    // 2. 交易时段判定
    const trading = isTradingTime(new Date(now))
    this.trading = trading

    // 4. 节假日休市：只等待下一个时段起点
    if (this.holiday) {
      this.applyHoliday(now)
      return
    }

    // 3. 是否取数：交易时段，或距开盘 1 分钟内预热
    const open = nextOpenAt(new Date(now))
    const prewarm = !trading && open.at > 0 && open.at - now <= RESUME_AHEAD_MS
    const shouldFetch = trading || prewarm

    // 5. 非交易时段休市
    if (!shouldFetch) {
      this.status = 'closed'
      this.trading = false
      this.closedReason = closedReasonText(new Date(now))
      this.nextOpen = open.at
      this.nextOpenLabel = open.label
      this.emit()
      const delay = Math.max(0, open.at - RESUME_AHEAD_MS - now)
      this.schedule(delay + TIMER_SLACK_MS)
      return
    }

    // 6. 单轮在途：跳过本轮，仍按当前节奏排下一个定时器
    if (this.inFlight) {
      this.emit()
      this.schedule(this.nextInterval())
      return
    }

    await this.fetchAndApply(now)
    if (!this.running) {
      return
    }
    if (this.holiday) {
      this.applyHoliday(now)
      return
    }
    this.emit()
    this.schedule(this.nextInterval())
  }

  /**
   * 发起一轮取数并更新内部数据；不做定时器安排与快照推送。
   * 成功保留本轮数据，失败保留上一轮成功数据。
   */
  private async fetchAndApply(now: number): Promise<void> {
    const watchlist = this.deps.getWatchlist()
    const symbols = [...INDEX_SYMBOLS, ...watchlist.map((item) => item.symbol)]
    this.inFlight = true
    this.status = 'refreshing'
    try {
      const result = await this.deps.fetchQuotes(symbols)
      this.inFlight = false
      this.failureCount = 0
      this.lastSuccessAt = now
      this.lastQuotes = result
      this.status = 'ok'
      if (this.trading) {
        this.nextOpen = null
        this.nextOpenLabel = null
        this.closedReason = null
        this.trackStagnation(now, result)
      }
    } catch {
      this.inFlight = false
      this.failureCount += 1
      this.status = this.lastSuccessAt !== null ? 'failed' : 'load-failed'
    }
  }

  /**
   * 节假日休市判定（仅交易时段且本轮成功时调用）：
   * 数据时间连续 STALE_LIMIT_MS 未前进即判定休市。
   */
  private trackStagnation(now: number, result: Quote[]): void {
    // 跨时段（含跨日）后数据时间不具备可比性，重置基线
    if (
      this.dataSessionRef === null ||
      !isSameTradingSession(now, this.dataSessionRef)
    ) {
      this.lastDataTimeMs = null
      this.stagnantSince = null
      this.dataSessionRef = now
    }
    const dataTimeMs = maxQuoteTimeMs(now, result)
    if (dataTimeMs === null) {
      // 无任何数据时间，不参与判定
      return
    }
    if (this.lastDataTimeMs === null || dataTimeMs > this.lastDataTimeMs) {
      this.lastDataTimeMs = dataTimeMs
      this.stagnantSince = null
      return
    }
    const sessionStart = sessionStartOf(now)
    // 刚开盘 90 秒内数据可能尚未推进，不开始计时
    if (sessionStart === null || now - sessionStart < HOLIDAY_GRACE_MS) {
      return
    }
    if (this.stagnantSince === null) {
      this.stagnantSince = now
    }
    if (now - this.stagnantSince >= STALE_LIMIT_MS) {
      this.holiday = true
      if (this.holidaySince === null) {
        this.holidaySince = now
      }
    }
  }

  /** 节假日分支：展示休市状态并等到下一个时段起点再重新评估 */
  private applyHoliday(now: number): void {
    this.holiday = true
    if (this.holidaySince === null) {
      this.holidaySince = now
    }
    const at = nextSessionStart(now)
    this.status = 'closed'
    this.trading = false
    this.closedReason = '节假日休市'
    this.nextOpen = at
    this.nextOpenLabel = `${formatDateLabel(new Date(at))} 09:30 开盘`
    this.emit()
    const delay = Math.max(0, at - now)
    this.schedule(delay + TIMER_SLACK_MS, () => {
      this.holiday = false
      this.holidaySince = null
      this.stagnantSince = null
      this.lastDataTimeMs = null
      this.dataSessionRef = null
    })
  }

  /** 当前节奏下的刷新间隔：连续失败达阈值后退避 */
  private nextInterval(): number {
    return this.failureCount >= FAILURE_THRESHOLD
      ? BACKOFF_INTERVAL_MS
      : REFRESH_INTERVAL_MS
  }

  /** 排下一个定时器（递归 setTimeout，便于动态改变间隔） */
  private schedule(delayMs: number, beforeTick?: () => void): void {
    if (!this.running) {
      return
    }
    this.clearTimer()
    this.timer = this.setTimeoutFn(
      () => {
        this.timer = null
        beforeTick?.()
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

  /** 取快照：indices 固定 3 条，quotes 与当前自选股一一对齐 */
  private buildSnapshot(): MarketSnapshot {
    return {
      status: this.status,
      trading: this.trading,
      indices: this.buildIndices(),
      quotes: this.buildWatchQuotes(),
      updatedAt: this.lastSuccessAt,
      updatedAtLabel: formatClockTime(this.lastSuccessAt),
      failureCount: this.failureCount,
      nextOpenAt: this.nextOpen,
      nextOpenLabel: this.nextOpenLabel,
      closedReason: this.closedReason
    }
  }

  private buildIndices(): Quote[] {
    return INDEX_SYMBOLS.map((symbol) => {
      const cached = this.findQuote(symbol)
      if (cached) {
        return cached.name ? cached : { ...cached, name: INDEX_NAMES[symbol] }
      }
      return emptyQuote(symbol, INDEX_NAMES[symbol])
    })
  }

  private buildWatchQuotes(): Quote[] {
    return this.deps.getWatchlist().map((item) => {
      const cached = this.findQuote(item.symbol)
      if (cached) {
        return cached.name ? cached : { ...cached, name: item.name }
      }
      return emptyQuote(item.symbol, item.name)
    })
  }

  private findQuote(symbol: string): Quote | null {
    if (!this.lastQuotes) {
      return null
    }
    const target = symbol.toLowerCase()
    return (
      this.lastQuotes.find((quote) => quote.symbol.toLowerCase() === target) ??
      null
    )
  }
}
