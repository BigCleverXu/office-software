import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import {
  QUICK_SITE_GROUP_CHANNELS,
  type DetectedBrowser,
  type OpenQuickSiteGroupResult,
  type QuickSiteGroupDraft,
  type QuickSiteGroupSaveResult
} from '../../shared/quick-sites'
import { detectBrowsers } from '../browser-detector'
import { openUrlsInBrowser } from '../quick-site-launcher'
import { openQuickSiteGroup } from '../quick-site-opener'
import type { QuickSiteGroupStore } from '../quick-site-group-store'
import type { QuickSiteStore } from '../quick-site-store'

export interface QuickSiteGroupIpcDeps {
  groupStore: QuickSiteGroupStore
  siteStore: QuickSiteStore
  getWindow: () => BrowserWindow | null
  /** 注入探测实现以便扩展 / 测试；默认使用 detectBrowsers */
  detect?: () => DetectedBrowser[]
  /** 注入批量启动实现以便测试；默认使用 openUrlsInBrowser */
  launchBatch?: typeof openUrlsInBrowser
  /** 判断可执行文件是否存在，默认 existsSync */
  exists?: (path: string) => boolean
}

/**
 * 注册快捷网站编组 IPC 通道：
 * - 列表 / 新增 / 更新 / 删除，变更成功后广播最新列表
 * - 按编组批量打开，浏览器不可用时逐站点回退系统默认浏览器
 */
export function registerQuickSiteGroupIpc(deps: QuickSiteGroupIpcDeps): void {
  const { groupStore, siteStore, getWindow } = deps
  const detect = deps.detect ?? (() => detectBrowsers())
  const launchBatch = deps.launchBatch ?? openUrlsInBrowser
  const fileExists = deps.exists ?? existsSync

  const broadcast = (): void => {
    getWindow()?.webContents.send(
      QUICK_SITE_GROUP_CHANNELS.changed,
      groupStore.getAll()
    )
  }

  ipcMain.handle(QUICK_SITE_GROUP_CHANNELS.list, () => groupStore.getAll())

  ipcMain.handle(
    QUICK_SITE_GROUP_CHANNELS.create,
    (
      _event: Electron.IpcMainInvokeEvent,
      draft: QuickSiteGroupDraft
    ): QuickSiteGroupSaveResult => {
      const result = groupStore.create(draft)
      if (result.ok) {
        broadcast()
      }
      return result
    }
  )

  ipcMain.handle(
    QUICK_SITE_GROUP_CHANNELS.update,
    (
      _event: Electron.IpcMainInvokeEvent,
      id: unknown,
      draft: QuickSiteGroupDraft
    ): QuickSiteGroupSaveResult => {
      if (typeof id !== 'string') {
        return { ok: false, error: '编组不存在' }
      }
      const result = groupStore.update(id, draft)
      if (result.ok) {
        broadcast()
      }
      return result
    }
  )

  ipcMain.handle(
    QUICK_SITE_GROUP_CHANNELS.remove,
    (_event: Electron.IpcMainInvokeEvent, id: unknown) => {
      if (typeof id !== 'string') {
        return
      }
      groupStore.remove(id)
      broadcast()
    }
  )

  ipcMain.handle(
    QUICK_SITE_GROUP_CHANNELS.open,
    async (
      _event: Electron.IpcMainInvokeEvent,
      id: unknown
    ): Promise<OpenQuickSiteGroupResult> => {
      const notFound: OpenQuickSiteGroupResult = {
        ok: false,
        opened: 0,
        fallback: 0,
        failed: 0,
        errors: ['编组不存在']
      }
      if (typeof id !== 'string') {
        return notFound
      }
      const group = groupStore.getById(id)
      if (group === null) {
        return notFound
      }
      return openQuickSiteGroup(group, {
        siteStore,
        detect,
        launchBatch,
        exists: fileExists
      })
    }
  )
}
