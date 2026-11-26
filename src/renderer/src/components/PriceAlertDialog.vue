<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { formatPriceAlert, parsePriceAlertDraft } from '@shared/market'
import type {
  PriceAlert,
  PriceAlertDraft,
  PriceAlertKind,
  WatchItem
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  item: WatchItem | null
  alerts: PriceAlert[]
  onAdd: (draft: PriceAlertDraft) => Promise<boolean>
  onRemove: (id: string) => Promise<boolean>
  onToggle: (id: string, enabled: boolean) => Promise<boolean>
}>()

/** 提醒类型选项，顺序即下拉展示顺序 */
const KIND_OPTIONS: { value: PriceAlertKind; label: string }[] = [
  { value: 'above', label: '高于等于' },
  { value: 'below', label: '低于等于' },
  { value: 'range', label: '价格区间' }
]

/** 价格输入非法时的提示文案 */
const INVALID_PRICE_MESSAGE =
  '请输入合法的价格：单值需大于 0，区间下限需小于上限，且不超过 1000000'

const kind = ref<PriceAlertKind>('above')
const thresholdText = ref('')
const rangeLowText = ref('')
const rangeHighText = ref('')
const error = ref('')
const submitting = ref(false)

const displayName = computed(() => {
  const item = props.item
  return item ? `${item.name || item.code}（${item.code}）` : ''
})

const title = computed(() =>
  displayName.value ? `价格提醒 · ${displayName.value}` : '价格提醒'
)

const description = '到达或突破设定价格时弹出系统通知；触发后提醒会自动停用。'

const resetForm = (): void => {
  kind.value = 'above'
  thresholdText.value = ''
  rangeLowText.value = ''
  rangeHighText.value = ''
  error.value = ''
  submitting.value = false
}

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm()
  }
})

const clearError = (): void => {
  error.value = ''
}

/** 本地时间 'HH:mm'，用于展示触发时刻 */
const formatTriggerTime = (ms: number): string => {
  const date = new Date(ms)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 单条提醒状态文案 */
const statusText = (alert: PriceAlert): string => {
  if (alert.lastTriggeredAt !== null) {
    return `已于 ${formatTriggerTime(alert.lastTriggeredAt)} 触发`
  }
  return alert.enabled ? '监控中' : '已停用'
}

/** 空字符串转 null，其余转数字（非法值交由 parsePriceAlertDraft 拦截） */
const toNumber = (text: string): number | null => {
  const trimmed = text.trim()
  return trimmed === '' ? null : Number(trimmed)
}

const handleSubmit = async (): Promise<void> => {
  const item = props.item
  if (!item) {
    return
  }
  error.value = ''
  const isRange = kind.value === 'range'
  const draft: PriceAlertDraft = {
    symbol: item.symbol,
    name: item.name,
    kind: kind.value,
    threshold: isRange ? null : toNumber(thresholdText.value),
    rangeLow: isRange ? toNumber(rangeLowText.value) : null,
    rangeHigh: isRange ? toNumber(rangeHighText.value) : null
  }
  const parsed = parsePriceAlertDraft(draft)
  if (!parsed) {
    error.value = INVALID_PRICE_MESSAGE
    return
  }
  submitting.value = true
  try {
    const saved = await props.onAdd(parsed)
    if (saved) {
      resetForm()
    }
  } finally {
    submitting.value = false
  }
}

const handleToggle = async (
  alert: PriceAlert,
  enabled: boolean
): Promise<void> => {
  await props.onToggle(alert.id, enabled)
}

const handleRemove = async (id: string): Promise<void> => {
  await props.onRemove(id)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <template v-if="item">
        <div class="flex max-h-56 flex-col gap-2 overflow-y-auto py-1">
          <div
            v-if="alerts.length === 0"
            class="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm"
          >
            暂无提醒
          </div>
          <div
            v-for="alert in alerts"
            :key="alert.id"
            class="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
          >
            <div class="flex flex-col">
              <span class="text-sm font-medium tabular-nums">
                {{ formatPriceAlert(alert) }}
              </span>
              <span class="text-muted-foreground text-xs">
                {{ statusText(alert) }}
              </span>
            </div>
            <div class="flex items-center gap-1">
              <Switch
                :model-value="alert.enabled"
                aria-label="启用价格提醒"
                @update:model-value="handleToggle(alert, $event)"
              />
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除提醒"
                    class="text-destructive hover:text-destructive"
                    @click="handleRemove(alert.id)"
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>删除提醒</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2 py-1">
          <span class="text-muted-foreground text-xs">提醒类型</span>
          <Select v-model="kind">
            <SelectTrigger class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in KIND_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <div v-if="kind === 'range'" class="grid grid-cols-2 gap-2">
            <Input
              v-model="rangeLowText"
              type="text"
              inputmode="decimal"
              placeholder="价格下限"
              @input="clearError"
              @keydown.enter="handleSubmit"
            />
            <Input
              v-model="rangeHighText"
              type="text"
              inputmode="decimal"
              placeholder="价格上限"
              @input="clearError"
              @keydown.enter="handleSubmit"
            />
          </div>
          <Input
            v-else
            v-model="thresholdText"
            type="text"
            inputmode="decimal"
            placeholder="触发价格"
            @input="clearError"
            @keydown.enter="handleSubmit"
          />
          <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
        </div>
      </template>

      <DialogFooter>
        <Button variant="outline" @click="open = false">关闭</Button>
        <Button v-if="item" :disabled="submitting" @click="handleSubmit">
          {{ submitting ? '添加中…' : '添加提醒' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
