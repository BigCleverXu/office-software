import { onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type {
  DetectedBrowser,
  OpenQuickSiteResult,
  QuickSite,
  QuickSiteDraft,
  QuickSiteSaveResult
} from '@shared/quick-sites'

export interface UseQuickSites {
  sites: Ref<QuickSite[]>
  browsers: Ref<DetectedBrowser[]>
  loading: Ref<boolean>
  browsersLoading: Ref<boolean>
  refresh: () => Promise<void>
  refreshBrowsers: () => Promise<void>
  create: (draft: QuickSiteDraft) => Promise<QuickSiteSaveResult>
  update: (id: string, draft: QuickSiteDraft) => Promise<QuickSiteSaveResult>
  remove: (id: string) => Promise<void>
  open: (id: string) => Promise<OpenQuickSiteResult>
}

/**
 * 快捷站点数据 composable：封装 IPC 交互、浏览器扫描与跨窗口变更订阅。
 * 订阅在组合式内建立，并在组件卸载时取消。
 */
export function useQuickSites(): UseQuickSites {
  const sites = ref<QuickSite[]>([])
  const browsers = ref<DetectedBrowser[]>([])
  const loading = ref(false)
  const browsersLoading = ref(false)

  const refresh = async (): Promise<void> => {
    loading.value = true
    try {
      sites.value = await window.api.quickSites.list()
    } catch {
      // 读取失败时保留当前列表，避免未处理的 Promise 拒绝
    } finally {
      loading.value = false
    }
  }

  const refreshBrowsers = async (): Promise<void> => {
    browsersLoading.value = true
    try {
      const result = await window.api.quickSites.listBrowsers()
      browsers.value = result.browsers
    } catch {
      // 扫描失败时静默降级，系统默认浏览器仍可由后端兜底
      browsers.value = []
    } finally {
      browsersLoading.value = false
    }
  }

  const create = async (
    draft: QuickSiteDraft
  ): Promise<QuickSiteSaveResult> => {
    const result = await window.api.quickSites.create(draft)
    if (result.ok) {
      await refresh()
    }
    return result
  }

  const update = async (
    id: string,
    draft: QuickSiteDraft
  ): Promise<QuickSiteSaveResult> => {
    const result = await window.api.quickSites.update(id, draft)
    if (result.ok) {
      await refresh()
    }
    return result
  }

  const remove = async (id: string): Promise<void> => {
    await window.api.quickSites.remove(id)
    await refresh()
  }

  const open = (id: string): Promise<OpenQuickSiteResult> =>
    window.api.quickSites.open(id)

  const unsubscribe = window.api.quickSites.onChanged((list) => {
    sites.value = list
  })

  onUnmounted(() => {
    unsubscribe()
  })

  return {
    sites,
    browsers,
    loading,
    browsersLoading,
    refresh,
    refreshBrowsers,
    create,
    update,
    remove,
    open
  }
}
