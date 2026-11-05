import { readonly, ref } from 'vue'

export interface ConfirmOptions {
  /** 弹窗标题，默认「确认操作」 */
  title?: string
  /** 弹窗正文，必填 */
  description: string
  /** 确认按钮文案，默认「确定」 */
  confirmText?: string
  /** 取消按钮文案，默认「取消」 */
  cancelText?: string
  /** 是否使用危险操作样式，默认 true */
  destructive?: boolean
}

export interface ConfirmRequest {
  title: string
  description: string
  confirmText: string
  cancelText: string
  destructive: boolean
}

/** 当前待结算的确认请求，无请求时为 null */
const state = ref<ConfirmRequest | null>(null)

/** 未结算请求的 resolver，配合 state 保持单例 */
let pendingResolve: ((value: boolean) => void) | null = null

/** 供弹窗读取的只读状态 */
export const confirmState = readonly(state)

/** 结算当前请求：先清空状态再 resolve，避免重入 */
export function settleConfirm(value: boolean): void {
  const resolve = pendingResolve
  pendingResolve = null
  state.value = null
  resolve?.(value)
}

/** 打开全局确认弹窗，返回用户是否确认 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  // 已有未结算请求时先按取消处理，避免旧 Promise 悬挂
  if (pendingResolve) settleConfirm(false)

  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve
    state.value = {
      title: options.title ?? '确认操作',
      description: options.description,
      confirmText: options.confirmText ?? '确定',
      cancelText: options.cancelText ?? '取消',
      destructive: options.destructive ?? true
    }
  })
}
