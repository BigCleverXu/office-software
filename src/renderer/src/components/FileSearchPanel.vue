<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useEventListener, useTimeoutFn } from '@vueuse/core'
import {
  FolderCog,
  FolderPlus,
  FolderSearch,
  RefreshCw,
  Search,
  SearchX
} from 'lucide-vue-next'
import { ALL_KIND_LABEL, FILE_KINDS, FILE_KIND_LABELS } from '@shared/files'
import type { FileEntry, FileKindFilter } from '@shared/files'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import FilePreviewDialog from '@/components/FilePreviewDialog.vue'
import FileResultList from '@/components/FileResultList.vue'
import FileRootsDialog from '@/components/FileRootsDialog.vue'
import { useFileSearch } from '@/composables/useFileSearch'
import { formatCount, formatModifiedAt } from '@/lib/file-format'

const {
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
  rescan,
  addRoots,
  moveSelection,
  setSelectedIndex
} = useFileSearch()

const searchInput = ref<InstanceType<typeof Input> | null>(null)
/** 面板根节点：模块隐藏时（v-show）不响应全局键盘 */
const panelRef = ref<HTMLElement | null>(null)

const previewOpen = ref(false)
const previewPath = ref('')
const rootsOpen = ref(false)
const hint = ref('')

const { start: startHintTimer } = useTimeoutFn(
  () => {
    hint.value = ''
  },
  3000,
  { immediate: false }
)

const showHint = (message: string): void => {
  hint.value = message
  startHintTimer()
}

interface KindTab {
  value: FileKindFilter
  label: string
  count: number
}

/** 分类标签：全部 + 各类型，数量为 0 的类型也展示 */
const kindTabs = computed<KindTab[]>(() => [
  {
    value: 'all',
    label: ALL_KIND_LABEL,
    count: visibleCounts.value.all
  },
  ...FILE_KINDS.map((kind) => ({
    value: kind,
    label: FILE_KIND_LABELS[kind],
    count: visibleCounts.value[kind]
  }))
])

const indexedLabel = computed<string>(() =>
  formatCount(state.value.indexedCount)
)

const lastScanLabel = computed<string>(() =>
  formatModifiedAt(state.value.indexedAt ?? 0)
)

const scannedLabel = computed<string>(() =>
  formatCount(scanningProgress.value.scanned)
)

const currentScanDir = computed<string>(() => scanningProgress.value.currentDir)

/** 任一弹窗打开时不做全局键盘响应 */
const overlayOpen = computed<boolean>(
  () => previewOpen.value || rootsOpen.value
)

const handlePreview = (entry: FileEntry): void => {
  previewPath.value = entry.path
  previewOpen.value = true
}

const handleOpen = async (entry: FileEntry): Promise<void> => {
  try {
    const res = await window.api.files.open(entry.path)
    if (!res.ok) {
      showHint(res.error ?? '无法用默认程序打开该文件')
    }
  } catch {
    showHint('无法用默认程序打开该文件')
  }
}

const handleReveal = async (entry: FileEntry): Promise<void> => {
  try {
    const res = await window.api.files.reveal(entry.path)
    if (!res.ok) {
      showHint(res.error ?? '无法在文件夹中显示该文件')
    }
  } catch {
    showHint('无法在文件夹中显示该文件')
  }
}

const handleRescan = async (): Promise<void> => {
  await rescan()
  showHint('已发起重新扫描')
}

const handleAddRoots = async (): Promise<void> => {
  const added = await addRoots()
  if (added) {
    showHint('已添加搜索目录，正在后台扫描')
  }
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (overlayOpen.value || event.isComposing) return
  if (!panelRef.value?.offsetParent) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelection(event.key === 'ArrowDown' ? 1 : -1)
    return
  }

  if (event.key !== 'Enter') return

  const entry = selectedEntry.value
  if (!entry) return
  event.preventDefault()
  if (event.ctrlKey || event.metaKey) {
    void handleOpen(entry)
    return
  }
  handlePreview(entry)
}

useEventListener(window, 'keydown', handleKeydown)

onMounted(() => {
  const el = searchInput.value?.$el
  if (el instanceof HTMLInputElement) {
    el.focus()
  }
})
</script>

<template>
  <div ref="panelRef" class="flex h-full flex-col">
    <div class="flex flex-col gap-3 px-6 py-4">
      <div class="flex items-center justify-between gap-3">
        <div class="relative w-full max-w-sm">
          <Search
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            ref="searchInput"
            v-model="keyword"
            class="pl-8"
            placeholder="搜索文件名…"
            aria-label="搜索文件名"
          />
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" @click="rootsOpen = true">
            <FolderCog data-icon="inline-start" />
            管理目录
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="state.scanning"
            @click="handleRescan"
          >
            <RefreshCw
              data-icon="inline-start"
              class="motion-reduce:animate-none"
              :class="{ 'animate-spin': state.scanning }"
            />
            重新扫描
          </Button>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <p class="text-muted-foreground text-sm">
          共索引
          <span class="text-foreground font-medium">{{ indexedLabel }}</span>
          个文件 · 上次扫描 {{ lastScanLabel }} ·
          {{ state.roots.length }} 个目录
        </p>

        <p v-if="loading" class="text-muted-foreground text-xs">搜索中…</p>

        <div v-if="state.scanning" class="flex flex-col gap-1.5">
          <Progress :model-value="100" class="h-1.5 animate-pulse" />
          <div class="text-muted-foreground flex items-center gap-2 text-xs">
            <span class="shrink-0">已扫描 {{ scannedLabel }} 个</span>
            <span class="min-w-0 flex-1 truncate" :title="currentScanDir">
              {{ currentScanDir }}
            </span>
          </div>
        </div>

        <p
          v-if="hint"
          class="text-primary bg-primary/10 rounded-md px-3 py-1.5 text-xs"
        >
          {{ hint }}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="tab in kindTabs"
          :key="tab.value"
          type="button"
          class="rounded-full border px-3 py-1 text-xs transition-colors"
          :class="
            activeKind === tab.value
              ? 'bg-primary text-primary-foreground border-transparent'
              : 'border-border text-muted-foreground hover:bg-muted'
          "
          :aria-pressed="activeKind === tab.value"
          @click="activeKind = tab.value"
        >
          {{ tab.label }}
          <span class="ml-0.5 opacity-70">{{ tab.count }}</span>
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-3 pb-6">
      <FileResultList
        v-if="hasKeyword && result.entries.length > 0"
        :entries="result.entries"
        :selected-index="selectedIndex"
        :keyword="keyword"
        @select="setSelectedIndex"
        @preview="handlePreview"
        @open="handleOpen"
        @reveal="handleReveal"
      />

      <div v-else class="empty-state text-muted-foreground h-full px-6">
        <template v-if="state.roots.length === 0">
          <span class="empty-state-icon"><FolderPlus class="size-6" /></span>
          <div class="flex flex-col gap-1">
            <p class="text-foreground text-sm font-semibold">还没有搜索目录</p>
            <p class="text-sm">添加目录后即可快速检索本地文件</p>
          </div>
          <Button size="sm" @click="handleAddRoots">
            <FolderPlus data-icon="inline-start" />
            添加目录
          </Button>
        </template>

        <template v-else-if="hasKeyword">
          <span class="empty-state-icon"><SearchX class="size-6" /></span>
          <div class="flex flex-col gap-1">
            <p class="text-foreground text-sm font-semibold">没有匹配的文件</p>
            <p class="text-sm">换个关键词试试</p>
          </div>
        </template>

        <template v-else>
          <span class="empty-state-icon"><FolderSearch class="size-6" /></span>
          <div class="flex flex-col gap-1">
            <p class="text-foreground text-sm font-semibold">
              输入文件名开始搜索
            </p>
            <p class="text-sm">支持按类型筛选，Enter 预览，Ctrl+Enter 打开</p>
          </div>
        </template>
      </div>
    </div>

    <FilePreviewDialog v-model:open="previewOpen" :path="previewPath" />
    <FileRootsDialog v-model:open="rootsOpen" />
  </div>
</template>
