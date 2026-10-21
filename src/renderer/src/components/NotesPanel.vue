<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Plus, Search, StickyNote } from 'lucide-vue-next'
import type { Note, NoteDraft } from '@shared/notes'
import NoteCard from '@/components/NoteCard.vue'
import NoteFormDialog from '@/components/NoteFormDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNotes } from '@/composables/useNotes'

const { notes, create, update, remove } = useNotes()

const dialogOpen = ref(false)
const editing = ref<Note | null>(null)

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

const filteredNotes = computed<Note[]>(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return notes.value
  return notes.value.filter(
    (note) =>
      note.title.toLowerCase().includes(query) ||
      note.content.toLowerCase().includes(query)
  )
})

const pinnedCount = computed(
  () => notes.value.filter((note) => note.pinned).length
)

const emptyText = computed(() =>
  hasKeyword.value
    ? '没有匹配的便签，换个关键词试试'
    : '还没有便签，点击右上角新建一条吧'
)

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
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex flex-col gap-2 px-6 py-4">
      <div class="flex items-center justify-between gap-3">
        <div class="relative w-full max-w-xs">
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
        <Button size="sm" @click="openCreate">
          <Plus data-icon="inline-start" />
          新建便签
        </Button>
      </div>

      <p class="text-muted-foreground text-sm">
        共 {{ notes.length }} 条便签 · {{ pinnedCount }} 条置顶
      </p>
    </div>

    <div class="flex-1 overflow-y-auto px-6 pb-6">
      <div
        v-if="filteredNotes.length === 0"
        class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3"
      >
        <StickyNote class="size-10 opacity-40" />
        <p class="text-sm">{{ emptyText }}</p>
      </div>

      <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <NoteCard
          v-for="note in filteredNotes"
          :key="note.id"
          :note="note"
          @edit="openEdit(note)"
          @remove="handleRemove(note)"
          @toggle-pin="handleTogglePin(note)"
        />
      </div>
    </div>

    <NoteFormDialog
      v-model:open="dialogOpen"
      :note="editing"
      @submit="handleSubmit"
    />
  </div>
</template>
