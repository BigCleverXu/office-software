<script setup lang="ts">
import { computed } from 'vue'
import { formatMoney, formatPercent, formatSignedMoney } from '@shared/market'
import type { MarketRegion, PositionSummary } from '@shared/market'
import { toneClass } from '@/lib/market-format'

const props = defineProps<{
  summary: PositionSummary
  region: MarketRegion
}>()

interface Metric {
  label: string
  value: string
  tone: string
}

const title = computed(() =>
  props.region === 'us' ? '美股持仓概览' : 'A 股持仓概览'
)

const metrics = computed<Metric[]>(() => [
  {
    label: '今日盈亏',
    value: formatSignedMoney(props.summary.todayPnl),
    tone: toneClass(props.summary.todayPnl)
  },
  {
    label: '累计盈亏',
    value: formatSignedMoney(props.summary.totalPnl),
    tone: toneClass(props.summary.totalPnl)
  },
  {
    label: '持仓市值',
    value: formatMoney(props.summary.marketValue),
    tone: 'text-foreground'
  },
  {
    label: '持仓成本',
    value: formatMoney(props.summary.totalCost),
    tone: 'text-foreground'
  },
  {
    label: '累计收益率',
    value: formatPercent(props.summary.totalPnlPercent),
    tone: toneClass(props.summary.totalPnlPercent)
  }
])
</script>

<template>
  <div class="bg-card shadow-soft rounded-xl border border-border/70 px-4 py-3">
    <div class="flex items-center justify-between gap-2">
      <span class="text-muted-foreground text-xs">{{ title }}</span>
      <span v-if="summary.heldCount > 0" class="text-muted-foreground text-xs">
        {{ summary.heldCount }} 只持仓
      </span>
    </div>

    <p
      v-if="summary.heldCount === 0"
      class="text-muted-foreground py-2 text-xs"
    >
      填写持仓数量与成本后自动统计盈亏
    </p>

    <div
      v-else
      class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      <div
        v-for="metric in metrics"
        :key="metric.label"
        class="flex flex-col gap-0.5"
      >
        <span class="text-muted-foreground text-xs">{{ metric.label }}</span>
        <span
          class="font-mono text-sm font-semibold tabular-nums"
          :class="metric.tone"
        >
          {{ metric.value }}
        </span>
      </div>
    </div>
  </div>
</template>
