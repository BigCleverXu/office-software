import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type {
  AddWatchResult,
  MarketPosition,
  MarketRegion,
  MarketSettings,
  MarketSnapshot,
  MarketState,
  WatchItem
} from '@shared/market'
import type { AppModuleId } from '@shared/navigation'

interface UseMarket {
  snapshot: Ref<MarketSnapshot>
  usSnapshot: Ref<MarketSnapshot>
  watchlist: Ref<WatchItem[]>
  cnWatchlist: ComputedRef<WatchItem[]>
  usWatchlist: ComputedRef<WatchItem[]>
  settings: Ref<MarketSettings>
  region: ComputedRef<MarketRegion>
  loaded: Ref<boolean>
  addWatch: (code: string, position?: MarketPosition) => Promise<AddWatchResult>
  updatePosition: (
    symbol: string,
    position: MarketPosition
  ) => Promise<WatchItem | null>
  removeWatch: (symbol: string) => Promise<boolean>
  refreshNow: () => Promise<void>
  setPaused: (paused: boolean) => Promise<boolean>
  setLastPage: (page: AppModuleId) => Promise<void>
  setRegion: (region: MarketRegion) => Promise<boolean>
}

/** 首次加载且尚未拿到数据时的初始快照 */
const INITIAL_SNAPSHOT: MarketSnapshot = {
  status: 'loading',
  trading: false,
  indices: [],
  quotes: [],
  updatedAt: null,
  updatedAtLabel: null,
  failureCount: 0,
  nextOpenAt: null,
  nextOpenLabel: null,
  closedReason: null
}

/** 美股快照的初始值，结构与 A 股快照一致 */
const INITIAL_US_SNAPSHOT: MarketSnapshot = {
  ...INITIAL_SNAPSHOT,
  indices: [],
  quotes: []
}

const INITIAL_SETTINGS: MarketSettings = {
  paused: false,
  lastPage: 'alarms',
  region: 'cn'
}

/**
 * 行情数据 composable：封装与主进程的 IPC 交互与响应式状态。
 * 挂载时拉取初始状态并订阅主进程推送的变更。
 */
export function useMarket(): UseMarket {
  const snapshot = ref<MarketSnapshot>({ ...INITIAL_SNAPSHOT })
  const usSnapshot = ref<MarketSnapshot>({ ...INITIAL_US_SNAPSHOT })
  const watchlist = ref<WatchItem[]>([])
  const settings = ref<MarketSettings>({ ...INITIAL_SETTINGS })
  const loaded = ref(false)
  let unsubscribe: (() => void) | null = null

  const region = computed<MarketRegion>(() => settings.value.region)

  const cnWatchlist = computed<WatchItem[]>(() =>
    watchlist.value.filter((item) => item.market !== 'us')
  )

  const usWatchlist = computed<WatchItem[]>(() =>
    watchlist.value.filter((item) => item.market === 'us')
  )

  const applyState = (state: MarketState): void => {
    snapshot.value = state.snapshot
    usSnapshot.value = state.us
    watchlist.value = state.watchlist
    settings.value = state.settings
  }

  const addWatch = async (
    code: string,
    position?: MarketPosition
  ): Promise<AddWatchResult> => {
    const result = await window.api.market.addWatch(code, position)
    if (result.ok) {
      const exists = watchlist.value.some(
        (item) => item.symbol === result.item.symbol
      )
      if (!exists) {
        watchlist.value = [...watchlist.value, result.item]
      }
    }
    return result
  }

  /** 更新持仓；失败时回滚本地列表并返回 null */
  const updatePosition = async (
    symbol: string,
    position: MarketPosition
  ): Promise<WatchItem | null> => {
    const previous = watchlist.value
    try {
      const updated = await window.api.market.updatePosition(symbol, position)
      if (!updated) {
        return null
      }
      watchlist.value = watchlist.value.map((item) =>
        item.symbol === updated.symbol ? updated : item
      )
      return updated
    } catch {
      watchlist.value = previous
      return null
    }
  }

  const removeWatch = async (symbol: string): Promise<boolean> => {
    const previous = watchlist.value
    try {
      watchlist.value = await window.api.market.removeWatch(symbol)
      return true
    } catch {
      watchlist.value = previous
      return false
    }
  }

  const refreshNow = (): Promise<void> => window.api.market.refreshNow()

  const setPaused = async (paused: boolean): Promise<boolean> => {
    const previous = settings.value
    settings.value = { ...settings.value, paused }
    try {
      await window.api.market.setPaused(paused)
      return true
    } catch {
      settings.value = previous
      return false
    }
  }

  const setLastPage = async (page: AppModuleId): Promise<void> => {
    settings.value = { ...settings.value, lastPage: page }
    await window.api.market.setLastPage(page)
  }

  const setRegion = async (next: MarketRegion): Promise<boolean> => {
    const previous = settings.value
    settings.value = { ...settings.value, region: next }
    try {
      await window.api.market.setRegion(next)
      return true
    } catch {
      settings.value = previous
      return false
    }
  }

  onMounted(async () => {
    applyState(await window.api.market.getState())
    loaded.value = true
    unsubscribe = window.api.market.onStateChanged((state) => {
      applyState(state)
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  return {
    snapshot,
    usSnapshot,
    watchlist,
    cnWatchlist,
    usWatchlist,
    settings,
    region,
    loaded,
    addWatch,
    updatePosition,
    removeWatch,
    refreshNow,
    setPaused,
    setLastPage,
    setRegion
  }
}
