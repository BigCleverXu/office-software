<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-vue-next'
import type { Note, NoteColor } from '@shared/notes'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

const props = defineProps<{ note: Note }>()

const emit = defineEmits<{
  edit: []
  remove: []
  'toggle-pin': []
}>()

/** 便签颜色对应的卡片边框与背景（显式列出，避免动态拼接类名） */
const COLOR_STYLES: Record<NoteColor, string> = {
  default: 'border-border bg-card',
  yellow:
    'border-yellow-200 bg-yellow-50 dark:border-yellow-900/60 dark:bg-yellow-950/40',
  green:
    'border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-950/40',
  blue: 'border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/40',
  pink: 'border-pink-200 bg-pink-50 dark:border-pink-900/60 dark:bg-pink-950/40'
}

/** 便签颜色对应的圆点标识 */
const COLOR_DOT_STYLES: Record<NoteColor, string> = {
  default: 'bg-muted-foreground/40',
  yellow: 'bg-yellow-400',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  pink: 'bg-pink-400'
}

const cardClass = computed(() => COLOR_STYLES[props.note.color])

const dotClass = computed(() => COLOR_DOT_STYLES[props.note.color])

const title = computed(() => props.note.title.trim() || '无标题')

const hasContent = computed(() => props.note.content.trim() !== '')

const pinLabel = computed(() => (props.note.pinned ? '取消置顶' : '置顶便签'))

const pinActionLabel = computed(() => (props.note.pinned ? '取消置顶' : '置顶'))

/** 更新时间文案：当天显示时分，当年显示月日，跨年显示完整日期 */
function formatUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (sameDay) {
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `今天 ${hours}:${minutes}`
  }

  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}月${day}日`
  }
  return `${date.getFullYear()}年${month}月${day}日`
}

const updatedAtLabel = computed(() => formatUpdatedAt(props.note.updatedAt))
</script>

<template>
  <article
    class="card-interactive shadow-soft flex h-full flex-col gap-2 rounded-xl border p-3 transition-colors"
    :class="cardClass"
  >
    <header class="flex items-start gap-2">
      <span
        class="mt-1.5 size-2 shrink-0 rounded-full"
        :class="dotClass"
        aria-hidden="true"
      />
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <h3 class="truncate text-sm font-medium">{{ title }}</h3>
        <Pin
          v-if="note.pinned"
          class="size-3.5 shrink-0 opacity-70"
          aria-hidden="true"
        />
      </div>
    </header>

    <p
      v-if="hasContent"
      class="line-clamp-3 text-sm break-words whitespace-pre-line opacity-80"
    >
      {{ note.content }}
    </p>

    <footer class="mt-auto flex items-center justify-between gap-2 pt-1">
      <span class="text-muted-foreground text-xs">
        更新于 {{ updatedAtLabel }}
      </span>

      <div class="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="pinLabel"
              :class="{ 'text-primary': note.pinned }"
              @click="emit('toggle-pin')"
            >
              <PinOff v-if="note.pinned" />
              <Pin v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ pinActionLabel }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="编辑便签"
              @click="emit('edit')"
            >
              <Pencil />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="删除便签"
              class="text-destructive hover:text-destructive"
              @click="emit('remove')"
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </footer>
  </article>
</template>
