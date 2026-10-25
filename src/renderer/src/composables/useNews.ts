import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { NewsPlatformId, NewsSection, NewsState } from '@shared/news'

interface UseNews {
  state: Ref<NewsState | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  selectedPlatforms: ComputedRef<NewsPlatformId[]>
  sections: ComputedRef<NewsSection[]>
  updatedAt: ComputedRef<number>
  load: () => Promise<void>
  refresh: () => Promise<void>
  applyPlatforms: (platforms: NewsPlatformId[]) => Promise<void>
  subscribe: () => () => void
}

/**
 * 模块级共享状态：页面可能多次调用 useNews，
 * 状态与函数统一在模块顶层声明，保证多次调用共享同一份数据。
 */
const state = ref<NewsState | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const selectedPlatforms = computed<NewsPlatformId[]>(
  () => state.value?.selected ?? []
)

const sections = computed<NewsSection[]>(() => state.value?.sections ?? [])

const updatedAt = computed<number>(() => state.value?.updatedAt ?? 0)

/** 首次进入时加载；已有数据或正在加载则直接返回 */
const load = async (): Promise<void> => {
  if (loading.value || state.value !== null) return
  loading.value = true
  error.value = null
  try {
    state.value = await window.api.news.get()
  } catch {
    error.value = '新闻加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/** 强制重新拉取；失败时保留旧数据，仅提示错误 */
const refresh = async (): Promise<void> => {
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    const next = await window.api.news.get()
    // 全部失败时保留旧数据，不清空已展示的新闻
    const allFailed =
      next.sections.length > 0 &&
      next.sections.every((section) => section.error !== null)
    const hasOldItems =
      state.value !== null &&
      state.value.sections.some((section) => section.items.length > 0)
    if (allFailed && hasOldItems) {
      error.value = '刷新失败，请检查网络后重试'
      return
    }
    state.value = next
  } catch {
    error.value = '刷新失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/** 保存平台选择，写入主进程返回的最新状态 */
const applyPlatforms = async (platforms: NewsPlatformId[]): Promise<void> => {
  error.value = null
  try {
    state.value = await window.api.news.setPlatforms(platforms)
  } catch {
    error.value = '保存平台选择失败，请稍后重试'
  }
}

/** 订阅主进程广播，返回取消订阅函数 */
const subscribe = (): (() => void) =>
  window.api.news.onChanged((next) => {
    state.value = next
  })

/** 热点新闻数据的 composable，共享模块级状态 */
export function useNews(): UseNews {
  return {
    state,
    loading,
    error,
    selectedPlatforms,
    sections,
    updatedAt,
    load,
    refresh,
    applyPlatforms,
    subscribe
  }
}
