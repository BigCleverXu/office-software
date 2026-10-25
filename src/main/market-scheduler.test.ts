import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INDEX_SYMBOLS,
  type MarketSettings,
  type MarketSnapshot,
  type Quote,
  type WatchItem
} from '../shared/market'
import { MarketScheduler, nextSessionStart } from './market-scheduler'

// 2026-04-14 是周二；2026-04-15 周三；2026-04-17 周五；2026-04-18 周六
function at(
  hour: number,
  minute: number,
  second = 0,
  month = 3,
  day = 14
): Date {
  return new Date(2026, month, day, hour, minute, second)
}

/** 确定性 Quote 构造，缺省 quoteTime 固定为 '10:00:00' */
function makeQuote(overrides: Partial<Quote> & { symbol: string }): Quote {
  const symbol = overrides.symbol
  const base: Quote = {
    symbol,
    code: symbol.replace(/^(sh|sz)/i, ''),
    market: symbol.startsWith('sz') ? 'sz' : 'sh',
    name: '测试标的',
    price: 10,
    prevClose: 9,
    change: 1,
    changePercent: 11.11,
    open: 9.5,
    high: 10.5,
    low: 9.4,
    amount: 12345678,
    quoteTime: '10:00:00',
    missing: false
  }
  return { ...base, ...overrides }
}

const WATCH: WatchItem[] = [
  {
    code: '600519',
    symbol: 'sh600519',
    market: 'sh',
    name: '贵州茅台',
    addedAt: 1,
    sortOrder: 0
  },
  {
    code: '000001',
    symbol: 'sz000001',
    market: 'sz',
    name: '平安银行',
    addedAt: 2,
    sortOrder: 1
  }
]

/** 可手动 resolve 的 promise，用于构造「请求在途」场景 */
function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolveFn: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve
  })
  return { promise, resolve: (value: T) => resolveFn(value) }
}

/** 默认假取数：为每个请求的 symbol 返回一条成功 Quote */
function defaultFetch(symbols: string[]): Promise<Quote[]> {
  return Promise.resolve(symbols.map((symbol) => makeQuote({ symbol })))
}

interface Harness {
  scheduler: MarketScheduler
  fetches: ReturnType<typeof vi.fn>
  snapshots: MarketSnapshot[]
  watchlist: WatchItem[]
  settings: MarketSettings
  setFetch: (impl: (symbols: string[]) => Promise<Quote[]>) => void
}

function createHarness(
  options: {
    watchlist?: WatchItem[]
    settings?: Partial<MarketSettings>
    fetchImpl?: (symbols: string[]) => Promise<Quote[]>
  } = {}
): Harness {
  const watchlist = options.watchlist ?? [...WATCH]
  const settings: MarketSettings = {
    paused: false,
    lastPage: 'market',
    region: 'cn',
    ...options.settings
  }
  let fetchImpl = options.fetchImpl ?? defaultFetch
  const fetches = vi.fn((symbols: string[]) => fetchImpl(symbols))
  const snapshots: MarketSnapshot[] = []
  const scheduler = new MarketScheduler({
    fetchQuotes: fetches,
    getWatchlist: () => watchlist,
    getSettings: () => settings,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    now: () => Date.now()
  })
  return {
    scheduler,
    fetches,
    snapshots,
    watchlist,
    settings,
    setFetch: (impl) => {
      fetchImpl = impl
    }
  }
}

/** 释放微任务队列（让已 resolve 的取数继续跑完） */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('nextSessionStart', () => {
  it('上午盘返回当日 13:00', () => {
    expect(nextSessionStart(at(10, 0).getTime())).toBe(at(13, 0).getTime())
    expect(nextSessionStart(at(11, 0).getTime())).toBe(at(13, 0).getTime())
  })

  it('下午盘后返回下一工作日 09:30', () => {
    expect(nextSessionStart(at(14, 0).getTime())).toBe(
      at(9, 30, 0, 3, 15).getTime()
    )
  })

  it('周五下午盘后返回下周一 09:30', () => {
    expect(nextSessionStart(at(14, 0, 0, 3, 17).getTime())).toBe(
      at(9, 30, 0, 3, 20).getTime()
    )
  })
})

describe('MarketScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('交易时段每 3 秒请求一次', async () => {
    vi.setSystemTime(at(10, 0))
    const harness = createHarness()

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.fetches.mock.calls[0][0]).toEqual([
      ...INDEX_SYMBOLS,
      'sh600519',
      'sz000001'
    ])
    const first = harness.scheduler.getSnapshot()
    expect(first.status).toBe('ok')
    expect(first.trading).toBe(true)
    expect(first.indices).toHaveLength(3)
    expect(first.quotes).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(3000)
    expect(harness.fetches).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3000)
    expect(harness.fetches).toHaveBeenCalledTimes(3)

    harness.scheduler.stop()
  })

  it('午休 12:00 不请求，展示午间休市与 13:00 恢复', async () => {
    vi.setSystemTime(at(12, 0))
    const harness = createHarness()

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).not.toHaveBeenCalled()
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.trading).toBe(false)
    expect(snapshot.closedReason).toBe('午间休市')
    expect(snapshot.nextOpenLabel).toBe('13:00 恢复')
    expect(snapshot.nextOpenAt).toBe(at(13, 0).getTime())
  })

  it('收盘 16:00 不请求，展示已收盘与下一工作日开盘', async () => {
    vi.setSystemTime(at(16, 0))
    const harness = createHarness()

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).not.toHaveBeenCalled()
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.closedReason).toBe('已收盘')
    expect(snapshot.nextOpenLabel).toBe('04-15 09:30 开盘')
    expect(snapshot.nextOpenAt).toBe(at(9, 30, 0, 3, 15).getTime())
  })

  it('周末不请求，展示周末休市', async () => {
    vi.setSystemTime(at(10, 0, 0, 3, 18))
    const harness = createHarness()

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).not.toHaveBeenCalled()
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.closedReason).toBe('周末休市')
    expect(snapshot.nextOpenLabel).toBe('04-20 09:30 开盘')
  })

  it('开盘前 1 分钟内预热并开始请求', async () => {
    vi.setSystemTime(at(9, 28, 30))
    const harness = createHarness()

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).not.toHaveBeenCalled()
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.closedReason).toBe('开盘前')
    expect(snapshot.nextOpenLabel).toBe('09:30 开盘')

    // 越过 resume 时刻（09:29:00）后开始请求
    await vi.advanceTimersByTimeAsync(31_000)
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    harness.scheduler.stop()
  })

  it('单轮在途时跳过本轮，不重复请求', async () => {
    vi.setSystemTime(at(10, 0))
    const deferred = createDeferred<Quote[]>()
    const harness = createHarness({ fetchImpl: () => deferred.promise })

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.scheduler.getSnapshot().status).toBe('refreshing')

    // 在途期间重新评估：跳过本轮，只排下一个定时器
    harness.scheduler.reevaluate()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    harness.scheduler.stop()
  })

  it('单次失败保留旧数据并标记 failed', async () => {
    vi.setSystemTime(at(10, 0))
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.scheduler.getSnapshot().status).toBe('ok')

    harness.setFetch(() => Promise.reject(new Error('network')))
    await vi.advanceTimersByTimeAsync(3000)

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('failed')
    expect(snapshot.failureCount).toBe(1)
    expect(snapshot.quotes).toHaveLength(2)
    expect(snapshot.quotes[0].price).toBe(10)

    harness.scheduler.stop()
  })

  it('连续失败 3 次后退避到 30 秒', async () => {
    vi.setSystemTime(at(10, 0))
    const harness = createHarness({
      fetchImpl: () => Promise.reject(new Error('network'))
    })

    harness.scheduler.start()
    await flush()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)

    expect(harness.fetches).toHaveBeenCalledTimes(3)
    expect(harness.scheduler.getSnapshot().failureCount).toBe(3)

    // 退避期间 3 秒不再触发
    await vi.advanceTimersByTimeAsync(3000)
    expect(harness.fetches).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(harness.fetches).toHaveBeenCalledTimes(4)

    harness.scheduler.stop()
  })

  it('失败后成功一次即恢复 3 秒节奏', async () => {
    vi.setSystemTime(at(10, 0))
    const harness = createHarness({
      fetchImpl: () => Promise.reject(new Error('network'))
    })

    harness.scheduler.start()
    await flush()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)
    expect(harness.scheduler.getSnapshot().failureCount).toBe(3)

    harness.setFetch(defaultFetch)
    await vi.advanceTimersByTimeAsync(30_000)
    const recovered = harness.scheduler.getSnapshot()
    expect(recovered.status).toBe('ok')
    expect(recovered.failureCount).toBe(0)

    await vi.advanceTimersByTimeAsync(3000)
    expect(harness.fetches).toHaveBeenCalledTimes(5)

    harness.scheduler.stop()
  })

  it('首次即失败且无数据时进入 load-failed', async () => {
    vi.setSystemTime(at(10, 0))
    const harness = createHarness({
      fetchImpl: () => Promise.reject(new Error('network'))
    })

    harness.scheduler.start()
    await flush()

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('load-failed')
    expect(snapshot.failureCount).toBe(1)
    expect(snapshot.indices.every((quote) => quote.missing)).toBe(true)
    expect(snapshot.updatedAt).toBeNull()

    harness.scheduler.stop()
  })

  it('数据时间停滞超过 60 秒后判定节假日休市', async () => {
    vi.setSystemTime(at(10, 0))
    const harness = createHarness({
      fetchImpl: (symbols) =>
        Promise.resolve(
          symbols.map((symbol) => makeQuote({ symbol, quoteTime: '10:00:00' }))
        )
    })

    harness.scheduler.start()
    await flush()
    expect(harness.scheduler.getSnapshot().status).toBe('ok')

    // 推进 63 秒：数据时间恰好停滞满 60 秒
    await vi.advanceTimersByTimeAsync(63_000)
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.closedReason).toBe('节假日休市')
    expect(snapshot.nextOpenAt).toBe(at(13, 0).getTime())

    const calls = harness.fetches.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.fetches).toHaveBeenCalledTimes(calls)

    harness.scheduler.stop()
  })

  it('暂停时不请求，恢复后重新请求', async () => {
    vi.setSystemTime(at(10, 0))
    const harness = createHarness({ settings: { paused: true } })

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).not.toHaveBeenCalled()
    expect(harness.scheduler.getSnapshot().status).toBe('paused')

    harness.settings.paused = false
    harness.scheduler.reevaluate()
    await flush()

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.scheduler.getSnapshot().status).toBe('ok')

    harness.scheduler.stop()
  })

  it('refreshNow 在非交易时段也立即请求', async () => {
    vi.setSystemTime(at(16, 0))
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.fetches).not.toHaveBeenCalled()

    await harness.scheduler.refreshNow()

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.status).toBe('ok')
    expect(snapshot.updatedAtLabel).toBe('16:00:00')

    harness.scheduler.stop()
  })

  it('刷新过程中删除自选股后不再出现在快照中', async () => {
    vi.setSystemTime(at(10, 0))
    const deferred = createDeferred<Quote[]>()
    const harness = createHarness({ fetchImpl: () => deferred.promise })

    harness.scheduler.start()
    await flush()

    harness.watchlist.splice(1, 1)
    deferred.resolve(
      [...INDEX_SYMBOLS, 'sh600519', 'sz000001'].map((symbol) =>
        makeQuote({ symbol })
      )
    )
    await flush()

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.quotes.map((quote) => quote.symbol)).toEqual(['sh600519'])

    harness.scheduler.stop()
  })

  it('接口缺失指数时补 missing 空 Quote 且带指数名', async () => {
    vi.setSystemTime(at(10, 0))
    const harness = createHarness({
      fetchImpl: () =>
        Promise.resolve([makeQuote({ symbol: 'sh000001', name: '' })])
    })

    harness.scheduler.start()
    await flush()

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.indices).toHaveLength(3)
    expect(snapshot.indices[0].symbol).toBe('sh000001')
    expect(snapshot.indices[0].name).toBe('上证指数')
    expect(snapshot.indices[1].missing).toBe(true)
    expect(snapshot.indices[1].name).toBe('深证成指')
    expect(snapshot.quotes[0].missing).toBe(true)
    expect(snapshot.quotes[0].name).toBe('贵州茅台')

    harness.scheduler.stop()
  })
})
