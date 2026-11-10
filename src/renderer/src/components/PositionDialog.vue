<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isValidPosition } from '@shared/market'
import type { MarketPosition, WatchItem } from '@shared/market'
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
  item: WatchItem | null
  onSave: (position: MarketPosition) => Promise<boolean>
}>()

/** 与添加弹窗保持一致的持仓校验文案 */
const INVALID_POSITION_MESSAGE =
  '持仓数量需为 0 到 1000000000 的数字，成本价需为 0 到 1000000 的数字'

const sharesText = ref('')
const costText = ref('')
const error = ref('')
const submitting = ref(false)

const displayName = computed(() => {
  const item = props.item
  return item ? `${item.name || item.code}（${item.code}）` : ''
})

const title = computed(() =>
  displayName.value ? `编辑持仓 · ${displayName.value}` : '编辑持仓'
)

const description = computed(() =>
  props.item
    ? `设置「${displayName.value}」的持仓数量与每股成本，留空或 0 表示不持仓。`
    : '设置持仓数量与每股成本，留空或 0 表示不持仓。'
)

const clearError = (): void => {
  error.value = ''
}

/** 打开时用当前值预填，0 视为未填写 */
const fillFromItem = (): void => {
  const item = props.item
  sharesText.value = item && item.shares > 0 ? String(item.shares) : ''
  costText.value = item && item.cost > 0 ? String(item.cost) : ''
  error.value = ''
  submitting.value = false
}

watch(open, (isOpen) => {
  if (isOpen) {
    fillFromItem()
  }
})

/** 解析输入：留空按 0 处理，非法或越界返回 null */
const parsePosition = (): MarketPosition | null => {
  const shares = sharesText.value.trim() === '' ? 0 : Number(sharesText.value)
  const cost = costText.value.trim() === '' ? 0 : Number(costText.value)
  const position: MarketPosition = { shares, cost }
  return isValidPosition(position) ? position : null
}

const handleSave = async (): Promise<void> => {
  error.value = ''
  const position = parsePosition()
  if (!position) {
    error.value = INVALID_POSITION_MESSAGE
    return
  }
  submitting.value = true
  try {
    const saved = await props.onSave(position)
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
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-2 py-1">
        <div class="flex flex-col gap-1">
          <span class="text-muted-foreground text-xs">持仓数量（股）</span>
          <Input
            v-model="sharesText"
            type="text"
            inputmode="decimal"
            placeholder="留空或 0 表示只关注不持仓"
            @input="clearError"
            @keydown.enter="handleSave"
          />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-muted-foreground text-xs">每股成本</span>
          <Input
            v-model="costText"
            type="text"
            inputmode="decimal"
            placeholder="留空或 0 表示未填写"
            @input="clearError"
            @keydown.enter="handleSave"
          />
        </div>
        <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="submitting" @click="handleSave">
          {{ submitting ? '保存中…' : '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
