import { onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type {
  OpenQuickSiteGroupResult,
  QuickSiteGroup,
  QuickSiteGroupDraft,
  QuickSiteGroupSaveResult
} from '@shared/quick-sites'

export interface UseQuickSiteGroups {
  groups: Ref<QuickSiteGroup[]>
  loading: Ref<boolean>
  refresh: () => Promise<void>
  create: (draft: QuickSiteGroupDraft) => Promise<QuickSiteGroupSaveResult>
  update: (
    id: string,
    draft: QuickSiteGroupDraft
  ) => Promise<QuickSiteGroupSaveResult>
  remove: (id: string) => Promise<void>
  open: (id: string) => Promise<OpenQuickSiteGroupResult>
}

/**
 * 快捷网站编组数据 composable：封装 IPC 交互与跨窗口变更订阅。
 * 订阅在组合式内建立，并在组件卸载时取消。
 */
export function useQuickSiteGroups(): UseQuickSiteGroups {
  const groups = ref<QuickSiteGroup[]>([])
  const loading = ref(false)

  const refresh = async (): Promise<void> => {
    loading.value = true
    try {
      groups.value = await window.api.quickSites.listGroups()
    } catch {
      // 读取失败时保留当前列表，避免未处理的 Promise 拒绝
    } finally {
      loading.value = false
    }
  }

  const create = async (
    draft: QuickSiteGroupDraft
  ): Promise<QuickSiteGroupSaveResult> => {
    const result = await window.api.quickSites.createGroup(draft)
    if (result.ok) {
      await refresh()
    }
    return result
  }

  const update = async (
    id: string,
    draft: QuickSiteGroupDraft
  ): Promise<QuickSiteGroupSaveResult> => {
    const result = await window.api.quickSites.updateGroup(id, draft)
    if (result.ok) {
      await refresh()
    }
    return result
  }

  const remove = async (id: string): Promise<void> => {
    await window.api.quickSites.removeGroup(id)
    await refresh()
  }

  const open = (id: string): Promise<OpenQuickSiteGroupResult> =>
    window.api.quickSites.openGroup(id)

  const unsubscribe = window.api.quickSites.onGroupsChanged((list) => {
    groups.value = list
  })

  onUnmounted(() => {
    unsubscribe()
  })

  return {
    groups,
    loading,
    refresh,
    create,
    update,
    remove,
    open
  }
}
