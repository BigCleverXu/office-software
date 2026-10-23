<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { COUNTDOWN_TITLE_MAX_LENGTH, isDateOnly } from '@shared/calendar'
import type { Countdown, CountdownDraft } from '@shared/calendar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  countdown?: Countdown | null
  defaultDate?: string
}>()

const emit = defineEmits<{ submit: [draft: CountdownDraft] }>()

const title = ref('')
const date = ref('')

const isEdit = computed(() => Boolean(props.countdown))

const titleError = computed(() =>
  title.value.trim() === '' ? '请输入标题' : ''
)

const dateError = computed(() =>
  isDateOnly(date.value) ? '' : '请选择有效日期'
)

const canSave = computed(
  () => titleError.value === '' && dateError.value === ''
)

/** 按本地时区格式化为 YYYY-MM-DD */
function formatDateOnly(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 新建时的默认日期：优先使用选中日期，否则使用今天 */
function resolveDefaultDate(): string {
  const value = props.defaultDate
  if (value && isDateOnly(value)) return value
  return formatDateOnly(new Date())
}

// 打开弹窗时用编辑对象回填，新建时使用默认日期
watch(
  [open, () => props.countdown, () => props.defaultDate],
  ([isOpen]) => {
    if (!isOpen) return
    title.value = props.countdown?.title ?? ''
    date.value = props.countdown?.date ?? resolveDefaultDate()
  },
  { immediate: true }
)

const handleSubmit = (): void => {
  if (!canSave.value) return
  emit('submit', {
    title: title.value.trim(),
    date: date.value
  })
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {{ isEdit ? '编辑倒计日' : '新建倒计日' }}
        </DialogTitle>
        <DialogDescription>
          设置一个目标日期，随时查看还剩多少天。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-1.5">
          <Label for="countdown-title">标题</Label>
          <Input
            id="countdown-title"
            v-model="title"
            :maxlength="COUNTDOWN_TITLE_MAX_LENGTH"
            placeholder="例如：国庆假期"
            :aria-invalid="Boolean(titleError)"
          />
          <p v-if="titleError" class="text-destructive text-xs">
            {{ titleError }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="countdown-date">目标日期</Label>
          <Input
            id="countdown-date"
            v-model="date"
            type="date"
            :aria-invalid="Boolean(dateError)"
          />
          <p v-if="dateError" class="text-destructive text-xs">
            {{ dateError }}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="!canSave" @click="handleSubmit">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
