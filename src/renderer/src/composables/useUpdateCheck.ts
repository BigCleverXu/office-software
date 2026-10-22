import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { UpdateCheckResult, UpdateErrorReason } from '@shared/update'

/** 失败原因到中文文案的映射 */
export const UPDATE_ERROR_TEXT: Record<UpdateErrorReason, string> = {
  network: '网络不可用，请检查网络后重试',
  timeout: '请求超时，请稍后重试',
  'rate-limited': '请求过于频繁，请稍后再试',
  unreadable: '无法读取发行版信息，请确认仓库可访问',
  unknown: '发生未知错误'
}

// 模块级共享状态：设置页手动检查与主进程自动检查共用同一弹窗
const checking = ref(false)
const open = ref(false)
const result = ref<UpdateCheckResult | null>(null)

const errorText = computed(() => {
  const current = result.value
  return current?.status === 'error' ? UPDATE_ERROR_TEXT[current.reason] : ''
})

interface UseUpdateCheck {
  /** 是否正在检查 */
  checking: Ref<boolean>
  /** 结果弹窗是否打开 */
  open: Ref<boolean>
  /** 最近一次检查结果 */
  result: Ref<UpdateCheckResult | null>
  /** 失败原因对应的中文文案，非失败态为空串 */
  errorText: ComputedRef<string>
  /** 触发检查，完成后打开弹窗 */
  check: () => Promise<void>
  /** 展示外部推送的检查结果并打开弹窗 */
  showResult: (next: UpdateCheckResult) => void
}

/**
 * 检查更新 composable：封装 IPC 调用、结果状态与错误文案。
 * 任何异常都收敛为 unknown 失败结果，行为与此前侧边栏入口一致。
 */
export function useUpdateCheck(): UseUpdateCheck {
  const check = async (): Promise<void> => {
    if (checking.value) return
    checking.value = true
    try {
      result.value = await window.api.update.check()
    } catch {
      result.value = {
        status: 'error',
        currentVersion: '',
        reason: 'unknown'
      }
    } finally {
      checking.value = false
    }
    open.value = true
  }

  const showResult = (next: UpdateCheckResult): void => {
    result.value = next
    open.value = true
  }

  return { checking, open, result, errorText, check, showResult }
}
