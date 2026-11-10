import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  MARKET_CHANNELS,
  isMarketRegion,
  normalizeCode,
  normalizePosition,
  normalizeUsSymbol,
  type AddWatchResult,
  type MarketPosition,
  type MarketState,
  type WatchItem
} from '../../shared/market'
import type { AppModuleId } from '../../shared/navigation'
import type { MarketStore } from '../market-store'
import type { MarketScheduler } from '../market-scheduler'
import type { UsMarketScheduler } from '../us-market-scheduler'
import { fetchQuotes } from '../quote-provider'
import { fetchUsQuotes } from '../us-quote-provider'

export interface MarketIpcDeps {
  store: MarketStore
  scheduler: MarketScheduler
  usScheduler: UsMarketScheduler
  getWindow: () => BrowserWindow | null
}

/**
 * 注册行情相关的 IPC 通道。每次自选股 / 设置变更后把最新状态广播给渲染进程。
 *
 * 调度器通过 getWatchlist / getSettings 回调读取最新数据，因此无需额外重新调度。
 */
export function registerMarketIpc(deps: MarketIpcDeps): void {
  const { store, scheduler, usScheduler, getWindow } = deps

  const buildState = (): MarketState => ({
    snapshot: scheduler.getSnapshot(),
    us: usScheduler.getSnapshot(),
    watchlist: store.getWatchlist(),
    settings: store.getSettings()
  })

  const broadcast = (): void => {
    getWindow()?.webContents.send(MARKET_CHANNELS.stateChanged, buildState())
  }

  ipcMain.handle(MARKET_CHANNELS.getState, () => buildState())

  ipcMain.handle(
    MARKET_CHANNELS.addWatch,
    async (
      _event: Electron.IpcMainInvokeEvent,
      code: string,
      position?: MarketPosition
    ): Promise<AddWatchResult> => {
      // 6 位纯数字按 A 股处理，其余按美股 ticker 处理
      const isCnCode = /^\d{6}$/.test(code.trim())
      const normalized = isCnCode
        ? normalizeCode(code)
        : normalizeUsSymbol(code)
      if (!normalized) {
        return { ok: false, reason: 'invalid-code' }
      }
      const { code: pureCode, symbol, market } = normalized
      if (store.has(symbol)) {
        return { ok: false, reason: 'duplicate' }
      }
      // 用行情请求校验代码是否真实存在；超时 / 网络异常视为不可用
      const quotes = await (
        isCnCode
          ? fetchQuotes([symbol], { timeoutMs: 5000 })
          : fetchUsQuotes([symbol], { timeoutMs: 5000 })
      ).catch(() => null)
      if (!quotes) {
        return { ok: false, reason: 'unavailable' }
      }
      const quote = quotes[0]
      if (!quote || quote.missing || !quote.name) {
        return { ok: false, reason: 'not-found' }
      }
      const item = store.addWatch({
        code: pureCode,
        symbol,
        market,
        name: quote.name,
        position: normalizePosition(position)
      })
      // 不 await，避免阻塞添加弹窗关闭
      if (isCnCode) {
        void scheduler.refreshNow()
      } else {
        void usScheduler.refreshNow()
      }
      broadcast()
      return { ok: true, item }
    }
  )

  ipcMain.handle(
    MARKET_CHANNELS.updatePosition,
    (
      _event: Electron.IpcMainInvokeEvent,
      symbol: string,
      position: MarketPosition
    ): WatchItem | null => {
      const item = store.updatePosition(symbol, position)
      if (!item) {
        return null
      }
      broadcast()
      return item
    }
  )

  ipcMain.handle(
    MARKET_CHANNELS.removeWatch,
    (_event: Electron.IpcMainInvokeEvent, symbol: string) => {
      const list = store.removeWatch(symbol)
      broadcast()
      return list
    }
  )

  ipcMain.handle(MARKET_CHANNELS.refreshNow, async () => {
    await Promise.all([scheduler.refreshNow(), usScheduler.refreshNow()])
  })

  ipcMain.handle(
    MARKET_CHANNELS.setPaused,
    (_event: Electron.IpcMainInvokeEvent, paused: boolean) => {
      store.setPaused(paused)
      scheduler.reevaluate()
      usScheduler.reevaluate()
      broadcast()
    }
  )

  ipcMain.handle(
    MARKET_CHANNELS.setLastPage,
    (_event: Electron.IpcMainInvokeEvent, page: AppModuleId) => {
      store.setLastPage(page)
      broadcast()
    }
  )

  ipcMain.handle(
    MARKET_CHANNELS.setRegion,
    (_event: Electron.IpcMainInvokeEvent, region: unknown) => {
      if (!isMarketRegion(region)) {
        return
      }
      store.updateSettings({ region })
      if (region === 'us') {
        usScheduler.reevaluate()
      }
      broadcast()
    }
  )
}
