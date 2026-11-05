import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  NEWS_CHANNELS,
  type NewsPlatformId,
  type NewsSection,
  type NewsState
} from '../../shared/news'
import type { NewsStore } from '../news-store'
import { fetchNewsSections } from '../news-provider'

export interface NewsIpcDeps {
  store: NewsStore
  getWindow: () => BrowserWindow | null
  /** 注入取数实现以便扩展 / 测试；默认使用 fetchNewsSections */
  fetchSections?: (platforms: NewsPlatformId[]) => Promise<NewsSection[]>
}

/**
 * 注册热点新闻 IPC 通道：
 * - news:get 读取选中平台并拉取全部平台新闻
 * - news:setPlatforms 归一化持久化后重新拉取，并向当前窗口广播 news:changed
 */
export function registerNewsIpc(deps: NewsIpcDeps): void {
  const fetchSections =
    deps.fetchSections ?? ((platforms) => fetchNewsSections(platforms))

  const buildState = async (selected: NewsPlatformId[]): Promise<NewsState> => {
    const sections = await fetchSections(selected)
    return { selected, sections, updatedAt: Date.now() }
  }

  ipcMain.handle(NEWS_CHANNELS.get, async (): Promise<NewsState> => {
    const selected = deps.store.getPlatforms()
    return buildState(selected)
  })

  ipcMain.handle(
    NEWS_CHANNELS.setPlatforms,
    async (
      _event: Electron.IpcMainInvokeEvent,
      platforms: unknown
    ): Promise<NewsState> => {
      const selected = deps.store.setPlatforms(platforms)
      const state = await buildState(selected)
      deps.getWindow()?.webContents.send(NEWS_CHANNELS.changed, state)
      return state
    }
  )
}
