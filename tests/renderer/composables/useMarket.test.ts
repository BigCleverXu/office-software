import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AddWatchResult,
  MarketRegion,
  MarketSnapshot,
  MarketState,
  WatchItem
} from '../../../src/shared/market'
import type { AppModuleId } from '../../../src/shared/navigation'
import { useMarket } from '../../../src/renderer/src/composables/useMarket'

/** 模拟行情快照 */
const SNAPSHOT: MarketSnapshot = {
  status: 'ok',
  trading: true,
  indices: [],
  quotes: [],
  updatedAt: null,
  updatedAtLabel: null,
  failureCount: 0,
  nextOpenAt: null,
  nextOpenLabel: null,
  closedReason: null
}

/** 模拟行情页整体状态 */
const STATE: MarketState = {
  snapshot: SNAPSHOT,
  us: SNAPSHOT,
  watchlist: [],
  settings: { paused: false, lastPage: 'alarms', region: 'cn' }
}

/** 模拟的自选股条目 */
function makeWatch(symbol: string, addedAt = 0): WatchItem {
  return {
    code: symbol.replace(/^(sh|sz|us)/, ''),
    symbol,
    market: symbol.startsWith('us')
      ? 'us'
      : symbol.startsWith('sz')
        ? 'sz'
        : 'sh',
    name: symbol,
    addedAt,
    sortOrder: addedAt
  }
}

const getState = vi.fn<() => Promise<MarketState>>()
const addWatchApi = vi.fn<(code: string) => Promise<AddWatchResult>>()
const removeWatchApi = vi.fn<(symbol: string) => Promise<WatchItem[]>>()
const refreshNowApi = vi.fn<() => Promise<void>>()
const setPausedApi = vi.fn<(paused: boolean) => Promise<void>>()
const setLastPageApi = vi.fn<(page: AppModuleId) => Promise<void>>()
const setRegionApi = vi.fn<(region: MarketRegion) => Promise<void>>()
const onStateChangedApi = vi.fn<() => () => void>()

/** 模拟 preload 暴露的行情 API */
function stubMarketApi(): void {
  vi.stubGlobal('window', {
    api: {
      market: {
        getState,
        addWatch: addWatchApi,
        removeWatch: removeWatchApi,
        refreshNow: refreshNowApi,
        setPaused: setPausedApi,
        setLastPage: setLastPageApi,
        setRegion: setRegionApi,
        onStateChanged: onStateChangedApi
      }
    }
  })
}

beforeEach(() => {
  getState.mockReset()
  getState.mockResolvedValue(STATE)
  addWatchApi.mockReset()
  removeWatchApi.mockReset()
  refreshNowApi.mockReset()
  setPausedApi.mockReset()
  setLastPageApi.mockReset()
  setRegionApi.mockReset()
  onStateChangedApi.mockReset()
  onStateChangedApi.mockReturnValue(() => undefined)
  stubMarketApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMarket 失败回滚', () => {
  it('setPaused 失败时 settings 恢复为调用前的值', async () => {
    const { settings, setPaused } = useMarket()
    settings.value = { paused: false, lastPage: 'alarms', region: 'cn' }
    const before = { ...settings.value }
    setPausedApi.mockRejectedValue(new Error('ipc failed'))

    await expect(setPaused(true)).resolves.toBe(false)

    expect(settings.value).toEqual(before)
    expect(settings.value.paused).toBe(false)
  })

  it('setRegion 失败时 region 与 settings 回滚', async () => {
    const { settings, region, setRegion } = useMarket()
    settings.value = { paused: false, lastPage: 'alarms', region: 'cn' }
    const before = { ...settings.value }
    setRegionApi.mockRejectedValue(new Error('ipc failed'))

    await expect(setRegion('us')).resolves.toBe(false)

    expect(settings.value).toEqual(before)
    expect(region.value).toBe('cn')
  })

  it('removeWatch 失败时 watchlist 恢复为调用前的列表', async () => {
    const { watchlist, removeWatch } = useMarket()
    watchlist.value = [makeWatch('sh600519', 1), makeWatch('sz000001', 2)]
    const before = [...watchlist.value]
    removeWatchApi.mockRejectedValue(new Error('ipc failed'))

    await expect(removeWatch('sh600519')).resolves.toBe(false)

    expect(watchlist.value).toEqual(before)
  })
})
