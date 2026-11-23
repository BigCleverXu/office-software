<script setup lang="ts">
import { computed } from 'vue'
import { LONG_PRESS_MS } from '@shared/water'
import { useLongPress } from '@/composables/useLongPress'

const props = defineProps<{
  /** 已填充比例（0–1） */
  level: number
  /** 是否正在注水 */
  pouring: boolean
  /** 是否开启减少动效偏好 */
  reduced: boolean
  /** 是否禁用长按 */
  disabled: boolean
  /** 当前单杯容量（毫升） */
  cupMl: number
}>()

const emit = defineEmits<{
  (e: 'pour'): void
}>()

const { holding, start, cancel } = useLongPress(() => {
  emit('pour')
}, LONG_PRESS_MS)

/** 水位高度百分比，越界值夹到 0–1 */
const fillHeight = computed(() => {
  const clamped = Math.min(1, Math.max(0, props.level))
  return `${clamped * 100}%`
})

/** 波纹与气泡：有水位且未开启减少动效时才渲染 */
const showMotion = computed(() => props.level > 0 && !props.reduced)

/** 满杯或注水时的呼吸光晕 */
const showHalo = computed(
  () => !props.reduced && (props.pouring || props.level >= 1)
)

/** 复位到 0 时禁用过渡，避免从满杯回落的空动画 */
const instant = computed(() => props.pouring && props.level <= 0)

const handlePointerDown = (event: PointerEvent): void => {
  if (props.disabled) {
    return
  }
  event.preventDefault()
  start()
}

const handlePointerEnd = (): void => {
  cancel()
}

const handleContextMenu = (event: MouseEvent): void => {
  event.preventDefault()
  cancel()
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (props.disabled) {
    return
  }
  if (event.key !== ' ' && event.key !== 'Enter') {
    return
  }
  event.preventDefault()
  if (event.repeat) {
    return
  }
  start()
}

const handleKeyup = (event: KeyboardEvent): void => {
  if (event.key !== ' ' && event.key !== 'Enter') {
    return
  }
  cancel()
}

const handleBlur = (): void => {
  cancel()
}
</script>

<template>
  <div class="flex min-w-0 flex-col items-center gap-2">
    <div
      class="water-glass"
      role="button"
      tabindex="0"
      :aria-disabled="disabled ? 'true' : undefined"
      :aria-label="`长按水杯记录一杯 ${cupMl} 毫升水`"
      @pointerdown="handlePointerDown"
      @pointerup="handlePointerEnd"
      @pointerleave="handlePointerEnd"
      @pointercancel="handlePointerEnd"
      @contextmenu="handleContextMenu"
      @keydown="handleKeydown"
      @keyup="handleKeyup"
      @blur="handleBlur"
    >
      <span v-if="showHalo" class="water-glass-halo" aria-hidden="true"></span>

      <svg class="water-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="water-ring-track" cx="50" cy="50" r="46"></circle>
        <circle
          class="water-ring-progress"
          :class="{ 'is-holding': holding }"
          cx="50"
          cy="50"
          r="46"
        ></circle>
      </svg>

      <div class="water-glass-shell">
        <div class="water-glass-inner" aria-hidden="true">
          <div
            class="water-fill"
            :class="{ 'water-fill-instant': instant }"
            :style="{ height: fillHeight }"
          >
            <div v-if="showMotion" class="water-surface">
              <span class="water-wave"></span>
              <span class="water-wave"></span>
            </div>
          </div>

          <template v-if="showMotion">
            <span v-for="bubble in 5" :key="bubble" class="water-bubble"></span>
          </template>
        </div>
      </div>
    </div>

    <p class="text-muted-foreground text-xs">长按或按住空格 0.5 秒记录一杯</p>
    <p class="text-xs font-medium tabular-nums">{{ cupMl }} ml</p>
  </div>
</template>
