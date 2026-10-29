import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { createSharedComposable, useDebounceFn } from '@vueuse/core'
import { FILE_KINDS, MAX_RESULTS } from '@shared/files'
import type {
  FileEntry,
  FileKind,
  FileKindFilter,
  FileScanProgress,
  FileSearchResult,
  FileSearchState
} from '@shared/files'

/** 各类型数量：all 为各类型之和，其余按类型 */
export type FileKindCounts = Record<FileKind | 'all', number>

/** 文件搜索 composable 暴露的能力 */
export interface UseFileSearch {
  state: Ref<FileSearchState>
  loading: Ref<boolean>
  keyword: Ref<string>
  activeKind: Ref<FileKindFilter>
  result: Ref<FileSearchResult>
  selectedIndex: Ref<number>
  selectedEntry: ComputedRef<FileEntry | null>
  visibleCounts: ComputedRef<FileKindCounts>
  hasKeyword: ComputedRef<boolean>
  scanningProgress: ComputedRef<FileScanProgress>
  loadState: () => Promise<void>
  runSearch: () => Promise<void>
  rescan: () => Promise<void>
  addRoots: () => Promise<boolean>
  removeRoot: (root: string) => Promise<void>
  moveSelection: (delta: number) => void
  setSelectedIndex: (index: number) => void
}

/** 初始索引状态 */
const INITIAL_STATE: FileSearchState = {
  roots: [],
  indexedCount: 0,
  indexedAt: null,
  scanning: false,
  scanScanned: 0,
  scanCurrentDir: ''
}

/** 全类型计数为 0 的记录 */
function emptyCounts(): Record<FileKind, number> {
  const counts = {} as Record<FileKind, number>
  FILE_KINDS.forEach((kind) => {
    counts[kind] = 0
  })
  return counts
}

/** 空关键词对应的空结果 */
function emptyResult(): FileSearchResult {
  return { entries: [], total: 0, tookMs: 0, counts: emptyCounts() }
}

/**
 * 文件搜索 composable：封装索引状态、查询、目录维护与键盘选中。
 * 面板与目录弹窗共用同一份实例，任一入口的改动都会同步到结果列表。
 */
function createFileSearch(): UseFileSearch {
  const state = ref<FileSearchState>({ ...INITIAL_STATE })
  const loading = ref(false)
  const keyword = ref('')
  const activeKind = ref<FileKindFilter>('all')
  const result = ref<FileSearchResult>(emptyResult())
  const selectedIndex = ref(0)
  const progress = ref<FileScanProgress | null>(null)

  /** 递增请求号：只有最后一次请求的结果会落地 */
  let requestId = 0
  let unsubscribeState: (() => void) | null = null
  let unsubscribeProgress: (() => void) | null = null

  const hasKeyword = computed<boolean>(() => keyword.value.trim() !== '')

  /** 结果变化后选中项回到第一行 */
  const resetSelection = (): void => {
    selectedIndex.value = 0
  }

  /** 合并主进程推送的索引状态 */
  const applyState = (next: FileSearchState): void => {
    state.value = next
    if (!next.scanning) {
      progress.value = null
    }
  }

  const visibleCounts = computed<FileKindCounts>(() => {
    const counts = result.value.counts
    const all = FILE_KINDS.reduce((sum, kind) => sum + counts[kind], 0)
    return { all, ...counts }
  })

  const selectedEntry = computed<FileEntry | null>(
    () => result.value.entries[selectedIndex.value] ?? null
  )

  const scanningProgress = computed<FileScanProgress>(() => ({
    scanned: progress.value?.scanned ?? state.value.scanScanned,
    currentDir: progress.value?.currentDir || state.value.scanCurrentDir,
    done: !state.value.scanning
  }))

  const runSearch = async (): Promise<void> => {
    const current = ++requestId
    const query = keyword.value.trim()
    if (!query) {
      result.value = emptyResult()
      loading.value = false
      resetSelection()
      return
    }

    loading.value = true
    try {
      const next = await window.api.files.search({
        keyword: query,
        kind: activeKind.value,
        limit: MAX_RESULTS
      })
      if (current !== requestId) return
      result.value = next
      resetSelection()
    } catch {
      if (current !== requestId) return
      result.value = emptyResult()
      resetSelection()
    } finally {
      if (current === requestId) {
        loading.value = false
      }
    }
  }

  const loadState = async (): Promise<void> => {
    try {
      applyState(await window.api.files.getState())
    } catch {
      // 失败时保留上一次已知状态，保持界面可用
    }
  }

  const rescan = async (): Promise<void> => {
    try {
      applyState(await window.api.files.rescan())
      await runSearch()
    } catch {
      // 失败时保持界面可用
    }
  }

  const addRoots = async (): Promise<boolean> => {
    try {
      const res = await window.api.files.addRoots()
      if (res.canceled || res.error || res.roots.length === 0) {
        return false
      }
      await loadState()
      await runSearch()
      return true
    } catch {
      return false
    }
  }

  const removeRoot = async (root: string): Promise<void> => {
    try {
      applyState(await window.api.files.removeRoot(root))
      await runSearch()
    } catch {
      // 失败时保持界面可用
    }
  }

  /** 上下移动选中项，越界时夹取到首尾 */
  const moveSelection = (delta: number): void => {
    const total = result.value.entries.length
    if (total === 0) return
    const next = selectedIndex.value + delta
    selectedIndex.value = Math.min(Math.max(next, 0), total - 1)
  }

  const setSelectedIndex = (index: number): void => {
    const total = result.value.entries.length
    if (total === 0) return
    selectedIndex.value = Math.min(Math.max(index, 0), total - 1)
  }

  const debouncedRunSearch = useDebounceFn(runSearch, 150)

  watch(keyword, () => {
    void debouncedRunSearch()
  })

  watch(activeKind, () => {
    void runSearch()
  })

  onMounted(async () => {
    await loadState()
    unsubscribeState = window.api.files.onStateChanged(applyState)
    unsubscribeProgress = window.api.files.onScanProgress((next) => {
      progress.value = next.done ? null : next
      state.value = {
        ...state.value,
        scanning: !next.done,
        scanScanned: next.scanned,
        scanCurrentDir: next.currentDir
      }
      if (!next.done) return
      void loadState()
      if (hasKeyword.value) {
        void runSearch()
      }
    })
  })

  onUnmounted(() => {
    unsubscribeState?.()
    unsubscribeProgress?.()
    unsubscribeState = null
    unsubscribeProgress = null
  })

  return {
    state,
    loading,
    keyword,
    activeKind,
    result,
    selectedIndex,
    selectedEntry,
    visibleCounts,
    hasKeyword,
    scanningProgress,
    loadState,
    runSearch,
    rescan,
    addRoots,
    removeRoot,
    moveSelection,
    setSelectedIndex
  }
}

export const useFileSearch = createSharedComposable(createFileSearch)
