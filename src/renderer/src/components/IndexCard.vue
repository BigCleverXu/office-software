<script setup lang="ts">
import { computed } from 'vue'
import type { Quote } from '@shared/market'
import { Card, CardContent } from '@/components/ui/card'
import {
  formatPercent,
  formatPrice,
  formatSigned,
  toneClass
} from '@/lib/market-format'

const props = defineProps<{
  quote: Quote
  updatedAtLabel?: string | null
}>()

/** 缺失数据统一按空值处理，避免着色与展示旧值 */
const value = (raw: number | null): number | null =>
  props.quote.missing ? null : raw

const name = computed(() => props.quote.name)

const priceText = computed(() => formatPrice(value(props.quote.price)))

const changeText = computed(() => formatSigned(value(props.quote.change)))

const changePercentText = computed(() =>
  formatPercent(value(props.quote.changePercent))
)

const tone = computed(() => toneClass(value(props.quote.change)))

const updatedText = computed(() => props.updatedAtLabel ?? '--')
</script>

<template>
  <Card class="gap-0 py-0">
    <CardContent class="flex flex-col gap-1.5 px-4 py-3">
      <span class="text-muted-foreground text-xs">{{ name }}</span>
      <span class="font-mono text-xl font-semibold tabular-nums" :class="tone">
        {{ priceText }}
      </span>
      <div class="flex items-center gap-3 text-xs">
        <span class="font-mono tabular-nums" :class="tone">
          {{ changeText }}
        </span>
        <span class="font-mono tabular-nums" :class="tone">
          {{ changePercentText }}
        </span>
      </div>
      <span class="text-muted-foreground text-xs">更新 {{ updatedText }}</span>
    </CardContent>
  </Card>
</template>
