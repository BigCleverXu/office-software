import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GOLD_HOLDING,
  GOLD_NAMES,
  GOLD_SYMBOLS,
  type GoldHolding,
  type GoldQuote,
  type GoldSnapshot
} from '../../src/shared/gold'
import { GoldScheduler } from '../../src/main/gold-scheduler'

/** 构造一轮成功行情，数值与真实接口量级一致 */
function makeQuotes(): GoldQuote[] {
  return [
    {
      symbol: 'au9999',
      name: GOLD_NAMES.au9999,
      price: 869,
      prevClose: 883.42,
      change: -14.42,
      changePercent: -1.6323,
      open: 876,
      high: 878.6,
      low: 862.05,
      quoteTime: '09:57:40',
      missing: false
    },
    {
      symbol: 'xau',
      name: GOLD_NAMES.xau,
      price: 4045.5,
      prevClose: 4032.73,
      change: 12.77,
      changePercent: 0.3167,
      open: null,
      high: 4052.49,
      low: 4026.55,
      quoteTime: '09:57:00',
      missing: false
    },
    {
      symbol: 'cnh',
      name: GOLD_NAMES.cnh,
      price: 6.6742,
      prevClose: 6.6763,
      change: -0.0021,
      changePercent: 0.0011,
      open: null,
      high: null,
      low: null,
      quoteTime: '09:57:40',
      missing: false
    }
  ]
}

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

interface Harness {
  scheduler: GoldScheduler
  fetches: ReturnType<typeof vi.fn>
  snapshots: GoldSnapshot[]
  holding: GoldHolding
  setFetch: (impl: () => Promise<GoldQuote[]>) => void
}

function createHarness(
  fetchImpl: () => Promise<GoldQuote[]> = () => Promise.resolve(makeQuotes())
): Harness {
  let impl = fetchImpl
  const fetches = vi.fn(() => impl())
  const snapshots: GoldSnapshot[] = []
  const scheduler = new GoldScheduler({
    fetchQuotes: fetches,
    getHolding: () => harness.holding,
    onSnapshot: (snapshot) => snapshots.push(snapshot)
  })
  const harness: Harness = {
    scheduler,
    fetches,
    snapshots,
    holding: { ...DEFAULT_GOLD_HOLDING },
    setFetch: (next) => {
      impl = next
    }
  }
  return harness
}

/** 释放微任务队列（让已 resolve 的取数继续跑完） */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('GoldScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 11, 10, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('启动后立即刷新，成功后按 10 秒节奏', async () => {
    const harness = createHarness()

    harness.scheduler.start()
    await flush()

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    const first = harness.scheduler.getSnapshot()
    expect(first.status).toBe('ok')
    expect(first.quotes.map((quote) => quote.symbol)).toEqual([...GOLD_SYMBOLS])
    expect(first.quotes.map((quote) => quote.price)).toEqual([
      869, 4045.5, 6.6742
    ])
    expect(first.updatedAt).toBe(Date.now())
    expect(first.updatedAtLabel).toBe('10:00:00')
    expect(first.failureCount).toBe(0)

    await vi.advanceTimersByTimeAsync(9999)
    expect(harness.fetches).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.fetches).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(harness.fetches).toHaveBeenCalledTimes(3)

    harness.scheduler.stop()
  })

  it('首次无数据且失败时保持 loading，失败后成功带旧数据标记 failed', async () => {
    const harness = createHarness()

    harness.setFetch(() => Promise.reject(new Error('network')))
    harness.scheduler.start()
    await flush()

    const loading = harness.scheduler.getSnapshot()
    expect(loading.status).toBe('loading')
    expect(loading.failureCount).toBe(1)
    expect(loading.updatedAt).toBeNull()
    expect(loading.updatedAtLabel).toBeNull()
    expect(loading.quotes.map((quote) => quote.missing)).toEqual([
      true,
      true,
      true
    ])

    harness.setFetch(() => Promise.resolve(makeQuotes()))
    await vi.advanceTimersByTimeAsync(10000)
    expect(harness.scheduler.getSnapshot().status).toBe('ok')

    harness.setFetch(() => Promise.reject(new Error('network')))
    await vi.advanceTimersByTimeAsync(10000)

    const failed = harness.scheduler.getSnapshot()
    expect(failed.status).toBe('failed')
    expect(failed.failureCount).toBe(1)
    // 失败保留上一轮成功数据
    expect(failed.quotes[0].price).toBe(869)
    expect(failed.updatedAt).toBe(Date.now() - 10000)

    harness.scheduler.stop()
  })

  it('连续失败 3 次后退避到 30 秒', async () => {
    const harness = createHarness()
    harness.setFetch(() => Promise.reject(new Error('network')))

    harness.scheduler.start()
    await flush()
    await vi.advanceTimersByTimeAsync(10000)
    await vi.advanceTimersByTimeAsync(10000)

    expect(harness.fetches).toHaveBeenCalledTimes(3)
    expect(harness.scheduler.getSnapshot().failureCount).toBe(3)

    // 退避期间 10 秒不再触发
    await vi.advanceTimersByTimeAsync(10000)
    expect(harness.fetches).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(20000)
    expect(harness.fetches).toHaveBeenCalledTimes(4)

    harness.scheduler.stop()
  })

  it('失败后退避期间任意一次成功即恢复 10 秒', async () => {
    const harness = createHarness()
    harness.setFetch(() => Promise.reject(new Error('network')))

    harness.scheduler.start()
    await flush()
    await vi.advanceTimersByTimeAsync(10000)
    await vi.advanceTimersByTimeAsync(10000)
    expect(harness.scheduler.getSnapshot().failureCount).toBe(3)

    harness.setFetch(() => Promise.resolve(makeQuotes()))
    await vi.advanceTimersByTimeAsync(30000)

    const recovered = harness.scheduler.getSnapshot()
    expect(recovered.status).toBe('ok')
    expect(recovered.failureCount).toBe(0)
    expect(harness.fetches).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(10000)
    expect(harness.fetches).toHaveBeenCalledTimes(5)

    harness.scheduler.stop()
  })

  it('stop 后清除定时器，不再触发刷新', async () => {
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    harness.scheduler.stop()
    await vi.advanceTimersByTimeAsync(60000)

    expect(harness.fetches).toHaveBeenCalledTimes(1)
  })

  it('refreshNow 并发调用只发一次请求', async () => {
    const deferred = createDeferred<GoldQuote[]>()
    const harness = createHarness(() => deferred.promise)

    const first = harness.scheduler.refreshNow()
    const second = harness.scheduler.refreshNow()

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(harness.scheduler.getSnapshot().status).toBe('refreshing')

    deferred.resolve(makeQuotes())
    await Promise.all([first, second])

    expect(harness.scheduler.getSnapshot().status).toBe('ok')
    expect(harness.fetches).toHaveBeenCalledTimes(1)
  })

  it('每轮重新读取持仓，修改后下一轮快照即可带上', async () => {
    const harness = createHarness()

    harness.scheduler.start()
    await flush()
    expect(harness.scheduler.getSnapshot().holding.grams).toBe(0)

    harness.holding = { grams: 10, costPerGram: 800, updatedAt: 1000 }
    await vi.advanceTimersByTimeAsync(10000)

    expect(harness.scheduler.getSnapshot().holding).toEqual({
      grams: 10,
      costPerGram: 800,
      updatedAt: 1000
    })

    harness.scheduler.stop()
  })
})
