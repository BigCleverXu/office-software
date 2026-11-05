import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { NOTE_CHANNELS } from '../../shared/notes'
import type { NoteDraft } from '../../shared/notes'
import type { NoteStore } from '../note-store'

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

  ipcMain.handle(
    NOTE_CHANNELS.setCategory,
    (
      _event: Electron.IpcMainInvokeEvent,
      ids: string[],
      category: string
    ): number => {
      const affected = store.setCategory(ids, category)
      if (affected > 0) {
        broadcast()
      }
      return affected
    }
  )

  ipcMain.handle(
    NOTE_CHANNELS.renameCategory,
    (_event: Electron.IpcMainInvokeEvent, from: string, to: string): number => {
      const affected = store.renameCategory(from, to)
      if (affected > 0) {
        broadcast()
      }
      return affected
    }
  )

  ipcMain.handle(
    NOTE_CHANNELS.removeCategory,
    (_event: Electron.IpcMainInvokeEvent, name: string): number => {
      const affected = store.removeCategory(name)
      if (affected > 0) {
        broadcast()
      }
      return affected
    }
  )
}
