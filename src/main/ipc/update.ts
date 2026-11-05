import { ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  UPDATE_CHANNELS,
  type OpenDownloadedResult,
  type ReleaseAsset,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
  type UpdateDownloadResult,
  type UpdateDownloadSnapshot
} from '../../shared/update'
import { AssetDownloader, resolveDownloadedFile } from '../update-downloader'
import {
  fetchLatestRelease,
  type ReleaseFetchResult
} from '../release-provider'
import { checkForUpdate } from '../update-checker'

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
