import dayjs from 'dayjs'
import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  SETTINGS_CHANNELS,
  type AppSettings,
  type ExportBackupResult,
  type OpenDataDirResult,
  type SettingsViewState
} from '../../shared/settings'
import type { SettingsStore } from '../settings-store'
import { DATABASE_FILENAME } from '../database'

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
  return dayjs(date).format('YYYYMMDD')
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
