<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import {
  Check,
  ListChecks,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X
} from 'lucide-vue-next'
import type { Note, NoteDraft } from '@shared/notes'
import { NOTE_CATEGORY_MAX_LENGTH } from '@shared/notes'
import NoteCard from '@/components/NoteCard.vue'
import NoteFormDialog from '@/components/NoteFormDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { useNotes } from '@/composables/useNotes'

const {
  notes,
  refresh,
  create,
  update,
  remove,
  setCategory,
  renameCategory,
  removeCategory
} = useNotes()

const dialogOpen = ref(false)
const editing = ref<Note | null>(null)

/** 分类重命名输入框实例 */
const renameInput = ref<InstanceType<typeof Input> | null>(null)
const renamingCategory = ref(false)
const renameDraft = ref('')

const searchQuery = ref('')
const keyword = ref('')

/** 输入防抖 200ms 后再更新实际过滤关键词 */
const applyKeyword = useDebounceFn((value: string): void => {
  keyword.value = value
}, 200)

watch(searchQuery, (value) => {
  void applyKeyword(value)
})

const hasKeyword = computed(() => keyword.value.trim() !== '')

/** 当前分类筛选：null=全部、''=未分类、其它=分类名 */
const activeCategory = ref<string | null>(null)

/** 汇总非空分类的数量，按数量倒序、同数量按名称排序 */
const categoryOptions = computed<{ name: string; count: number }[]>(() => {
  const counts = new Map<string, number>()
  for (const note of notes.value) {
    if (!note.category) continue
    counts.set(note.category, (counts.get(note.category) ?? 0) + 1)
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  )
})

const uncategorizedCount = computed(
  () => notes.value.filter((note) => note.category === '').length
)

const categoryNames = computed(() => categoryOptions.value.map((o) => o.name))

/** 分类标签的选中 / 未选中样式 */
const categoryChipClass = (active: boolean): string =>
  active
    ? 'border-primary/60 bg-primary/10 text-primary'
    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'

/**
 * 关键词与分类双重过滤：
 * activeCategory 为 null 时保留全部，'' 时仅未分类，否则仅该分类
 */
const filteredNotes = computed<Note[]>(() => {
  const query = keyword.value.trim().toLowerCase()
  const category = activeCategory.value
  return notes.value.filter((note) => {
    if (category !== null && note.category !== category) return false
    if (!query) return true
    return (
      note.title.toLowerCase().includes(query) ||
      note.content.toLowerCase().includes(query)
    )
  })
})

/** 选择模式与批量整理状态 */
const selectMode = ref(false)
const selectedIds = ref<string[]>([])
const batchCategory = ref('')

/** 选中条数：只统计列表中仍存在的便签 */
const selectedCount = computed(
  () => notes.value.filter((note) => selectedIds.value.includes(note.id)).length
)

const allSelected = computed(
  () =>
    filteredNotes.value.length > 0 &&
    filteredNotes.value.every((note) => selectedIds.value.includes(note.id))
)

const hasSelection = computed(() => selectedCount.value > 0)

/** 选中的分类已不存在时回退到「全部」 */
watch([categoryOptions, uncategorizedCount], ([options, uncategorized]) => {
  const current = activeCategory.value
  if (current === null) return
  if (current === '') {
    if (uncategorized === 0) activeCategory.value = null
    return
  }
  if (!options.some((option) => option.name === current)) {
    activeCategory.value = null
  }
})

const pinnedCount = computed(
  () => notes.value.filter((note) => note.pinned).length
)

const emptyText = computed(() => {
  const category = activeCategory.value
  if (category !== null) {
    const label = category === '' ? '未分类' : category
    return hasKeyword.value
      ? `「${label}」下没有匹配的便签`
      : `「${label}」下还没有便签`
  }
  return hasKeyword.value
    ? '没有匹配的便签，换个关键词试试'
    : '还没有便签，点击右上角新建一条吧'
})

const openCreate = (): void => {
  editing.value = null
  dialogOpen.value = true
}

const openEdit = (note: Note): void => {
  editing.value = note
  dialogOpen.value = true
}

const handleSubmit = async (draft: NoteDraft): Promise<void> => {
  if (editing.value) {
    await update(editing.value.id, draft)
  } else {
    await create(draft)
  }
}

const handleTogglePin = (note: Note): void => {
  void update(note.id, {
    title: note.title,
    content: note.content,
    category: note.category,
    color: note.color,
    pinned: !note.pinned
  })
}

const handleRemove = (note: Note): void => {
  const name = note.title.trim() || '无标题'
  const confirmed = window.confirm(`确定删除便签「${name}」吗？`)
  if (confirmed) {
    void remove(note.id)
  }
}

const enterSelectMode = (): void => {
  selectMode.value = true
  selectedIds.value = []
  batchCategory.value = ''
}

const exitSelectMode = (): void => {
  selectMode.value = false
  selectedIds.value = []
  batchCategory.value = ''
}

const toggleSelect = (note: Note): void => {
  const index = selectedIds.value.indexOf(note.id)
  if (index === -1) {
    selectedIds.value.push(note.id)
  } else {
    selectedIds.value.splice(index, 1)
  }
}

const toggleSelectAll = (): void => {
  if (allSelected.value) {
    selectedIds.value = []
    return
  }
  selectedIds.value = filteredNotes.value.map((note) => note.id)
}

const handleBatchMove = async (category: string): Promise<void> => {
  if (selectedCount.value === 0) return
  await setCategory([...selectedIds.value], category)
  exitSelectMode()
}

const handleBatchCreate = (): void => {
  const next = batchCategory.value.trim()
  if (!next) return
  void handleBatchMove(next)
}

const handleChangeCategory = (note: Note, category: string): void => {
  void setCategory([note.id], category)
}

/** 重命名输入框在 v-for 内，用函数 ref 避免被收集成数组 */
const captureRenameInput = (el: unknown): void => {
  renameInput.value = (el as InstanceType<typeof Input> | null) ?? null
}

const focusRenameInput = (): void => {
  const el = renameInput.value?.$el
  if (el instanceof HTMLInputElement) {
    el.focus()
    el.select()
  }
}

const startRename = (): void => {
  const current = activeCategory.value
  if (current === null || current === '') return
  renameDraft.value = current
  renamingCategory.value = true
  void nextTick(focusRenameInput)
}

const cancelRename = (): void => {
  renamingCategory.value = false
  renameDraft.value = ''
}

const commitRename = async (): Promise<void> => {
  const current = activeCategory.value
  if (current === null || current === '') {
    cancelRename()
    return
  }
  const next = renameDraft.value.trim()
  if (!next || next === current) {
    cancelRename()
    return
  }
  if (categoryNames.value.includes(next)) {
    const confirmed = window.confirm(
      `已存在分类「${next}」，重命名后将合并为同一分类，继续？`
    )
    if (!confirmed) return
  }
  await renameCategory(current, next)
  await refresh()
  activeCategory.value = next
  renamingCategory.value = false
  renameDraft.value = ''
}

const handleRemoveCategory = async (): Promise<void> => {
  const current = activeCategory.value
  if (current === null || current === '') return
  const count =
    categoryOptions.value.find((option) => option.name === current)?.count ?? 0
  const confirmed = window.confirm(
    `删除分类「${current}」？该分类下 ${count} 条便签将变为未分类。`
  )
  if (!confirmed) return
  await removeCategory(current)
  await refresh()
  activeCategory.value = null
}

/** 选择模式下便签被清空时自动退出 */
watch(notes, (list) => {
  if (selectMode.value && list.length === 0) exitSelectMode()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex flex-col gap-2 px-6 py-4">
      <div class="flex items-center justify-between gap-3">
        <div class="relative w-full max-w-xs transition-all duration-200">
          <Search
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            v-model="searchQuery"
            class="pl-8"
            placeholder="搜索便签…"
            aria-label="搜索便签"
          />
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <Button
            v-if="!selectMode && notes.length > 0"
            variant="ghost"
            size="sm"
            @click="enterSelectMode"
          >
            <ListChecks data-icon="inline-start" />
            选择
          </Button>
          <Button v-if="!selectMode" size="sm" @click="openCreate">
            <Plus data-icon="inline-start" />
            新建便签
          </Button>
          <Button v-else variant="outline" size="sm" @click="exitSelectMode">
            完成
          </Button>
        </div>
      </div>

      <div
        v-if="notes.length > 0 && !selectMode"
        class="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="按分类筛选便签"
      >
        <button
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
          :class="categoryChipClass(activeCategory === null)"
          :aria-pressed="activeCategory === null"
          :disabled="renamingCategory"
          @click="activeCategory = null"
        >
          全部 {{ notes.length }}
        </button>
        <button
          v-if="uncategorizedCount > 0"
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
          :class="categoryChipClass(activeCategory === '')"
          :aria-pressed="activeCategory === ''"
          :disabled="renamingCategory"
          @click="activeCategory = ''"
        >
          未分类 {{ uncategorizedCount }}
        </button>
        <template v-for="option in categoryOptions" :key="option.name">
          <div
            v-if="renamingCategory && activeCategory === option.name"
            class="flex items-center gap-1"
          >
            <Input
              :ref="captureRenameInput"
              v-model="renameDraft"
              :maxlength="NOTE_CATEGORY_MAX_LENGTH"
              class="h-6 w-24 text-xs"
              aria-label="重命名分类"
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="cancelRename"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="确认重命名"
              @click="commitRename"
            >
              <Check class="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="取消重命名"
              @click="cancelRename"
            >
              <X class="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          <button
            v-else
            type="button"
            class="rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
            :class="categoryChipClass(activeCategory === option.name)"
            :aria-pressed="activeCategory === option.name"
            :disabled="renamingCategory"
            @click="activeCategory = option.name"
          >
            {{ option.name }} {{ option.count }}
          </button>
        </template>
        <div
          v-if="activeCategory !== null && activeCategory !== ''"
          class="ml-auto flex items-center gap-0.5"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="重命名分类"
                :disabled="renamingCategory"
                @click="startRename"
              >
                <Pencil aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重命名分类</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-xs"
                class="text-destructive hover:text-destructive"
                aria-label="删除分类"
                :disabled="renamingCategory"
                @click="handleRemoveCategory"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>删除分类</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        v-if="selectMode"
        class="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="批量整理便签"
      >
        <span class="text-muted-foreground text-xs">
          已选
          <span class="text-foreground font-medium">{{ selectedCount }}</span>
          条
        </span>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
          :disabled="filteredNotes.length === 0"
          @click="toggleSelectAll"
        >
          {{ allSelected ? '取消全选' : '全选' }}
        </button>
        <span class="bg-border h-3.5 w-px" aria-hidden="true" />
        <button
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
          :class="categoryChipClass(false)"
          :disabled="!hasSelection"
          @click="handleBatchMove('')"
        >
          未分类
        </button>
        <button
          v-for="option in categoryOptions"
          :key="option.name"
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
          :class="categoryChipClass(false)"
          :disabled="!hasSelection"
          @click="handleBatchMove(option.name)"
        >
          {{ option.name }}
        </button>
        <div class="ml-auto flex items-center gap-1">
          <Input
            v-model="batchCategory"
            :maxlength="NOTE_CATEGORY_MAX_LENGTH"
            placeholder="新分类…"
            class="h-6 w-24 text-xs"
            aria-label="新建分类并移动"
            :disabled="!hasSelection"
            @keydown.enter.prevent="handleBatchCreate"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="新建分类并移动"
            :disabled="!batchCategory.trim() || !hasSelection"
            @click="handleBatchCreate"
          >
            <Plus class="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        <p
          v-if="selectedCount === 0"
          class="text-muted-foreground w-full text-xs"
        >
          点击便签卡片选择要整理的便签
        </p>
      </div>

      <p v-if="!selectMode" class="text-muted-foreground text-sm">
        共
        <span class="text-foreground font-medium">{{ notes.length }}</span>
        条便签 ·
        <span class="text-foreground font-medium">{{ pinnedCount }}</span>
        条置顶
      </p>
    </div>

    <div class="flex-1 overflow-y-auto px-6 pb-6">
      <div
        v-if="filteredNotes.length === 0"
        class="empty-state text-muted-foreground h-full"
      >
        <span class="empty-state-icon"><StickyNote class="size-6" /></span>
        <p class="text-sm">{{ emptyText }}</p>
      </div>

      <div v-else class="stagger-list grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <NoteCard
          v-for="note in filteredNotes"
          :key="note.id"
          :note="note"
          :categories="categoryNames"
          :selectable="selectMode"
          :selected="selectedIds.includes(note.id)"
          @edit="openEdit(note)"
          @remove="handleRemove(note)"
          @toggle-pin="handleTogglePin(note)"
          @change-category="handleChangeCategory(note, $event)"
          @toggle-select="toggleSelect(note)"
        />
      </div>
    </div>

    <NoteFormDialog
      v-model:open="dialogOpen"
      :note="editing"
      :categories="categoryNames"
      @submit="handleSubmit"
    />
  </div>
</template>
