// 长按控制器：纯逻辑实现，不依赖 DOM，便于单元测试

export interface LongPressControllerOptions {
  /** 触发长按所需的毫秒数 */
  thresholdMs: number
  /** 达到阈值后的回调 */
  onTrigger: () => void
  /** 按住状态变化时回调，true 为开始按住，false 为结束 */
  onStateChange?: (holding: boolean) => void
}

export interface LongPressController {
  /** 开始按住；已在按住中时忽略，避免重复计时 */
  start: () => void
  /** 取消按住并复位状态 */
  cancel: () => void
  /** 销毁控制器，等同取消 */
  dispose: () => void
}

/**
 * 创建长按控制器：start 后经过 thresholdMs 触发一次 onTrigger。
 * 计时器句柄使用 ReturnType<typeof setTimeout>，兼容浏览器与 Node 环境。
 */
export function createLongPressController(
  options: LongPressControllerOptions
): LongPressController {
  let timer: ReturnType<typeof setTimeout> | null = null
  let holding = false

  /** 清空未触发的计时器 */
  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 仅在状态真正变化时通知外部 */
  const updateHolding = (next: boolean): void => {
    if (holding === next) {
      return
    }
    holding = next
    options.onStateChange?.(next)
  }

  /** 取消按住：清计时器并复位 */
  const cancel = (): void => {
    clearTimer()
    updateHolding(false)
  }

  const start = (): void => {
    if (holding) {
      return
    }
    updateHolding(true)
    timer = setTimeout(() => {
      // 先清空计时器与状态，再触发回调，保证回调内可重新 start
      timer = null
      updateHolding(false)
      options.onTrigger()
    }, options.thresholdMs)
  }

  return {
    start,
    cancel,
    dispose: cancel
  }
}
