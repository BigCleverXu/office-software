<script setup lang="ts">
import type { MarketRegion } from '@shared/market'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  region: MarketRegion
}>()

const emit = defineEmits<{
  'update:region': [region: MarketRegion]
}>()

/** 市场分段选项，顺序即展示顺序 */
const REGION_OPTIONS: readonly {
  value: MarketRegion
  label: string
}[] = [
  { value: 'cn', label: '中国' },
  { value: 'us', label: '美国' }
]

const selectRegion = (region: MarketRegion): void => {
  if (region !== props.region) {
    emit('update:region', region)
  }
}
</script>

<template>
  <div class="bg-muted inline-flex rounded-lg p-1">
    <Button
      v-for="option in REGION_OPTIONS"
      :key="option.value"
      size="sm"
      :variant="region === option.value ? 'secondary' : 'ghost'"
      :class="region === option.value ? 'shadow-sm' : ''"
      :aria-pressed="region === option.value"
      @click="selectRegion(option.value)"
    >
      {{ option.label }}
    </Button>
  </div>
</template>
