<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  isValidPosition,
  normalizeCode,
  normalizeUsSymbol
} from '@shared/market'
import type {
  AddWatchResult,
  MarketPosition,
  MarketRegion
} from '@shared/market'
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
  region: MarketRegion
  onAdd: (code: string, position: MarketPosition) => Promise<AddWatchResult>
}>()

type AddWatchFailure = Extract<AddWatchResult, { ok: false }>['reason']

/** 持仓数值非法时的提示文案，与编辑持仓弹窗保持一致 */
const INVALID_POSITION_MESSAGE =
  '持仓数量需为 0 到 1000000000 的数字，成本价需为 0 到 1000000 的数字'

/** 非代码格式错误的失败原因文案，两个市场共用 */
const REASON_MESSAGES: Record<
  Exclude<AddWatchFailure, 'invalid-code'>,
  string
> = {
  duplicate: '该股票已在自选股中',
  'not-found': '未找到该股票，请检查代码',
  unavailable: '暂时无法获取行情，请稍后重试'
}

/** 代码格式错误的提示文案，按市场区分 */
const INVALID_CODE_MESSAGES: Record<MarketRegion, string> = {
  cn: '请输入 6 位股票代码',
  us: '请输入有效的美股代码'
}

interface RegionCopy {
  title: string
  description: string
  placeholder: string
  inputmode: 'numeric' | 'text'
  maxlength: number
}

const isUs = computed<boolean>(() => props.region === 'us')

/** 弹窗文案与输入约束，随市场切换 */
const copy = computed<RegionCopy>(() =>
  isUs.value
    ? {
        title: '添加美股',
        description: '输入美股代码（ticker），例如 AAPL、TSLA、BRK.B。',
        placeholder: '例如：AAPL',
        inputmode: 'text',
        maxlength: 10
      }
    : {
        title: '添加自选股',
        description:
          '输入 6 位股票代码，支持沪市（6/9 开头）与深市（0/3 开头）。',
        placeholder: '例如：600519',
        inputmode: 'numeric',
        maxlength: 6
      }
)

const code = ref('')
const sharesText = ref('')
const costText = ref('')
const error = ref('')
const submitting = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  code.value = ''
  sharesText.value = ''
  costText.value = ''
  error.value = ''
  submitting.value = false
})

/** 美股代码自动转大写，保持与 normalizeUsSymbol 一致 */
watch(code, (value) => {
  if (!isUs.value) return
  const upper = value.toUpperCase()
  if (upper !== value) {
    code.value = upper
  }
})

const clearError = (): void => {
  error.value = ''
}

const reasonMessage = (reason: AddWatchFailure): string =>
  reason === 'invalid-code'
    ? INVALID_CODE_MESSAGES[props.region]
    : REASON_MESSAGES[reason]

const isValidCode = (): boolean =>
  isUs.value
    ? normalizeUsSymbol(code.value) !== null
    : normalizeCode(code.value) !== null

/** 解析可选的持仓输入：留空按 0 处理，非法或越界返回 null */
const parsePosition = (): MarketPosition | null => {
  const shares = sharesText.value.trim() === '' ? 0 : Number(sharesText.value)
  const cost = costText.value.trim() === '' ? 0 : Number(costText.value)
  const position: MarketPosition = { shares, cost }
  return isValidPosition(position) ? position : null
}

const handleSubmit = async (): Promise<void> => {
  error.value = ''
  if (!isValidCode()) {
    error.value = INVALID_CODE_MESSAGES[props.region]
    return
  }
  const position = parsePosition()
  if (!position) {
    error.value = INVALID_POSITION_MESSAGE
    return
  }
  submitting.value = true
  try {
    const result = await props.onAdd(code.value.trim(), position)
    if (result.ok) {
      open.value = false
      return
    }
    error.value = reasonMessage(result.reason)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ copy.title }}</DialogTitle>
        <DialogDescription>{{ copy.description }}</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-2 py-1">
        <Input
          v-model="code"
          type="text"
          :inputmode="copy.inputmode"
          :maxlength="copy.maxlength"
          :placeholder="copy.placeholder"
          @input="clearError"
          @keydown.enter="handleSubmit"
        />
        <div class="grid grid-cols-2 gap-2">
          <Input
            v-model="sharesText"
            type="text"
            inputmode="decimal"
            placeholder="持仓数量（选填）"
            @input="clearError"
            @keydown.enter="handleSubmit"
          />
          <Input
            v-model="costText"
            type="text"
            inputmode="decimal"
            placeholder="成本价（选填）"
            @input="clearError"
            @keydown.enter="handleSubmit"
          />
        </div>
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
