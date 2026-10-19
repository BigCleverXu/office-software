<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { LineChart, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import type { MarketSnapshot, Quote, WatchItem } from '@shared/market'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import {
  formatAmount,
  formatPercent,
  formatPrice,
  formatSigned,
  statusLabel,
  statusToneClass,
  toneClass
} from '@/lib/market-format'

const props = defineProps<{
  quotes: Quote[]
  watchlist: WatchItem[]
  snapshot: MarketSnapshot
}>()

const emit = defineEmits<{
  add: []
  remove: [symbol: string]
  retry: []
}>()

/** 表格中中性数值单元与涨跌数值单元的公共样式 */
const MUTED_CELL = 'text-muted-foreground px-2 py-2 text-right tabular-nums'
const TONE_CELL = 'px-2 py-2 text-right tabular-nums'

interface Row {
  item: WatchItem
  missing: boolean
  name: string
  code: string
  price: string
  change: string
  changePercent: string
  open: string
  high: string
  low: string
  amount: string
  time: string
  tone: string
}

const buildRow = (item: WatchItem, quote: Quote | null): Row => {
  const missing = quote === null || quote.missing
  const source = missing ? null : quote
  return {
    item,
    missing,
    name: item.name || quote?.name || item.code,
    code: item.code,
    price: formatPrice(source?.price ?? null),
    change: formatSigned(source?.change ?? null),
    changePercent: formatPercent(source?.changePercent ?? null),
    open: formatPrice(source?.open ?? null),
    high: formatPrice(source?.high ?? null),
    low: formatPrice(source?.low ?? null),
    amount: formatAmount(source?.amount ?? null),
    time: source?.quoteTime ?? '--',
    tone: toneClass(source?.change ?? null)
  }
}

const rows = computed<Row[]>(() =>
  props.watchlist.map((item, index) =>
    buildRow(item, props.quotes[index] ?? null)
  )
)

const statusText = computed(() => statusLabel(props.snapshot))

const statusTone = computed(() => statusToneClass(props.snapshot))

const highlighted = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null

/** 高亮指定行 2 秒，用于重复添加时的提示 */
const highlight = (symbol: string): void => {
  highlighted.value = symbol
  if (highlightTimer !== null) {
    clearTimeout(highlightTimer)
  }
  highlightTimer = setTimeout(() => {
    highlighted.value = null
    highlightTimer = null
  }, 2000)
}

onUnmounted(() => {
  if (highlightTimer !== null) {
    clearTimeout(highlightTimer)
  }
})

defineExpose({ highlight })
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold">自选股</h2>
      <div class="flex items-center gap-2">
        <span class="text-xs" :class="statusTone">{{ statusText }}</span>
        <Button
          v-if="snapshot.status === 'load-failed'"
          variant="outline"
          size="sm"
          @click="emit('retry')"
        >
          <RefreshCw />
          重试
        </Button>
        <Button size="sm" @click="emit('add')">
          <Plus />
          添加自选股
        </Button>
      </div>
    </div>

    <div
      v-if="watchlist.length === 0"
      class="text-muted-foreground flex flex-col items-center justify-center gap-3 py-16"
    >
      <LineChart class="size-10 opacity-40" />
      <p class="text-sm">还没有自选股，添加后即可随时查看行情</p>
      <Button @click="emit('add')">
        <Plus />
        添加自选股
      </Button>
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr class="text-muted-foreground border-b text-xs">
            <th class="px-2 py-2 font-medium">名称</th>
            <th class="px-2 py-2 font-medium">代码</th>
            <th class="px-2 py-2 text-right font-medium">现价</th>
            <th class="px-2 py-2 text-right font-medium">涨跌额</th>
            <th class="px-2 py-2 text-right font-medium">涨跌幅</th>
            <th class="px-2 py-2 text-right font-medium">今开</th>
            <th class="px-2 py-2 text-right font-medium">最高</th>
            <th class="px-2 py-2 text-right font-medium">最低</th>
            <th class="px-2 py-2 text-right font-medium">成交额</th>
            <th class="px-2 py-2 text-right font-medium">更新时间</th>
            <th class="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.item.symbol"
            class="border-b transition-colors last:border-b-0"
            :class="{ 'bg-accent/60': highlighted === row.item.symbol }"
          >
            <td class="px-2 py-2">
              <div class="flex flex-col">
                <span class="font-medium">{{ row.name }}</span>
                <span v-if="row.missing" class="text-muted-foreground text-xs">
                  无数据
                </span>
              </div>
            </td>
            <td class="text-muted-foreground px-2 py-2 tabular-nums">
              {{ row.code }}
            </td>
            <td :class="[TONE_CELL, row.tone]">{{ row.price }}</td>
            <td :class="[TONE_CELL, row.tone]">{{ row.change }}</td>
            <td :class="[TONE_CELL, row.tone]">{{ row.changePercent }}</td>
            <td :class="MUTED_CELL">{{ row.open }}</td>
            <td :class="MUTED_CELL">{{ row.high }}</td>
            <td :class="MUTED_CELL">{{ row.low }}</td>
            <td :class="MUTED_CELL">{{ row.amount }}</td>
            <td :class="MUTED_CELL">{{ row.time }}</td>
            <td class="px-2 py-2 text-right">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除自选股"
                    class="text-destructive hover:text-destructive"
                    @click="emit('remove', row.item.symbol)"
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>删除</TooltipContent>
              </Tooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
