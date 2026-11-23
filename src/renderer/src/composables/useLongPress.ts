import { onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import { LONG_PRESS_MS } from '@shared/water'
import { createLongPressController } from '@/lib/long-press'

export interface UseLongPress {
  /** 是否处于按住状态，用于驱动进度指示 */
  holding: Ref<boolean>
  start: () => void
  cancel: () => void
  dispose: () => void
}

/**
 * 组件内使用的长按封装：把纯逻辑控制器与 holding 状态绑定，
 * 组件卸载时自动释放计时器。
 */
export function useLongPress(
  onTrigger: () => void,
  thresholdMs: number = LONG_PRESS_MS
): UseLongPress {
  const holding = ref(false)

  const controller = createLongPressController({
    thresholdMs,
    onTrigger,
    onStateChange: (value) => {
      holding.value = value
    }
  })

  onUnmounted(() => {
    controller.dispose()
  })

  return {
    holding,
    start: () => controller.start(),
    cancel: () => controller.cancel(),
    dispose: () => controller.dispose()
  }
}
