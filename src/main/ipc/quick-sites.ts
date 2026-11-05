import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import {
  QUICK_SITE_CHANNELS,
  type BrowserScanResult,
  type DetectedBrowser,
  type OpenQuickSiteResult,
  type QuickSiteDraft,
  type QuickSiteSaveResult
} from '../../shared/quick-sites'
import { detectBrowsers } from '../browser-detector'
import { openUrlsInBrowser } from '../quick-site-launcher'
import { openSitesInBrowsers } from '../quick-site-opener'
import type { QuickSiteStore } from '../quick-site-store'

export interface QuickSiteIpcDeps {
  store: QuickSiteStore
  getWindow: () => BrowserWindow | null
  /** 注入探测实现以便扩展 / 测试；默认使用 detectBrowsers */
  detect?: () => DetectedBrowser[]
  /** 注入批量启动实现以便测试；默认使用 openUrlsInBrowser */
  launchBatch?: typeof openUrlsInBrowser
  /** 判断可执行文件是否存在，默认 existsSync */
  exists?: (path: string) => boolean
}

/**
 * 注册快捷网站 IPC 通道：
 * - 列表 / 新增 / 更新 / 删除，变更成功后广播最新列表
 * - 扫描本机浏览器与角色
 * - 按站点的全部打开方式启动：浏览器不可用或可执行文件缺失时逐目标
 *   回退系统默认浏览器
 */
export function registerQuickSiteIpc(deps: QuickSiteIpcDeps): void {
  const { store, getWindow } = deps
  const detect = deps.detect ?? (() => detectBrowsers())
  const launchBatch = deps.launchBatch ?? openUrlsInBrowser
  const fileExists = deps.exists ?? existsSync

  const broadcast = (): void => {
    getWindow()?.webContents.send(QUICK_SITE_CHANNELS.changed, store.getAll())
  }

  ipcMain.handle(QUICK_SITE_CHANNELS.list, () => store.getAll())

  ipcMain.handle(
    QUICK_SITE_CHANNELS.create,
    (
      _event: Electron.IpcMainInvokeEvent,
      draft: QuickSiteDraft
    ): QuickSiteSaveResult => {
      const result = store.create(draft)
      if (result.ok) {
        broadcast()
      }
      return result
    }
  )

  ipcMain.handle(
    QUICK_SITE_CHANNELS.update,
    (
      _event: Electron.IpcMainInvokeEvent,
      id: unknown,
      draft: QuickSiteDraft
    ): QuickSiteSaveResult => {
      if (typeof id !== 'string') {
        return { ok: false, error: '站点不存在' }
      }
      const result = store.update(id, draft)
      if (result.ok) {
        broadcast()
      }
      return result
    }
  )

  ipcMain.handle(
    QUICK_SITE_CHANNELS.remove,
    (_event: Electron.IpcMainInvokeEvent, id: unknown) => {
      if (typeof id !== 'string') {
        return
      }
      store.remove(id)
      broadcast()
    }
  )

  ipcMain.handle(QUICK_SITE_CHANNELS.listBrowsers, (): BrowserScanResult => ({
    browsers: detect()
  }))

  ipcMain.handle(
    QUICK_SITE_CHANNELS.open,
    async (
      _event: Electron.IpcMainInvokeEvent,
      id: unknown
    ): Promise<OpenQuickSiteResult> => {
      const notFound: OpenQuickSiteResult = {
        ok: false,
        opened: 0,
        fallback: 0,
        failed: 0,
        browserNames: [],
        errors: ['站点不存在']
      }
      if (typeof id !== 'string') {
        return notFound
      }
      const site = store.getById(id)
      if (site === null) {
        return notFound
      }
      return openSitesInBrowsers([site], {
        detect,
        launchBatch,
        exists: fileExists
      })
    }
  )
}
