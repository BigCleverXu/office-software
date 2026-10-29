import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import {
  createSharedComposable,
  useEventListener,
  useTimeoutFn
} from '@vueuse/core'
import { msUntilNextMidnight, toDateKey } from '@/lib/today'

/**
 * 当天的本地日期（YYYY-MM-DD），跨零点自动更新。
 * 只暴露只读的 computed，避免外部直接改写日期。
 */
function createToday(): ComputedRef<string> {
  const current = ref(toDateKey(new Date()))

  /** 下一次刷新的等待毫秒数，动态更新后由 start() 生效 */
  const interval = ref(0)

  /** 更新日期，并按新的零点间隔重新排下一次定时 */
  function refresh(): void {
    current.value = toDateKey(new Date())
    interval.value = msUntilNextMidnight(new Date())
    start()
  }

  const { start } = useTimeoutFn(() => refresh(), interval, {
    immediate: false
  })

  // 休眠唤醒或切回窗口时可能已跨过零点，立即校准
  useEventListener(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh()
    }
  })

  useEventListener(window, 'focus', () => {
    refresh()
  })

  // 创建时先校准一次
  refresh()

  return computed<string>(() => current.value)
}

/** 托盘常驻应用共享同一天日期，多个组件不会重复起定时器 */
export const useToday = createSharedComposable(createToday)
