import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  FILE_SEARCH_CHANNELS,
  type FileActionResult,
  type FilePreviewResult,
  type FileRootsResult,
  type FileSearchResult,
  type FileSearchState
} from '../../shared/files'
import type { FileSearchService } from '../file-search-service'

export interface FileSearchIpcDeps {
  service: FileSearchService
  getWindow: () => BrowserWindow | null
}

/**
 * 注册文件搜索 IPC 通道：状态 / 查询 / 重扫 / 目录维护 / 预览 / 打开。
 *
 * 变更类通道完成后广播最新状态；添加目录走系统目录选择对话框，
 * 取消或异常都返回可展示的结果，不向上抛出。
 */
export function registerFileSearchIpc(deps: FileSearchIpcDeps): void {
  const { service, getWindow } = deps

  const broadcast = (state: FileSearchState): void => {
    getWindow()?.webContents.send(FILE_SEARCH_CHANNELS.stateChanged, state)
  }

  ipcMain.handle(FILE_SEARCH_CHANNELS.getState, (): FileSearchState =>
    service.getState()
  )

  ipcMain.handle(
    FILE_SEARCH_CHANNELS.search,
    (_event: Electron.IpcMainInvokeEvent, query: unknown): FileSearchResult =>
      service.search(query)
  )

  ipcMain.handle(FILE_SEARCH_CHANNELS.rescan, (): FileSearchState => {
    const state = service.rescan()
    broadcast(state)
    return state
  })

  ipcMain.handle(
    FILE_SEARCH_CHANNELS.removeRoot,
    (_event: Electron.IpcMainInvokeEvent, root: unknown): FileSearchState => {
      const state = service.removeRoot(root)
      broadcast(state)
      return state
    }
  )

  ipcMain.handle(
    FILE_SEARCH_CHANNELS.preview,
    (
      _event: Electron.IpcMainInvokeEvent,
      filePath: unknown
    ): Promise<FilePreviewResult> => service.preview(filePath)
  )

  ipcMain.handle(
    FILE_SEARCH_CHANNELS.open,
    (
      _event: Electron.IpcMainInvokeEvent,
      filePath: unknown
    ): Promise<FileActionResult> => service.openFile(filePath)
  )

  ipcMain.handle(
    FILE_SEARCH_CHANNELS.reveal,
    (
      _event: Electron.IpcMainInvokeEvent,
      filePath: unknown
    ): Promise<FileActionResult> => service.revealFile(filePath)
  )

  ipcMain.handle(
    FILE_SEARCH_CHANNELS.addRoots,
    async (): Promise<FileRootsResult> => {
      const current = service.getState().roots
      const win = getWindow()
      const options: Electron.OpenDialogOptions = {
        title: '选择搜索目录',
        properties: ['openDirectory', 'multiSelections'],
        buttonLabel: '添加'
      }
      try {
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        if (result.canceled || result.filePaths.length === 0) {
          return { canceled: true, roots: current }
        }
        const state = service.addRoots(result.filePaths)
        broadcast(state)
        return { canceled: false, roots: state.roots }
      } catch (error) {
        console.error('添加搜索目录失败:', error)
        return {
          canceled: false,
          roots: service.getState().roots,
          error: '添加目录失败'
        }
      }
    }
  )
}
