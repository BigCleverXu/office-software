import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { ALARM_CHANNELS } from '../shared/types'
import type { AlarmDraft } from '../shared/types'
import type { AlarmStore } from './alarm-store'
import type { AlarmScheduler } from './scheduler'

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
