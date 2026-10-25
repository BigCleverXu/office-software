import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import type { Tray } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray.png?asset'
import trayTemplateIcon from '../../resources/trayTemplate.png?asset'
import trayTemplateIcon2x from '../../resources/trayTemplate@2x.png?asset'
import { ALARM_CHANNELS } from '../shared/types'
import type { Alarm } from '../shared/types'
import {
  FAILURE_THRESHOLD,
  MARKET_CHANNELS,
  formatPercent,
  formatPrice,
  type Quote
} from '../shared/market'
import { AlarmStore } from './alarm-store'
import { AlarmScheduler } from './scheduler'
import { MarketStore } from './market-store'
import { MarketScheduler } from './market-scheduler'
import { UsMarketScheduler } from './us-market-scheduler'
import { NoteStore } from './note-store'
import { NewsStore } from './news-store'
import { CountdownStore } from './countdown-store'
import { HolidayService } from './holiday-service'
import { CALENDAR_CHANNELS } from '../shared/calendar'
import {
  applyLaunchAtLoginSetting,
  registerAlarmIpc,
  registerCalendarIpc,
  registerMarketIpc,
  registerNewsIpc,
  registerNotesIpc,
  registerSettingsIpc,
  registerUpdateIpc
} from './ipc'
import { fetchQuotes } from './quote-provider'
import { fetchUsQuotes } from './us-quote-provider'
import { createTray } from './tray'
import { showAlarmNotification } from './notifier'
import { closeDatabase, openDatabase } from './database'
import { SettingsStore } from './settings-store'
import { getIntervalMs } from '../shared/interval'
import {
  UPDATE_CHANNELS,
  UPDATE_DOWNLOAD_DIR_NAME,
  type UpdateCheckResult
} from '../shared/update'
import { UpdateChecker } from './update-checker'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let scheduler: AlarmScheduler | null = null
let marketSchedulerRef: MarketScheduler | null = null
let usMarketSchedulerRef: UsMarketScheduler | null = null
let trayTooltipTimer: ReturnType<typeof setInterval> | null = null
/** 缓存最后一次有效的上证指数，供非交易时段复用 */
let lastShanghai: Quote | null = null
let isQuitting = false
let database: DatabaseSync | null = null
/** 全局设置存储，供创建窗口（首帧主题）与设置 IPC 使用 */
let settingsStore: SettingsStore | null = null
/** 自动检查更新调度器 */
let updateChecker: UpdateChecker | null = null
/** 窗口不可见期间产生的更新结果，待重新显示时投递 */
let pendingUpdate: UpdateCheckResult | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 首个渲染帧前注入主题，避免浅色闪烁
      additionalArguments: [
        `--app-theme=${settingsStore?.get().theme ?? 'system'}`
      ]
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  // 窗口重新显示 / 还原时投递暂存的更新结果
  win.on('show', flushPendingUpdate)
  win.on('restore', flushPendingUpdate)

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 向窗口投递更新结果；页面尚未加载完成时等待加载结束再发送 */
function sendUpdateResult(win: BrowserWindow, result: UpdateCheckResult): void {
  if (win.isDestroyed()) {
    return
  }
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) {
        return
      }
      win.webContents.send(UPDATE_CHANNELS.available, result)
    })
    return
  }
  win.webContents.send(UPDATE_CHANNELS.available, result)
}

/** 投递自动检查结果：窗口不可见时暂存，待重新显示时再发 */
function deliverUpdateResult(result: UpdateCheckResult): void {
  const win = mainWindow
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) {
    pendingUpdate = result
    return
  }
  sendUpdateResult(win, result)
  pendingUpdate = null
}

/** 窗口重新显示 / 还原时清空暂存的更新结果 */
function flushPendingUpdate(): void {
  const win = mainWindow
  if (
    !pendingUpdate ||
    !win ||
    win.isDestroyed() ||
    !win.isVisible() ||
    win.isMinimized()
  ) {
    return
  }
  const result = pendingUpdate
  pendingUpdate = null
  sendUpdateResult(win, result)
}

/** 显示并聚焦主窗口；窗口不存在时重新创建 */
function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
  }
  const win = mainWindow
  if (!win) {
    return
  }
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.reminder.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const db = openDatabase()
  database = db

  const appSettings = new SettingsStore(db)
  settingsStore = appSettings

  // 启动时以设置对齐系统登录项；失败只记录，不阻塞启动
  try {
    applyLaunchAtLoginSetting(appSettings.get().launchAtLogin)
  } catch (error) {
    console.error('同步开机自启设置失败:', error)
  }

  // 原生窗口主题跟随设置，渲染层通过启动参数拿到同一值
  nativeTheme.themeSource = appSettings.get().theme

  const store = new AlarmStore(db)

  const broadcast = (): void => {
    mainWindow?.webContents.send(ALARM_CHANNELS.changed, store.getAll())
  }

  const handleFire = (alarm: Alarm, firedAt: Date): void => {
    const firedAtMs = firedAt.getTime()
    if (alarm.repeat === 'interval') {
      // 间隔提醒：把下次触发时间前移一个间隔，永不自动禁用
      store.markFired(
        alarm.id,
        firedAtMs,
        firedAtMs + getIntervalMs(alarm.intervalValue, alarm.intervalUnit)
      )
    } else {
      store.markFired(alarm.id, firedAtMs)
      if (alarm.repeat === 'none') {
        store.setEnabled(alarm.id, false)
      }
    }
    showAlarmNotification(alarm, showMainWindow)
    broadcast()
  }

  const alarmScheduler = new AlarmScheduler(() => store.getAll(), handleFire)
  scheduler = alarmScheduler

  registerAlarmIpc({
    store,
    scheduler: alarmScheduler,
    getWindow: () => mainWindow
  })

  const marketStore = new MarketStore(db)

  const noteStore = new NoteStore(db)
  registerNotesIpc({ store: noteStore, getWindow: () => mainWindow })

  const newsStore = new NewsStore(db)
  registerNewsIpc({ store: newsStore, getWindow: () => mainWindow })

  const countdownStore = new CountdownStore(db)
  // 后台刷新成功后主动推送，渲染层无需轮询
  const holidayService = new HolidayService({
    db,
    onUpdated: (data) => {
      mainWindow?.webContents.send(CALENDAR_CHANNELS.holidaysChanged, data)
    }
  })
  registerCalendarIpc({
    countdownStore,
    holidayService,
    getWindow: () => mainWindow
  })

  const marketScheduler = new MarketScheduler({
    fetchQuotes: (symbols) => fetchQuotes(symbols),
    getWatchlist: () =>
      marketStore.getWatchlist().filter((item) => item.market !== 'us'),
    getSettings: () => marketStore.getSettings(),
    onSnapshot: () => {
      pushMarketState()
      refreshTrayTooltip()
    }
  })
  marketSchedulerRef = marketScheduler

  const usMarketScheduler = new UsMarketScheduler({
    fetchQuotes: (symbols) => fetchUsQuotes(symbols),
    getWatchlist: () =>
      marketStore.getWatchlist().filter((item) => item.market === 'us'),
    getSettings: () => marketStore.getSettings(),
    onSnapshot: () => {
      pushMarketState()
    }
  })
  usMarketSchedulerRef = usMarketScheduler

  /** 把最新行情状态推给渲染层（读取的是 store / 调度器的最新值） */
  const pushMarketState = (): void => {
    mainWindow?.webContents.send(MARKET_CHANNELS.stateChanged, {
      snapshot: marketScheduler.getSnapshot(),
      us: usMarketScheduler.getSnapshot(),
      watchlist: marketStore.getWatchlist(),
      settings: marketStore.getSettings()
    })
  }

  /** 按 PRD FR-M5：以 10 秒节奏刷新托盘悬浮提示 */
  const refreshTrayTooltip = (): void => {
    const snapshot = marketScheduler.getSnapshot()
    const shanghai = snapshot.indices.find((item) => item.symbol === 'sh000001')
    // 缓存最后一次有效数据，非交易时段因此也保留
    if (shanghai && shanghai.missing === false && shanghai.price !== null) {
      lastShanghai = shanghai
    }
    const current = lastShanghai
    // 连续失败超过阈值后退化为占位文案，不显示错误详情
    const degraded = snapshot.failureCount >= FAILURE_THRESHOLD
    let text = '上证指数 --'
    if (current && !degraded) {
      const priceText = formatPrice(current.price)
      const percentText = formatPercent(current.changePercent)
      text = `上证指数 ${priceText} ${percentText}`
    }
    tray?.setToolTip(text)
  }

  registerMarketIpc({
    store: marketStore,
    scheduler: marketScheduler,
    usScheduler: usMarketScheduler,
    getWindow: () => mainWindow
  })

  registerUpdateIpc({
    getVersion: () => app.getVersion(),
    getWindow: () => mainWindow,
    downloadDir: join(app.getPath('temp'), UPDATE_DOWNLOAD_DIR_NAME)
  })

  registerSettingsIpc({ store: appSettings, getWindow: () => mainWindow })

  createWindow()

  // 后台预热当前年份节假日缓存，不阻塞启动
  void holidayService.refresh(new Date().getFullYear())

  // 窗口就绪后再启动自动检查，避免首次结果无处投递
  const checker = new UpdateChecker({
    getVersion: () => app.getVersion(),
    onUpdateAvailable: (result) => deliverUpdateResult(result)
  })
  updateChecker = checker
  checker.start()

  tray = createTray({
    showWindow: showMainWindow,
    openMarket: () => {
      showMainWindow()
      mainWindow?.webContents.send(MARKET_CHANNELS.navigate, 'market')
    },
    quit: () => app.quit(),
    icons: {
      color: trayIcon,
      template: trayTemplateIcon,
      template2x: trayTemplateIcon2x
    }
  })

  alarmScheduler.start()
  marketScheduler.start()
  usMarketScheduler.start()
  refreshTrayTooltip()
  trayTooltipTimer = setInterval(refreshTrayTooltip, 10000)

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  scheduler?.stop()
  marketSchedulerRef?.stop()
  usMarketSchedulerRef?.stop()
  updateChecker?.stop()
  updateChecker = null
  if (trayTooltipTimer !== null) {
    clearInterval(trayTooltipTimer)
    trayTooltipTimer = null
  }
  tray?.destroy()
  tray = null
  if (database) {
    closeDatabase(database)
    database = null
  }
})

// 托盘常驻：所有窗口关闭时不退出应用（各平台一致）
app.on('window-all-closed', () => {
  // 通过托盘“退出”或 before-quit 才真正结束进程
})
