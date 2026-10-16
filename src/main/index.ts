import { app, BrowserWindow, shell } from 'electron'
import type { Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ALARM_CHANNELS } from '../shared/types'
import type { Alarm } from '../shared/types'
import { AlarmStore } from './alarm-store'
import { AlarmScheduler } from './scheduler'
import { registerAlarmIpc } from './ipc'
import { createTray } from './tray'
import { showAlarmNotification } from './notifier'
import { getIntervalMs } from '../shared/interval'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let scheduler: AlarmScheduler | null = null
let isQuitting = false

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
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

  const store = new AlarmStore()

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

  createWindow()

  tray = createTray({
    showWindow: showMainWindow,
    quit: () => app.quit(),
    iconPath: icon
  })

  alarmScheduler.start()

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  scheduler?.stop()
  tray?.destroy()
  tray = null
})

// 托盘常驻：所有窗口关闭时不退出应用（各平台一致）
app.on('window-all-closed', () => {
  // 通过托盘“退出”或 before-quit 才真正结束进程
})
