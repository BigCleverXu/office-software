import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type {
  AddWatchResult,
  MarketSettings,
  MarketSnapshot,
  MarketState,
  WatchItem
} from '@shared/market'
import type { AppModuleId } from '@shared/navigation'

interface UseMarket {
  snapshot: Ref<MarketSnapshot>
  watchlist: Ref<WatchItem[]>
  settings: Ref<MarketSettings>
  loaded: Ref<boolean>
  addWatch: (code: string) => Promise<AddWatchResult>
  removeWatch: (symbol: string) => Promise<void>
  refreshNow: () => Promise<void>
  setPaused: (paused: boolean) => Promise<void>
  setLastPage: (page: AppModuleId) => Promise<void>
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

const INITIAL_SETTINGS: MarketSettings = {
  paused: false,
  lastPage: 'alarms'
}

/**
 * 行情数据 composable：封装与主进程的 IPC 交互与响应式状态。
 * 挂载时拉取初始状态并订阅主进程推送的变更。
 */
export function useMarket(): UseMarket {
  const snapshot = ref<MarketSnapshot>({ ...INITIAL_SNAPSHOT })
  const watchlist = ref<WatchItem[]>([])
  const settings = ref<MarketSettings>({ ...INITIAL_SETTINGS })
  const loaded = ref(false)
  let unsubscribe: (() => void) | null = null

  const applyState = (state: MarketState): void => {
    snapshot.value = state.snapshot
    watchlist.value = state.watchlist
    settings.value = state.settings
  }

  const addWatch = async (code: string): Promise<AddWatchResult> => {
    const result = await window.api.market.addWatch(code)
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

  const removeWatch = async (symbol: string): Promise<void> => {
    watchlist.value = await window.api.market.removeWatch(symbol)
  }

  const refreshNow = (): Promise<void> => window.api.market.refreshNow()

  const setPaused = async (paused: boolean): Promise<void> => {
    settings.value = { ...settings.value, paused }
    await window.api.market.setPaused(paused)
  }

  const setLastPage = async (page: AppModuleId): Promise<void> => {
    settings.value = { ...settings.value, lastPage: page }
    await window.api.market.setLastPage(page)
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
    watchlist,
    settings,
    loaded,
    addWatch,
    removeWatch,
    refreshNow,
    setPaused,
    setLastPage
  }
}
