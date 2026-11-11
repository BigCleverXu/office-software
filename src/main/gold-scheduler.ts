// 主进程金价刷新调度器：定频请求、连续失败退避的纯逻辑实现。
// 不依赖 electron，时钟与定时器均可注入，便于单元测试。
import {
  formatUpdatedLabel,
  GOLD_BACKOFF_INTERVAL_MS,
  GOLD_FAILURE_THRESHOLD,
  GOLD_NAMES,
  GOLD_REFRESH_INTERVAL_MS,
  GOLD_SYMBOLS,
  type GoldHolding,
  type GoldQuote,
  type GoldSnapshot,
  type GoldStatus,
  type GoldSymbol
} from '../shared/gold'

export interface GoldSchedulerDeps {
  /** 取数函数；生产环境用 gold-provider 的 fetchGoldQuotes，测试时注入假实现 */
  fetchQuotes: () => Promise<GoldQuote[]>
  /** 读取当前持仓（每轮现读，保证修改后下一轮快照即可带上） */
  getHolding: () => GoldHolding
  /** 每轮状态变化时回调 */
  onSnapshot: (snapshot: GoldSnapshot) => void
  /** 注入时钟，默认 Date.now */
  now?: () => number
  /** 注入定时器，默认 setTimeout/clearTimeout（便于测试） */
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

/** 构造空行情，供首轮数据返回前占位 */
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

/**
 * 金价刷新调度器（纯逻辑）。
 *
 * 每轮成功后再排下一轮：常规间隔 10 秒；连续失败达到阈值后退避到
 * 30 秒；任意一次成功即清零失败计数并回到 10 秒。
 */
export class GoldScheduler {
  private readonly deps: GoldSchedulerDeps
  private readonly now: () => number
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private stopped = false

  /** 内部状态 */
  private status: GoldStatus = 'loading'
  private failureCount = 0
  private inFlight: Promise<void> | null = null
  private lastQuotes: GoldQuote[] | null = null
  private lastSuccessAt: number | null = null

  constructor(deps: GoldSchedulerDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout
  }

  /** 开始调度：立即刷新一轮，成功 / 失败后再排下一个定时器 */
  start(): void {
    if (this.running) {
      return
    }
    this.stopped = false
    this.running = true
    void this.tick()
  }

  /** 停止调度并清掉定时器；之后不再触发任何刷新 */
  stop(): void {
    this.stopped = true
    this.running = false
    this.clearTimer()
  }

  /** 手动立即刷新一轮（并发调用复用同一请求，避免重叠） */
  refreshNow(): Promise<void> {
    return this.runOnce()
  }

  /** 读取当前快照（未跑过则返回 loading 空快照） */
  getSnapshot(): GoldSnapshot {
    return this.buildSnapshot()
  }

  /** 定时器回调：跑完一轮后按当前节奏排下一轮 */
  private async tick(): Promise<void> {
    if (!this.running) {
      return
    }
    await this.runOnce()
    if (!this.running) {
      return
    }
    this.schedule()
  }

  /** 单轮取数；已有请求在途时直接复用，避免并发重叠 */
  private runOnce(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }
    if (this.inFlight) {
      return this.inFlight
    }
    const task = this.performRound().finally(() => {
      this.inFlight = null
    })
    this.inFlight = task
    return task
  }

  /** 发起一轮请求并更新内部状态；失败保留上一轮成功数据 */
  private async performRound(): Promise<void> {
    this.status = 'refreshing'
    this.emit()
    try {
      const quotes = await this.deps.fetchQuotes()
      if (this.stopped) {
        return
      }
      this.lastQuotes = quotes
      this.lastSuccessAt = this.now()
      this.failureCount = 0
      this.status = 'ok'
    } catch {
      if (this.stopped) {
        return
      }
      this.failureCount += 1
      // 尚无任何成功数据时仍视为首次加载，有旧数据才标记失败
      this.status = this.lastSuccessAt !== null ? 'failed' : 'loading'
    }
    if (this.stopped) {
      return
    }
    this.emit()
  }

  /** 当前节奏下的刷新间隔：连续失败达阈值后退避 */
  private nextInterval(): number {
    return this.failureCount >= GOLD_FAILURE_THRESHOLD
      ? GOLD_BACKOFF_INTERVAL_MS
      : GOLD_REFRESH_INTERVAL_MS
  }

  /** 排下一个定时器（递归 setTimeout，便于动态改变间隔） */
  private schedule(): void {
    if (!this.running) {
      return
    }
    this.clearTimer()
    this.timer = this.setTimeoutFn(() => {
      this.timer = null
      void this.tick()
    }, this.nextInterval())
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

  private buildSnapshot(): GoldSnapshot {
    return {
      status: this.status,
      quotes:
        this.lastQuotes ?? GOLD_SYMBOLS.map((symbol) => emptyQuote(symbol)),
      holding: this.deps.getHolding(),
      updatedAt: this.lastSuccessAt,
      updatedAtLabel: formatUpdatedLabel(this.lastSuccessAt),
      failureCount: this.failureCount
    }
  }
}
