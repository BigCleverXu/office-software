<script setup lang="ts">
import { ref, watch } from 'vue'
import { MAX_GOLD_COST, MAX_GOLD_GRAMS } from '@shared/gold'
import type { GoldHolding } from '@shared/gold'
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
  holding: GoldHolding
  onSave: (payload: { grams: number; costPerGram: number }) => Promise<boolean>
}>()

const INVALID_HOLDING_MESSAGE =
  '持有克数需为 0 到 1000000 的数字，成本需为 0 到 1000000 的数字'

const gramsText = ref('')
const costText = ref('')
const error = ref('')
const submitting = ref(false)

const clearError = (): void => {
  error.value = ''
}

/** 打开时用当前值预填，0 视为未填写 */
const fillFromHolding = (): void => {
  const holding = props.holding
  gramsText.value = holding.grams > 0 ? String(holding.grams) : ''
  costText.value = holding.costPerGram > 0 ? String(holding.costPerGram) : ''
  error.value = ''
  submitting.value = false
}

watch(open, (isOpen) => {
  if (isOpen) {
    fillFromHolding()
  }
})

/** 解析输入：留空按 0 处理，非法或越界返回 null */
const parseHolding = (): {
  grams: number
  costPerGram: number
} | null => {
  const grams = gramsText.value.trim() === '' ? 0 : Number(gramsText.value)
  const costPerGram = costText.value.trim() === '' ? 0 : Number(costText.value)
  const valid =
    Number.isFinite(grams) &&
    grams >= 0 &&
    grams <= MAX_GOLD_GRAMS &&
    Number.isFinite(costPerGram) &&
    costPerGram >= 0 &&
    costPerGram <= MAX_GOLD_COST
  return valid ? { grams, costPerGram } : null
}

const handleSave = async (): Promise<void> => {
  error.value = ''
  const payload = parseHolding()
  if (!payload) {
    error.value = INVALID_HOLDING_MESSAGE
    return
  }
  submitting.value = true
  try {
    const saved = await props.onSave(payload)
    if (saved) {
      open.value = false
      return
    }
    error.value = '保存持仓失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>记录持仓</DialogTitle>
        <DialogDescription>
          设置持有克数与每克成本，留空或 0 表示不持仓。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-2 py-1">
        <div class="flex flex-col gap-1">
          <span class="text-muted-foreground text-xs">持有克数（克）</span>
          <Input
            v-model="gramsText"
            type="text"
            inputmode="decimal"
            placeholder="留空或 0 表示不持仓"
            aria-label="持有克数"
            @input="clearError"
            @keydown.enter="handleSave"
          />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-muted-foreground text-xs">每克成本（元）</span>
          <Input
            v-model="costText"
            type="text"
            inputmode="decimal"
            placeholder="留空或 0 表示未填写"
            aria-label="每克成本"
            @input="clearError"
            @keydown.enter="handleSave"
          />
        </div>
        <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          aria-label="取消记录持仓"
          @click="open = false"
        >
          取消
        </Button>
        <Button
          :disabled="submitting"
          aria-label="保存积存金持仓"
          @click="handleSave"
        >
          {{ submitting ? '保存中…' : '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
