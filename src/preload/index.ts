import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  ALARM_CHANNELS,
  type Alarm,
  type AlarmApi,
  type AlarmDraft
} from '../shared/types'
import {
  MARKET_CHANNELS,
  type MarketApi,
  type MarketState
} from '../shared/market'
import type { AppModuleId } from '../shared/navigation'
import {
  UPDATE_CHANNELS,
  type OpenDownloadedResult,
  type ReleaseAsset,
  type UpdateApi,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
  type UpdateDownloadResult,
  type UpdateDownloadSnapshot
} from '../shared/update'
import {
  NOTE_CHANNELS,
  type Note,
  type NoteApi,
  type NoteDraft
} from '../shared/notes'
import {
  CALENDAR_CHANNELS,
  type CalendarApi,
  type Countdown,
  type CountdownDraft,
  type HolidayYear
} from '../shared/calendar'
import {
  SETTINGS_CHANNELS,
  type AppSettings,
  type AppTheme,
  type ExportBackupResult,
  type OpenDataDirResult,
  type SettingsApi,
  type SettingsViewState
} from '../shared/settings'

// 暴露给渲染进程的提醒 API
const alarms: AlarmApi = {
  list: () => ipcRenderer.invoke(ALARM_CHANNELS.list),
  create: (draft: AlarmDraft) =>
    ipcRenderer.invoke(ALARM_CHANNELS.create, draft),
  update: (id: string, draft: AlarmDraft) =>
    ipcRenderer.invoke(ALARM_CHANNELS.update, id, draft),
  remove: (id: string) => ipcRenderer.invoke(ALARM_CHANNELS.remove, id),
  toggle: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(ALARM_CHANNELS.toggle, id, enabled),
  onChanged: (callback: (alarms: Alarm[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: Alarm[]
    ): void => {
      callback(data)
    }
    ipcRenderer.on(ALARM_CHANNELS.changed, listener)
    return () => {
      ipcRenderer.removeListener(ALARM_CHANNELS.changed, listener)
    }
  }
}

const market: MarketApi = {
  getState: () => ipcRenderer.invoke(MARKET_CHANNELS.getState),
  addWatch: (code: string) =>
    ipcRenderer.invoke(MARKET_CHANNELS.addWatch, code),
  removeWatch: (symbol: string) =>
    ipcRenderer.invoke(MARKET_CHANNELS.removeWatch, symbol),
  refreshNow: () => ipcRenderer.invoke(MARKET_CHANNELS.refreshNow),
  setPaused: (paused: boolean) =>
    ipcRenderer.invoke(MARKET_CHANNELS.setPaused, paused),
  setLastPage: (page: AppModuleId) =>
    ipcRenderer.invoke(MARKET_CHANNELS.setLastPage, page),
  onStateChanged: (callback: (state: MarketState) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: MarketState
    ): void => {
      callback(data)
    }
    ipcRenderer.on(MARKET_CHANNELS.stateChanged, listener)
    return () => {
      ipcRenderer.removeListener(MARKET_CHANNELS.stateChanged, listener)
    }
  },
  onNavigate: (callback: (page: AppModuleId) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      page: AppModuleId
    ): void => {
      callback(page)
    }
    ipcRenderer.on(MARKET_CHANNELS.navigate, listener)
    return () => {
      ipcRenderer.removeListener(MARKET_CHANNELS.navigate, listener)
    }
  }
}

const update: UpdateApi = {
  platform: process.platform,
  arch: process.arch,
  check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check),
  onAvailable: (callback: (result: UpdateCheckResult) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: UpdateCheckResult
    ): void => {
      callback(data)
    }
    ipcRenderer.on(UPDATE_CHANNELS.available, listener)
    return () => {
      ipcRenderer.removeListener(UPDATE_CHANNELS.available, listener)
    }
  },
  download: (asset: ReleaseAsset): Promise<UpdateDownloadResult> =>
    ipcRenderer.invoke(UPDATE_CHANNELS.download, asset),
  getDownloadState: (): Promise<UpdateDownloadSnapshot> =>
    ipcRenderer.invoke(UPDATE_CHANNELS.downloadState),
  onDownloadProgress: (
    callback: (progress: UpdateDownloadProgress) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: UpdateDownloadProgress
    ): void => {
      callback(data)
    }
    ipcRenderer.on(UPDATE_CHANNELS.downloadProgress, listener)
    return () => {
      ipcRenderer.removeListener(UPDATE_CHANNELS.downloadProgress, listener)
    }
  },
  cancelDownload: (): Promise<void> =>
    ipcRenderer.invoke(UPDATE_CHANNELS.cancelDownload),
  openDownloaded: (filePath: string): Promise<OpenDownloadedResult> =>
    ipcRenderer.invoke(UPDATE_CHANNELS.openDownloaded, filePath),
  showInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(UPDATE_CHANNELS.showInFolder, filePath)
}

// 暴露给渲染进程的便签 API
const notes: NoteApi = {
  list: () => ipcRenderer.invoke(NOTE_CHANNELS.list),
  create: (draft: NoteDraft) => ipcRenderer.invoke(NOTE_CHANNELS.create, draft),
  update: (id: string, draft: NoteDraft) =>
    ipcRenderer.invoke(NOTE_CHANNELS.update, id, draft),
  remove: (id: string) => ipcRenderer.invoke(NOTE_CHANNELS.remove, id),
  onChanged: (callback: (notes: Note[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: Note[]
    ): void => {
      callback(data)
    }
    ipcRenderer.on(NOTE_CHANNELS.changed, listener)
    return () => {
      ipcRenderer.removeListener(NOTE_CHANNELS.changed, listener)
    }
  }
}

// 暴露给渲染进程的日历与倒计日 API
const calendar: CalendarApi = {
  listCountdowns: (): Promise<Countdown[]> =>
    ipcRenderer.invoke(CALENDAR_CHANNELS.listCountdowns),
  createCountdown: (draft: CountdownDraft): Promise<Countdown> =>
    ipcRenderer.invoke(CALENDAR_CHANNELS.createCountdown, draft),
  updateCountdown: (
    id: string,
    draft: CountdownDraft
  ): Promise<Countdown | null> =>
    ipcRenderer.invoke(CALENDAR_CHANNELS.updateCountdown, id, draft),
  removeCountdown: (id: string): Promise<void> =>
    ipcRenderer.invoke(CALENDAR_CHANNELS.removeCountdown, id),
  getHolidays: (year: number): Promise<HolidayYear> =>
    ipcRenderer.invoke(CALENDAR_CHANNELS.getHolidays, year),
  onCountdownsChanged: (callback: (items: Countdown[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: Countdown[]
    ): void => {
      callback(data)
    }
    ipcRenderer.on(CALENDAR_CHANNELS.countdownsChanged, listener)
    return () => {
      ipcRenderer.removeListener(CALENDAR_CHANNELS.countdownsChanged, listener)
    }
  },
  onHolidaysChanged: (callback: (data: HolidayYear) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: HolidayYear
    ): void => {
      callback(data)
    }
    ipcRenderer.on(CALENDAR_CHANNELS.holidaysChanged, listener)
    return () => {
      ipcRenderer.removeListener(CALENDAR_CHANNELS.holidaysChanged, listener)
    }
  }
}

/** 从启动参数解析首帧主题，仅接受三个合法值，否则回退 'system' */
function readInitialTheme(): AppTheme {
  const prefix = '--app-theme='
  const arg = process.argv.find((item) => item.startsWith(prefix))
  const value = arg?.slice(prefix.length)
  if (value === 'light' || value === 'dark') {
    return value
  }
  return 'system'
}

// 暴露给渲染进程的设置 API
const settings: SettingsApi = {
  initialTheme: readInitialTheme(),
  get: (): Promise<SettingsViewState> =>
    ipcRenderer.invoke(SETTINGS_CHANNELS.get),
  update: (patch: Partial<AppSettings>): Promise<SettingsViewState> =>
    ipcRenderer.invoke(SETTINGS_CHANNELS.update, patch),
  openDataDir: (): Promise<OpenDataDirResult> =>
    ipcRenderer.invoke(SETTINGS_CHANNELS.openDataDir),
  exportBackup: (): Promise<ExportBackupResult> =>
    ipcRenderer.invoke(SETTINGS_CHANNELS.exportBackup),
  onChanged: (callback: (state: SettingsViewState) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: SettingsViewState
    ): void => {
      callback(data)
    }
    ipcRenderer.on(SETTINGS_CHANNELS.changed, listener)
    return () => {
      ipcRenderer.removeListener(SETTINGS_CHANNELS.changed, listener)
    }
  }
}

const api = { alarms, market, update, notes, calendar, settings }

// 在开启上下文隔离时，通过 contextBridge 暴露 API
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
