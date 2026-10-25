import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ALARM_CHANNELS } from '../shared/types'
import type { AlarmDraft } from '../shared/types'
import type { AlarmStore } from './alarm-store'
import type { AlarmScheduler } from './scheduler'
import {
  MARKET_CHANNELS,
  isMarketRegion,
  normalizeCode,
  normalizeUsSymbol,
  type AddWatchResult,
  type MarketState
} from '../shared/market'
import type { AppModuleId } from '../shared/navigation'
import {
  UPDATE_CHANNELS,
  type OpenDownloadedResult,
  type ReleaseAsset,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
  type UpdateDownloadResult,
  type UpdateDownloadSnapshot
} from '../shared/update'
import { AssetDownloader, resolveDownloadedFile } from './update-downloader'
import type { MarketStore } from './market-store'
import type { MarketScheduler } from './market-scheduler'
import type { UsMarketScheduler } from './us-market-scheduler'
import type { NoteStore } from './note-store'
import { NOTE_CHANNELS } from '../shared/notes'
import type { NoteDraft } from '../shared/notes'
import {
  NEWS_CHANNELS,
  type NewsPlatformId,
  type NewsSection,
  type NewsState
} from '../shared/news'
import type { NewsStore } from './news-store'
import { fetchNewsSections } from './news-provider'
import { CALENDAR_CHANNELS } from '../shared/calendar'
import type { Countdown, CountdownDraft, HolidayYear } from '../shared/calendar'
import type { CountdownStore } from './countdown-store'
import type { HolidayService } from './holiday-service'
import { fetchQuotes } from './quote-provider'
import { fetchUsQuotes } from './us-quote-provider'
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

export interface NewsIpcDeps {
  store: NewsStore
  getWindow: () => BrowserWindow | null
  /** 注入取数实现以便扩展 / 测试；默认使用 fetchNewsSections */
  fetchSections?: (platforms: NewsPlatformId[]) => Promise<NewsSection[]>
}

/**
 * 注册热点新闻 IPC 通道：
 * - news:get 读取选中平台并拉取全部平台新闻
 * - news:setPlatforms 归一化持久化后重新拉取，并向当前窗口广播 news:changed
 */
export function registerNewsIpc(deps: NewsIpcDeps): void {
  const fetchSections =
    deps.fetchSections ?? ((platforms) => fetchNewsSections(platforms))

  const buildState = async (selected: NewsPlatformId[]): Promise<NewsState> => {
    const sections = await fetchSections(selected)
    return { selected, sections, updatedAt: Date.now() }
  }

  ipcMain.handle(NEWS_CHANNELS.get, async (): Promise<NewsState> => {
    const selected = deps.store.getPlatforms()
    return buildState(selected)
  })

  ipcMain.handle(
    NEWS_CHANNELS.setPlatforms,
    async (
      _event: Electron.IpcMainInvokeEvent,
      platforms: unknown
    ): Promise<NewsState> => {
      const selected = deps.store.setPlatforms(platforms)
      const state = await buildState(selected)
      deps.getWindow()?.webContents.send(NEWS_CHANNELS.changed, state)
      return state
    }
  )
}

export interface CalendarIpcDeps {
  countdownStore: CountdownStore
  holidayService: HolidayService
  getWindow: () => BrowserWindow | null
}

/**
 * 注册日历与倒计日相关的 IPC 通道。倒计日每次变更后把最新列表广播给渲染进程。
 *
 * 节假日读取走 HolidayService 的同步缓存（含内置数据），后台刷新成功后
 * 由 holidayService 的 onUpdated 回调推送，因此这里不 await 网络请求。
 */
export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  const { countdownStore, holidayService, getWindow } = deps

  const broadcastCountdowns = (): void => {
    getWindow()?.webContents.send(
      CALENDAR_CHANNELS.countdownsChanged,
      countdownStore.getAll()
    )
  }

  ipcMain.handle(CALENDAR_CHANNELS.listCountdowns, () =>
    countdownStore.getAll()
  )

  ipcMain.handle(
    CALENDAR_CHANNELS.createCountdown,
    (_event: Electron.IpcMainInvokeEvent, draft: CountdownDraft): Countdown => {
      const created = countdownStore.create(draft)
      broadcastCountdowns()
      return created
    }
  )

  ipcMain.handle(
    CALENDAR_CHANNELS.updateCountdown,
    (
      _event: Electron.IpcMainInvokeEvent,
      id: string,
      draft: CountdownDraft
    ): Countdown | null => {
      const updated = countdownStore.update(id, draft)
      broadcastCountdowns()
      return updated
    }
  )

  ipcMain.handle(
    CALENDAR_CHANNELS.removeCountdown,
    (_event: Electron.IpcMainInvokeEvent, id: string) => {
      countdownStore.remove(id)
      broadcastCountdowns()
    }
  )

  // 同步返回缓存 / 内置数据；getYear 内部会按需触发后台刷新
  ipcMain.handle(
    CALENDAR_CHANNELS.getHolidays,
    (_event: Electron.IpcMainInvokeEvent, year: number): HolidayYear =>
      holidayService.getYear(year)
  )
}

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
      code: string
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
        name: quote.name
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

export interface UpdateIpcDeps {
  getVersion: () => string
  getWindow: () => BrowserWindow | null
  /** 安装包落盘目录 */
  downloadDir: string
  /** 注入取数实现以便测试；默认使用 fetchLatestRelease */
  fetchRelease?: () => Promise<ReleaseFetchResult>
  /** 注入下载器以便测试；默认使用 AssetDownloader */
  downloader?: AssetDownloader
}

/** 取小写扩展名（含点），无扩展名返回空字符串 */
function lowerExtensionOf(filePath: string): string {
  const name = basename(filePath)
  const dotIndex = name.lastIndexOf('.')
  return dotIndex < 0 ? '' : name.slice(dotIndex).toLowerCase()
}

/**
 * 打开已下载的安装包。仅允许下载目录内的文件：
 * Windows 打开 .exe、macOS 打开 .dmg、Linux 打开 .AppImage；
 * 其他类型（含 .zip / .deb）只在文件管理器中定位。
 * 打开失败或无可执行权限时回退为定位，绝不抛出。
 */
export async function openDownloadedFile(
  filePath: string,
  downloadDir: string
): Promise<OpenDownloadedResult> {
  const target = resolveDownloadedFile(filePath, downloadDir)
  if (target === null || !existsSync(target)) {
    return { status: 'failed' }
  }
  const extension = lowerExtensionOf(target)
  const launchable =
    (process.platform === 'win32' && extension === '.exe') ||
    (process.platform === 'darwin' && extension === '.dmg') ||
    (process.platform === 'linux' && extension === '.appimage')
  if (!launchable) {
    shell.showItemInFolder(target)
    return { status: 'revealed' }
  }
  if (process.platform === 'linux' && extension === '.appimage') {
    try {
      await chmod(target, 0o755)
    } catch {
      // 无权限修改可执行位：退化为定位文件
      shell.showItemInFolder(target)
      return { status: 'revealed' }
    }
  }
  const error = await shell.openPath(target)
  if (error !== '') {
    shell.showItemInFolder(target)
    return { status: 'revealed' }
  }
  return { status: 'opened' }
}

/**
 * 注册检查更新 IPC 通道。职责：对比当前版本与 GitHub 最新发行版，
 * 归类为四态结果返回渲染层；判定逻辑复用 checkForUpdate，绝不抛出。
 *
 * 同时注册安装包下载 / 取消 / 打开 / 定位通道，下载进度推送给当前窗口。
 */
export function registerUpdateIpc(deps: UpdateIpcDeps): void {
  const fetchRelease = deps.fetchRelease ?? (() => fetchLatestRelease())
  const downloader = deps.downloader ?? new AssetDownloader()

  ipcMain.handle(UPDATE_CHANNELS.check, async (): Promise<UpdateCheckResult> =>
    checkForUpdate(deps.getVersion(), fetchRelease)
  )

  ipcMain.handle(
    UPDATE_CHANNELS.download,
    async (
      _event: Electron.IpcMainInvokeEvent,
      asset: ReleaseAsset
    ): Promise<UpdateDownloadResult> =>
      downloader.download({
        asset,
        downloadDir: deps.downloadDir,
        onProgress: (progress: UpdateDownloadProgress) => {
          const win = deps.getWindow()
          if (win !== null && !win.isDestroyed()) {
            win.webContents.send(UPDATE_CHANNELS.downloadProgress, progress)
          }
        }
      })
  )

  ipcMain.handle(UPDATE_CHANNELS.cancelDownload, (): void => {
    downloader.cancel()
  })

  ipcMain.handle(UPDATE_CHANNELS.downloadState, (): UpdateDownloadSnapshot =>
    downloader.getSnapshot()
  )

  ipcMain.handle(
    UPDATE_CHANNELS.openDownloaded,
    (
      _event: Electron.IpcMainInvokeEvent,
      filePath: string
    ): Promise<OpenDownloadedResult> =>
      openDownloadedFile(filePath, deps.downloadDir)
  )

  ipcMain.handle(
    UPDATE_CHANNELS.showInFolder,
    (_event: Electron.IpcMainInvokeEvent, filePath: string): void => {
      const target = resolveDownloadedFile(filePath, deps.downloadDir)
      if (target !== null) {
        shell.showItemInFolder(target)
      }
    }
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
