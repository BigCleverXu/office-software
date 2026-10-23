<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, Trash2 } from 'lucide-vue-next'
import { describeCountdown, parseDateOnly } from '@shared/calendar'
import type { Countdown } from '@shared/calendar'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

const props = defineProps<{ countdown: Countdown }>()

const emit = defineEmits<{
  edit: []
  remove: []
}>()

const description = computed(() => describeCountdown(props.countdown.date))

/** 三态文案：未来、今天、已过去 */
const statusLabel = computed(() => {
  const info = description.value
  if (!info) return '日期无效'
  if (info.status === 'today') return '就是今天'
  const prefix = info.status === 'future' ? '还有' : '已过去'
  return `${prefix} ${info.days} 天`
})

const isPast = computed(() => description.value?.status === 'past')

/** 目标日期文案：合法日期显示中文年月日，非法时原样展示 */
const dateLabel = computed(() => {
  const date = parseDateOnly(props.countdown.date)
  if (!date) return props.countdown.date
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  return `${year} 年 ${month} 月 ${date.getDate()} 日`
})
</script>

<template>
  <article
    class="bg-card flex flex-col gap-2 rounded-xl border p-3 transition-colors"
    :class="{ 'opacity-60': isPast }"
  >
    <header class="flex items-start justify-between gap-2">
      <h3 class="min-w-0 flex-1 truncate text-sm font-medium">
        {{ countdown.title }}
      </h3>
      <span
        class="shrink-0 text-sm"
        :class="isPast ? 'text-muted-foreground' : 'text-primary font-semibold'"
      >
        {{ statusLabel }}
      </span>
    </header>

    <p class="text-muted-foreground text-xs">{{ dateLabel }}</p>

    <footer class="mt-auto flex items-center justify-end gap-0.5 pt-1">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="编辑倒计日"
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
            aria-label="删除倒计日"
            class="text-destructive hover:text-destructive"
            @click="emit('remove')"
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>删除</TooltipContent>
      </Tooltip>
    </footer>
  </article>
</template>
