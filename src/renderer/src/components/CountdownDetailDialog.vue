<script setup lang="ts">
import { computed } from 'vue'
import { describeCountdown, parseDateOnly } from '@shared/calendar'
import type { Countdown } from '@shared/calendar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{ countdown?: Countdown | null }>()

const emit = defineEmits<{
  edit: []
  remove: []
}>()

const description = computed(() =>
  props.countdown ? describeCountdown(props.countdown.date) : null
)

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
  const value = props.countdown?.date
  if (!value) return ''
  const date = parseDateOnly(value)
  if (!date) return value
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  return `${year} 年 ${month} 月 ${date.getDate()} 日`
})

/** 编辑：通知父组件，并关闭详情弹窗 */
const handleEdit = (): void => {
  emit('edit')
  open.value = false
}

/** 删除：交给父组件确认，确认后由父组件关闭详情 */
const handleRemove = (): void => {
  emit('remove')
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="break-words">
          {{ countdown?.title ?? '倒计日详情' }}
        </DialogTitle>
        <DialogDescription>
          查看倒计日的目标日期与剩余天数。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col items-center gap-1 py-4">
        <p
          class="text-2xl font-semibold"
          :class="isPast ? 'text-muted-foreground' : 'text-primary'"
        >
          {{ statusLabel }}
        </p>
        <p class="text-muted-foreground text-xs">目标日期：{{ dateLabel }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleEdit">编辑</Button>
        <Button variant="destructive" @click="handleRemove">删除</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
