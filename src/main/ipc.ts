import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
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
import { UPDATE_CHANNELS, type UpdateCheckResult } from '../shared/update'
import type { MarketStore } from './market-store'
import type { MarketScheduler } from './market-scheduler'
import type { NoteStore } from './note-store'
import { NOTE_CHANNELS } from '../shared/notes'
import type { NoteDraft } from '../shared/notes'
import { fetchQuotes } from './quote-provider'
import { fetchLatestRelease, type ReleaseFetchResult } from './release-provider'
import { checkForUpdate } from './update-checker'
import {
  SETTINGS_CHANNELS,
  type AppSettings,
  type ExportBackupResult,
  type OpenDataDirResult,
  type SettingsViewState
} from '../shared/settings'
import type { SettingsStore } from './settings-store'
import { DATABASE_FILENAME } from './database'

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
 * 归类为四态结果返回渲染层；判定逻辑复用 checkForUpdate，绝不抛出。
 */
export function registerUpdateIpc(deps: UpdateIpcDeps): void {
  const fetchRelease = deps.fetchRelease ?? (() => fetchLatestRelease())

  ipcMain.handle(UPDATE_CHANNELS.check, async (): Promise<UpdateCheckResult> =>
    checkForUpdate(deps.getVersion(), fetchRelease)
  )
}

export interface SettingsIpcDeps {
  store: SettingsStore
  getWindow: () => BrowserWindow | null
}

/**
 * 把开机自启设置同步到系统登录项。
 *
 * 仅 Windows / macOS 支持，其他平台直接返回；调用失败时抛出，
 * 由调用方决定回滚（更新设置）或忽略（启动对齐）。
 */
export function applyLaunchAtLoginSetting(value: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return
  }
  app.setLoginItemSettings({ openAtLogin: value })
}

/** 生成本地日期戳 YYYYMMDD，用于备份文件名 */
function formatDateStamp(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}${month}${day}`
}

/** 删除未完成的备份文件，失败只记录不覆盖原始错误 */
function removePartialBackup(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  } catch (error) {
    console.error('清理未完成的备份文件失败:', error)
  }
}

/**
 * 注册设置相关的 IPC 通道：读取状态、更新设置、打开数据目录、导出备份。
 *
 * 更新成功后会广播完整 SettingsViewState，保证渲染层与主进程一致；
 * 副作用失败时回滚设置并向上抛出，由调用方展示错误。
 */
export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  const { store, getWindow } = deps

  const buildState = (): SettingsViewState => ({
    settings: store.get(),
    appVersion: app.getVersion(),
    dataDir: app.getPath('userData'),
    autoLaunchSupported:
      process.platform === 'win32' || process.platform === 'darwin',
    platform: process.platform
  })

  ipcMain.handle(SETTINGS_CHANNELS.get, () => buildState())

  ipcMain.handle(
    SETTINGS_CHANNELS.update,
    (
      _event: Electron.IpcMainInvokeEvent,
      patch: Partial<AppSettings>
    ): SettingsViewState => {
      const previous = store.get()
      const next = store.update(patch)
      try {
        applyLaunchAtLoginSetting(next.launchAtLogin)
        nativeTheme.themeSource = next.theme
      } catch (error) {
        // 副作用失败：回滚设置，保证开关保持旧值
        store.update(previous)
        throw error
      }
      const state = buildState()
      getWindow()?.webContents.send(SETTINGS_CHANNELS.changed, state)
      return state
    }
  )

  ipcMain.handle(
    SETTINGS_CHANNELS.openDataDir,
    async (): Promise<OpenDataDirResult> => {
      const error = await shell.openPath(app.getPath('userData'))
      return { ok: error === '', error: error || undefined }
    }
  )

  ipcMain.handle(
    SETTINGS_CHANNELS.exportBackup,
    async (): Promise<ExportBackupResult> => {
      const dataDir = app.getPath('userData')
      const options: Electron.SaveDialogOptions = {
        title: '导出数据库备份',
        defaultPath: join(
          dataDir,
          `office-software-backup-${formatDateStamp()}.db`
        ),
        filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
      }
      const win = getWindow()
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) {
        return { canceled: true }
      }
      const source = join(dataDir, DATABASE_FILENAME)
      if (!existsSync(source)) {
        return { canceled: false, error: '数据库文件不存在' }
      }
      try {
        copyFileSync(source, result.filePath)
        return { canceled: false, filePath: result.filePath }
      } catch (error) {
        console.error('导出数据库备份失败:', error)
        removePartialBackup(result.filePath)
        return { canceled: false, error: '导出备份失败，请检查磁盘空间或权限' }
      }
    }
  )
}
