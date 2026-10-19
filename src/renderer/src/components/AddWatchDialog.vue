<script setup lang="ts">
import { ref, watch } from 'vue'
import { normalizeCode } from '@shared/market'
import type { AddWatchResult } from '@shared/market'
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

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  onAdd: (code: string) => Promise<AddWatchResult>
}>()

/** 添加失败原因对应的内联提示文案 */
const REASON_MESSAGES: Record<
  'invalid-code' | 'duplicate' | 'not-found' | 'unavailable',
  string
> = {
  'invalid-code': '请输入 6 位股票代码',
  duplicate: '该股票已在自选股中',
  'not-found': '未找到该股票，请检查代码',
  unavailable: '暂时无法获取行情，请稍后重试'
}

const code = ref('')
const error = ref('')
const submitting = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  code.value = ''
  error.value = ''
  submitting.value = false
})

const clearError = (): void => {
  error.value = ''
}

const handleSubmit = async (): Promise<void> => {
  error.value = ''
  if (normalizeCode(code.value) === null) {
    error.value = '请输入 6 位股票代码'
    return
  }
  submitting.value = true
  try {
    const result = await props.onAdd(code.value.trim())
    if (result.ok) {
      open.value = false
      return
    }
    error.value = REASON_MESSAGES[result.reason]
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>添加自选股</DialogTitle>
        <DialogDescription>
          输入 6 位股票代码，支持沪市（6/9 开头）与深市（0/3 开头）。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-2 py-1">
        <Input
          v-model="code"
          type="text"
          inputmode="numeric"
          maxlength="6"
          placeholder="例如：600519"
          @input="clearError"
          @keydown.enter="handleSubmit"
        />
        <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="submitting" @click="handleSubmit">
          {{ submitting ? '添加中…' : '添加' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
