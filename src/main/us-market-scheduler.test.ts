import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import {
  BACKOFF_INTERVAL_MS,
  US_INDEX_SYMBOLS,
  US_REFRESH_INTERVAL_MS,
  codeFromSymbol,
  marketFromSymbol,
  type MarketSettings,
  type MarketSnapshot,
  type Quote,
  type WatchItem
} from '../shared/market'
import {
  US_CLOSED_RETRY_MS,
  UsMarketScheduler,
  type UsMarketSchedulerDeps
} from './us-market-scheduler'

// 2025-07-15 周二，美东夏令时 EDT = UTC-4
/** 美东周二 08:00（开盘前） */
const PRE_OPEN_TIME = new Date('2025-07-15T12:00:00Z').getTime()
/** 美东周二 10:00（开盘） */
const REGULAR_TIME = new Date('2025-07-15T14:00:00Z').getTime()
/** 美东周二 21:00（已收盘） */
const AFTER_CLOSE_TIME = new Date('2025-07-16T01:00:00Z').getTime()
/** 美东周六 11:00（周末休市） */
const WEEKEND_TIME = new Date('2025-07-19T15:00:00Z').getTime()

/** 构造确定性 Quote，价格由调用方指定 */
function makeQuote(symbol: string, price: number): Quote {
  return {
    symbol,
    code: codeFromSymbol(symbol),
    market: marketFromSymbol(symbol),
    name: symbol,
    price,
    prevClose: price - 1,
    change: 1,
    changePercent: 1,
    open: price,
    high: price,
    low: price,
    amount: 1000,
    quoteTime: '10:00:00',
    missing: false
  }
}

const WATCH: WatchItem[] = [
  {
    code: 'AAPL',
    symbol: 'usAAPL',
    market: 'us',
    name: '苹果',
    addedAt: 1,
    sortOrder: 0
  },
  {
    code: 'TSLA',
    symbol: 'usTSLA',
    market: 'us',
    name: '特斯拉',
    addedAt: 2,
    sortOrder: 1
  }
]

interface Harness {
  scheduler: UsMarketScheduler
  fetches: Mock<(symbols: string[]) => Promise<Quote[]>>
  settings: MarketSettings
  setPrice: (price: number) => void
}

function createHarness(
  options: {
    watchlist?: WatchItem[]
    settings?: Partial<MarketSettings>
    price?: number
    fetchImpl?: (symbols: string[]) => Promise<Quote[]>
  } = {}
): Harness {
  const watchlist = options.watchlist ?? [...WATCH]
  const settings: MarketSettings = {
    paused: false,
    lastPage: 'market',
    region: 'us',
    ...options.settings
  }
  let price = options.price ?? 100
  const fetchImpl =
    options.fetchImpl ??
    ((symbols: string[]): Promise<Quote[]> =>
      Promise.resolve(symbols.map((symbol) => makeQuote(symbol, price))))
  const fetches: Mock<(symbols: string[]) => Promise<Quote[]>> = vi.fn(
    (symbols: string[]) => fetchImpl(symbols)
  )
  const snapshots: MarketSnapshot[] = []
  const deps: UsMarketSchedulerDeps = {
    fetchQuotes: fetches,
    getWatchlist: () => watchlist,
    getSettings: () => settings,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    now: () => Date.now()
  }
  const scheduler = new UsMarketScheduler(deps)
  return {
    scheduler,
    fetches,
    settings,
    setPrice: (next) => {
      price = next
    }
  }
}

/** 释放微任务队列（让已 resolve 的取数继续跑完） */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('UsMarketScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('开盘启动取一轮，指数 4 个且自选股按顺序对齐', async () => {
    vi.setSystemTime(REGULAR_TIME)
    const harness = createHarness()

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.fetches.mock.calls[0][0]).toEqual([
      ...US_INDEX_SYMBOLS,
      'usAAPL',
      'usTSLA'
    ])
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('ok')
    expect(snapshot.trading).toBe(true)
    expect(snapshot.indices).toHaveLength(4)
    expect(snapshot.indices.map((quote) => quote.symbol)).toEqual([
      ...US_INDEX_SYMBOLS
    ])
    expect(snapshot.indices[2].symbol).toBe('usNDX')
    expect(snapshot.quotes.map((quote) => quote.symbol)).toEqual([
      'usAAPL',
      'usTSLA'
    ])
    expect(snapshot.quotes[0].price).toBe(100)
    expect(snapshot.updatedAt).toBe(REGULAR_TIME)
    expect(snapshot.closedReason).toBeNull()
    expect(snapshot.nextOpenAt).toBeNull()
    expect(snapshot.nextOpenLabel).toBeNull()

    harness.scheduler.stop()
  })

  it('开盘按 5 秒节奏触发下一轮取数', async () => {
    vi.setSystemTime(REGULAR_TIME)
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(US_REFRESH_INTERVAL_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(2)

    harness.scheduler.stop()
  })

  it('周末休市且无缓存时只取一轮，随后等待开盘', async () => {
    vi.setSystemTime(WEEKEND_TIME)
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    // 不再按 5 秒轮询
    await vi.advanceTimersByTimeAsync(US_REFRESH_INTERVAL_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.trading).toBe(false)
    expect(snapshot.indices).toHaveLength(4)
    expect(snapshot.updatedAt).toBe(WEEKEND_TIME)
    expect(snapshot.updatedAtLabel).not.toBeNull()
    expect(snapshot.closedReason).toBe('周末休市')
    // 跨天文案：下一个交易日周一 09:30
    expect(snapshot.nextOpenLabel).toBe('07-21 09:30 开盘')
    expect(snapshot.nextOpenAt).toBe(new Date('2025-07-21T13:30:00Z').getTime())

    harness.scheduler.stop()
  })

  it('休市有缓存时只推快照，排到下次开盘前不再请求', async () => {
    vi.setSystemTime(AFTER_CLOSE_TIME)
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(US_REFRESH_INTERVAL_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    harness.scheduler.reevaluate()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.updatedAt).toBe(AFTER_CLOSE_TIME)
    const nextOpenAt = snapshot.nextOpenAt ?? 0
    const now = Date.now()
    expect(nextOpenAt).toBeGreaterThan(now)

    // 距下次开盘差 1 毫秒仍不请求
    await vi.advanceTimersByTimeAsync(nextOpenAt - now - 1)
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    // 到达开盘时刻（含余量）后恢复取数
    await vi.advanceTimersByTimeAsync(1_000)
    expect(harness.fetches).toHaveBeenCalledTimes(2)

    harness.scheduler.stop()
  })

  it('休市时手动刷新立即请求并更新快照', async () => {
    vi.setSystemTime(AFTER_CLOSE_TIME)
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.scheduler.getSnapshot().indices[0].price).toBe(100)

    harness.setPrice(200)
    await vi.advanceTimersByTimeAsync(1_000)
    await harness.scheduler.refreshNow()

    expect(harness.fetches).toHaveBeenCalledTimes(2)
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.indices[0].price).toBe(200)
    expect(snapshot.quotes[0].price).toBe(200)
    expect(snapshot.updatedAt).toBe(AFTER_CLOSE_TIME + 1_000)
    expect(snapshot.updatedAtLabel).not.toBeNull()

    harness.scheduler.stop()
  })

  it('休市首次取数失败后按 60 秒重试', async () => {
    vi.setSystemTime(AFTER_CLOSE_TIME)
    let failing = true
    const harness = createHarness({
      fetchImpl: (symbols) =>
        failing
          ? Promise.reject(new Error('network'))
          : Promise.resolve(symbols.map((symbol) => makeQuote(symbol, 300)))
    })

    harness.scheduler.start()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)
    const failed = harness.scheduler.getSnapshot()
    expect(failed.status).toBe('closed')
    expect(failed.indices[0].price).toBeNull()
    expect(failed.updatedAtLabel).toBeNull()

    await vi.advanceTimersByTimeAsync(US_CLOSED_RETRY_MS - 1)
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    failing = false
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.fetches).toHaveBeenCalledTimes(2)
    const retried = harness.scheduler.getSnapshot()
    expect(retried.indices[0].price).toBe(300)
    expect(retried.updatedAtLabel).not.toBeNull()

    harness.scheduler.stop()
  })

  it('连续失败 3 次后按 30 秒退避', async () => {
    vi.setSystemTime(REGULAR_TIME)
    const harness = createHarness({
      fetchImpl: () => Promise.reject(new Error('network'))
    })

    harness.scheduler.start()
    await flush()
    expect(harness.scheduler.getSnapshot().status).toBe('load-failed')

    await vi.advanceTimersByTimeAsync(US_REFRESH_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(US_REFRESH_INTERVAL_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(3)
    expect(harness.scheduler.getSnapshot().failureCount).toBe(3)

    // 第 3 次失败后进入退避：再过 5 秒不会请求
    await vi.advanceTimersByTimeAsync(US_REFRESH_INTERVAL_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(3)

    // 差 1 毫秒仍不触发，补满退避间隔才触发
    await vi.advanceTimersByTimeAsync(
      BACKOFF_INTERVAL_MS - US_REFRESH_INTERVAL_MS - 1
    )
    expect(harness.fetches).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.fetches).toHaveBeenCalledTimes(4)

    harness.scheduler.stop()
  })

  it('暂停时不请求，快照为 paused；恢复后立即取数', async () => {
    vi.setSystemTime(REGULAR_TIME)
    const harness = createHarness({ settings: { paused: true } })

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).not.toHaveBeenCalled()
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('paused')
    expect(snapshot.closedReason).toBeNull()
    expect(snapshot.nextOpenAt).toBeNull()
    expect(snapshot.nextOpenLabel).toBeNull()

    harness.settings.paused = false
    harness.scheduler.reevaluate()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.scheduler.getSnapshot().status).toBe('ok')

    harness.scheduler.stop()
  })

  it('stop 清理定时器且重复 start 不重复取数', async () => {
    vi.setSystemTime(REGULAR_TIME)
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    // 已在运行中，再次 start 直接返回
    harness.scheduler.start()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    harness.scheduler.stop()
    await vi.advanceTimersByTimeAsync(US_REFRESH_INTERVAL_MS * 2)
    expect(harness.fetches).toHaveBeenCalledTimes(1)
  })

  it('未评估时快照为 loading 且占位补齐', () => {
    vi.setSystemTime(PRE_OPEN_TIME)
    const harness = createHarness()

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('loading')
    expect(snapshot.trading).toBe(false)
    expect(snapshot.indices).toHaveLength(4)
    expect(snapshot.indices[0].name).toBe('道琼斯')
    expect(snapshot.quotes).toHaveLength(2)
    expect(snapshot.quotes[0].price).toBeNull()
    expect(snapshot.quotes[0].name).toBe('苹果')
    expect(snapshot.updatedAt).toBeNull()
    expect(snapshot.updatedAtLabel).toBeNull()
    expect(snapshot.failureCount).toBe(0)
    expect(snapshot.closedReason).toBe('开盘前')
    expect(harness.fetches).not.toHaveBeenCalled()
  })
})
