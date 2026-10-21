<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NOTE_COLORS } from '@shared/notes'
import type { Note, NoteColor, NoteDraft } from '@shared/notes'
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
import { Switch } from '@/components/ui/switch'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{ note?: Note | null }>()

const emit = defineEmits<{ submit: [draft: NoteDraft] }>()

const title = ref('')
const content = ref('')
const color = ref<NoteColor>('default')
const pinned = ref(false)

const isEdit = computed(() => Boolean(props.note))

const canSave = computed(
  () => title.value.trim() !== '' || content.value.trim() !== ''
)

/** 颜色按钮对应的圆点样式与无障碍文案（显式映射） */
const COLOR_DOT_STYLES: Record<NoteColor, string> = {
  default: 'bg-muted-foreground/40',
  yellow: 'bg-yellow-400',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  pink: 'bg-pink-400'
}

const COLOR_LABELS: Record<NoteColor, string> = {
  default: '默认色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  pink: '粉色'
}

const colorOptions = NOTE_COLORS.map((value) => ({
  value,
  label: COLOR_LABELS[value],
  dotClass: COLOR_DOT_STYLES[value]
}))

watch(
  [open, () => props.note],
  ([isOpen]) => {
    if (!isOpen) return
    title.value = props.note?.title ?? ''
    content.value = props.note?.content ?? ''
    color.value = props.note?.color ?? 'default'
    pinned.value = props.note?.pinned ?? false
  },
  { immediate: true }
)

const handleSubmit = (): void => {
  if (!canSave.value) return
  emit('submit', {
    title: title.value.trim(),
    content: content.value,
    color: color.value,
    pinned: pinned.value
  })
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? '编辑便签' : '新建便签' }}</DialogTitle>
        <DialogDescription>
          随手记下想法，支持置顶与按颜色区分。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-2">
          <Label for="note-title">标题</Label>
          <Input
            id="note-title"
            v-model="title"
            placeholder="给便签起个标题（可留空）"
            maxlength="100"
          />
        </div>

        <div class="flex flex-col gap-2">
          <Label for="note-content">正文</Label>
          <textarea
            id="note-content"
            v-model="content"
            rows="6"
            placeholder="写点什么…"
            class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-muted-foreground min-h-28 w-full min-w-0 resize-y rounded-lg border bg-transparent px-2.5 py-2 text-base outline-none transition-colors focus-visible:ring-3 md:text-sm"
          />
        </div>

        <div class="flex flex-col gap-2">
          <Label>颜色</Label>
          <div
            class="flex items-center gap-2"
            role="group"
            aria-label="便签颜色"
          >
            <button
              v-for="option in colorOptions"
              :key="option.value"
              type="button"
              class="size-7 rounded-full border border-foreground/10 transition-transform"
              :class="[
                option.dotClass,
                {
                  'ring-2 ring-foreground/40': color === option.value
                }
              ]"
              :aria-label="option.label"
              :aria-pressed="color === option.value"
              @click="color = option.value"
            />
          </div>
        </div>

        <div class="flex items-center justify-between">
          <Label for="note-pinned" class="cursor-pointer">置顶便签</Label>
          <Switch id="note-pinned" v-model="pinned" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="!canSave" @click="handleSubmit">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
