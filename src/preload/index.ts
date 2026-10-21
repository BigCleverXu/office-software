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
import { UPDATE_CHANNELS, type UpdateApi } from '../shared/update'
import {
  NOTE_CHANNELS,
  type Note,
  type NoteApi,
  type NoteDraft
} from '../shared/notes'

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
  check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check)
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

const api = { alarms, market, update, notes }

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
