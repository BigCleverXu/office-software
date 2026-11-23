<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min: number
    max: number
    step?: number
    disabled?: boolean
    ariaLabel?: string
    class?: HTMLAttributes['class']
  }>(),
  {
    step: 1
  }
)

const emits = defineEmits<{
  'update:modelValue': [value: number]
  commit: []
}>()

/** 已选区间占比，用于绘制轨道渐变；区间非法时回退为 0 */
const percent = computed(() => {
  const span = props.max - props.min
  if (!Number.isFinite(span) || span <= 0) {
    return 0
  }
  const value = Number.isFinite(props.modelValue) ? props.modelValue : props.min
  return Math.min(100, Math.max(0, ((value - props.min) / span) * 100))
})

/** 拖动过程持续同步，用于界面实时预览 */
const onInput = (event: Event): void => {
  const target = event.target as HTMLInputElement
  emits('update:modelValue', Number(target.value))
}

/** 松手 / 松开按键 / 失焦时统一提交一次，供调用方落库 */
const onCommit = (): void => {
  emits('commit')
}
</script>

<template>
  <input
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :value="modelValue"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :class="
      cn(
        'device-slider bg-muted focus-visible:ring-ring/50 focus-visible:ring-offset-background h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none transition-[background] focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        props.class
      )
    "
    :style="{ '--slider-percent': `${percent}%` }"
    @input="onInput"
    @pointerup="onCommit"
    @keyup="onCommit"
    @blur="onCommit"
  />
</template>

<style scoped>
.device-slider {
  background-image: linear-gradient(
    to right,
    var(--primary) 0%,
    var(--primary) var(--slider-percent, 0%),
    transparent var(--slider-percent, 0%),
    transparent 100%
  );
}

.device-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 0.8125rem;
  height: 0.8125rem;
  border-radius: 9999px;
  background-color: var(--primary);
  border: 2px solid var(--background);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 60%, transparent);
  cursor: pointer;
  transition: box-shadow 160ms ease;
}

.device-slider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 45%, transparent);
}

.device-slider:disabled::-webkit-slider-thumb {
  cursor: not-allowed;
}
</style>
