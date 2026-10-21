import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { ALARM_CHANNELS } from '../shared/types'
import type { AlarmDraft } from '../shared/types'
import type { AlarmStore } from './alarm-store'
import type { AlarmScheduler } from './scheduler'
import {
  MARKET_CHANNELS,
  normalizeCode,
  type AddWatchResult,
  type MarketState
} from '../shared/market'
import type { AppModuleId } from '../shared/navigation'
import {
  UPDATE_CHANNELS,
  isNewerVersion,
  type UpdateCheckResult
} from '../shared/update'
import type { MarketStore } from './market-store'
import type { MarketScheduler } from './market-scheduler'
import type { NoteStore } from './note-store'
import { NOTE_CHANNELS } from '../shared/notes'
import type { NoteDraft } from '../shared/notes'
import { fetchQuotes } from './quote-provider'
import { fetchLatestRelease, type ReleaseFetchResult } from './release-provider'

export interface AlarmIpcDeps {
  store: AlarmStore
  scheduler: AlarmScheduler
  getWindow: () => BrowserWindow | null
}

/**
 * 注册提醒相关的 IPC 通道。每次变更后把最新列表广播给渲染进程。
 *
 * scheduler 通过 getAlarms 回调读取最新数据，因此无需额外重新调度。
 */
export function registerAlarmIpc(deps: AlarmIpcDeps): void {
  const { store, getWindow } = deps

  const broadcast = (): void => {
    getWindow()?.webContents.send(ALARM_CHANNELS.changed, store.getAll())
  }

  ipcMain.handle(ALARM_CHANNELS.list, () => store.getAll())

  ipcMain.handle(
    ALARM_CHANNELS.create,
    (_event: Electron.IpcMainInvokeEvent, draft: AlarmDraft) => {
      const created = store.create(draft)
      broadcast()
      return created
    }
  )

  ipcMain.handle(
    ALARM_CHANNELS.update,
    (_event: Electron.IpcMainInvokeEvent, id: string, draft: AlarmDraft) => {
      const updated = store.update(id, draft)
      broadcast()
      return updated
    }
  )

  ipcMain.handle(
    ALARM_CHANNELS.remove,
    (_event: Electron.IpcMainInvokeEvent, id: string) => {
      store.remove(id)
      broadcast()
    }
  )

  ipcMain.handle(
    ALARM_CHANNELS.toggle,
    (_event: Electron.IpcMainInvokeEvent, id: string, enabled: boolean) => {
      const updated = store.setEnabled(id, enabled)
      broadcast()
      return updated
    }
  )
}

export interface NotesIpcDeps {
  store: NoteStore
  getWindow: () => BrowserWindow | null
}

/**
 * 注册便签相关的 IPC 通道。每次变更后把最新列表广播给渲染进程。
 */
export function registerNotesIpc(deps: NotesIpcDeps): void {
  const { store, getWindow } = deps

  const broadcast = (): void => {
    getWindow()?.webContents.send(NOTE_CHANNELS.changed, store.getAll())
  }

  ipcMain.handle(NOTE_CHANNELS.list, () => store.getAll())

  ipcMain.handle(
    NOTE_CHANNELS.create,
    (_event: Electron.IpcMainInvokeEvent, draft: NoteDraft) => {
      const created = store.create(draft)
      broadcast()
      return created
    }
  )

  ipcMain.handle(
    NOTE_CHANNELS.update,
    (_event: Electron.IpcMainInvokeEvent, id: string, draft: NoteDraft) => {
      const updated = store.update(id, draft)
      broadcast()
      return updated
    }
  )

  ipcMain.handle(
    NOTE_CHANNELS.remove,
    (_event: Electron.IpcMainInvokeEvent, id: string) => {
      store.remove(id)
      broadcast()
    }
  )
}

export interface MarketIpcDeps {
  store: MarketStore
  scheduler: MarketScheduler
  getWindow: () => BrowserWindow | null
}

/**
 * 注册行情相关的 IPC 通道。每次自选股 / 设置变更后把最新状态广播给渲染进程。
 *
 * 调度器通过 getWatchlist / getSettings 回调读取最新数据，因此无需额外重新调度。
 */
export function registerMarketIpc(deps: MarketIpcDeps): void {
  const { store, scheduler, getWindow } = deps

  const buildState = (): MarketState => ({
    snapshot: scheduler.getSnapshot(),
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
      code: string
    ): Promise<AddWatchResult> => {
      const normalized = normalizeCode(code)
      if (!normalized) {
        return { ok: false, reason: 'invalid-code' }
      }
      const { code: pureCode, symbol, market } = normalized
      if (store.has(symbol)) {
        return { ok: false, reason: 'duplicate' }
      }
      // 用行情请求校验代码是否真实存在；超时 / 网络异常视为不可用
      const quotes = await fetchQuotes([symbol], { timeoutMs: 5000 }).catch(
        () => null
      )
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
        name: quote.name
      })
      // 不 await，避免阻塞添加弹窗关闭
      void scheduler.refreshNow()
      broadcast()
      return { ok: true, item }
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
    await scheduler.refreshNow()
  })

  ipcMain.handle(
    MARKET_CHANNELS.setPaused,
    (_event: Electron.IpcMainInvokeEvent, paused: boolean) => {
      store.setPaused(paused)
      scheduler.reevaluate()
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
}

export interface UpdateIpcDeps {
  getVersion: () => string
  /** 注入取数实现以便测试；默认使用 fetchLatestRelease */
  fetchRelease?: () => Promise<ReleaseFetchResult>
}

/**
 * 注册检查更新 IPC 通道。职责：对比当前版本与 GitHub 最新发行版，
 * 归类为四态结果返回渲染层；任何异常都收敛为 error 结果，绝不抛出。
 */
export function registerUpdateIpc(deps: UpdateIpcDeps): void {
  const fetchRelease = deps.fetchRelease ?? (() => fetchLatestRelease())

  ipcMain.handle(
    UPDATE_CHANNELS.check,
    async (): Promise<UpdateCheckResult> => {
      const currentVersion = deps.getVersion()
      try {
        const result = await fetchRelease()
        if (!result.ok) {
          return { status: 'error', currentVersion, reason: result.reason }
        }
        if (result.release === null) {
          return { status: 'no-release', currentVersion }
        }
        if (isNewerVersion(result.release.version, currentVersion)) {
          return {
            status: 'update-available',
            currentVersion,
            release: result.release
          }
        }
        return {
          status: 'up-to-date',
          currentVersion,
          release: result.release
        }
      } catch {
        return { status: 'error', currentVersion, reason: 'unknown' }
      }
    }
  )
}
