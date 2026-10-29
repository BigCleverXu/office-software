<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Component } from 'vue'
import {
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileText,
  FileVideo,
  FolderOpen,
  Image
} from 'lucide-vue-next'
import type { FileEntry, FileKind } from '@shared/files'
import {
  formatBytes,
  formatModifiedAt,
  splitHighlight
} from '@/lib/file-format'

const props = defineProps<{
  entries: FileEntry[]
  selectedIndex: number
  keyword: string
}>()

const emit = defineEmits<{
  select: [index: number]
  preview: [entry: FileEntry]
  open: [entry: FileEntry]
  reveal: [entry: FileEntry]
}>()

/** 文件类型对应的图标 */
const KIND_ICONS: Record<FileKind, Component> = {
  image: Image,
  document: FileText,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  code: FileCode,
  other: File
}

interface ResultRow {
  entry: FileEntry
  icon: Component
  segments: ReturnType<typeof splitHighlight>
  sizeLabel: string
  modifiedLabel: string
}

/** 预计算行内展示数据，模板中不再调用格式化函数 */
const rows = computed<ResultRow[]>(() =>
  props.entries.map((entry) => ({
    entry,
    icon: KIND_ICONS[entry.kind] ?? File,
    segments: splitHighlight(entry.name, props.keyword),
    sizeLabel: formatBytes(entry.size),
    modifiedLabel: formatModifiedAt(entry.modifiedAt)
  }))
)

/** 行元素引用，用于选中时滚动到可视区 */
const rowRefs = ref<HTMLButtonElement[]>([])

watch(
  () => props.selectedIndex,
  async (index) => {
    await nextTick()
    rowRefs.value[index]?.scrollIntoView({ block: 'nearest' })
  }
)
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <button
      v-for="(row, index) in rows"
      :key="row.entry.path"
      ref="rowRefs"
      type="button"
      class="group hover:bg-muted/60 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
      :class="{
        'bg-primary/10 ring-primary/30 ring-1': index === selectedIndex
      }"
      :aria-current="index === selectedIndex ? 'true' : undefined"
      @click="emit('select', index)"
      @dblclick="emit('preview', row.entry)"
    >
      <component
        :is="row.icon"
        class="text-muted-foreground size-4 shrink-0"
        aria-hidden="true"
      />

      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-sm">
          <template
            v-for="(segment, segmentIndex) in row.segments"
            :key="segmentIndex"
          >
            <span v-if="segment.match" class="text-primary font-semibold">{{
              segment.text
            }}</span>
            <span v-else>{{ segment.text }}</span>
          </template>
        </span>
        <span
          class="text-muted-foreground truncate text-xs"
          :title="row.entry.dir"
        >
          {{ row.entry.dir }}
        </span>
      </span>

      <span
        class="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs"
      >
        <span>{{ row.sizeLabel }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ row.modifiedLabel }}</span>
      </span>

      <span
        class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        <button
          type="button"
          class="hover:bg-background/80 rounded-md p-1 transition-colors"
          aria-label="用默认程序打开"
          @click.stop="emit('open', row.entry)"
        >
          <ExternalLink class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="hover:bg-background/80 rounded-md p-1 transition-colors"
          aria-label="在文件夹中显示"
          @click.stop="emit('reveal', row.entry)"
        >
          <FolderOpen class="size-3.5" aria-hidden="true" />
        </button>
      </span>
    </button>
  </div>
</template>
