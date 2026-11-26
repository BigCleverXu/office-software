import { onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { DEFAULT_WATER_SETTINGS } from '@shared/water'
import type { WaterApi, WaterState, WaterSyncResult } from '@shared/water'
import { useToday } from '@/composables/useToday'

export interface UseWater {
  /** 今日统计、记录与杯容量 */
  state: Ref<WaterState>
  /** 首次加载是否完成 */
  loaded: Ref<boolean>
  /** 最近一次失败的中文提示，成功时清空 */
  error: Ref<string>
  /** 当前本地日期 YYYY-MM-DD，跨零点自动更新 */
  todayKey: ComputedRef<string>
  addCup: () => Promise<WaterState | null>
  setCupMl: (ml: number) => Promise<boolean>
  removeLast: () => Promise<void>
  syncCalendar: () => Promise<WaterSyncResult | null>
  refresh: () => Promise<void>
}

/** 初始状态：未加载时先按默认容量展示 */
const createInitialState = (): WaterState => ({
  settings: { ...DEFAULT_WATER_SETTINGS },
  records: [],
  todayCount: 0,
  todayTotalMl: 0
})

/** 模块级共享状态：多处调用复用同一份数据 */
const state = ref<WaterState>(createInitialState())
const loaded = ref(false)
const error = ref('')

/**
 * 取用 preload 暴露的喝水 API。
 * preload 类型由并行任务补齐，这里按共享契约取用，避免类型耦合。
 */
const getApi = (): WaterApi =>
  (window.api as unknown as { water: WaterApi }).water

const applyState = (next: WaterState): void => {
  state.value = next
}

/**
 * 喝水数据 composable：封装 IPC 调用与错误处理。
 * 所有异常都在内部转成中文提示，不向组件抛错。
 */
export function useWater(): UseWater {
  const refresh = async (): Promise<void> => {
    try {
      applyState(await getApi().getState())
      error.value = ''
    } catch {
      error.value = '喝水数据加载失败，请稍后重试'
    } finally {
      loaded.value = true
    }
  }

  const todayKey = useToday()

  // 应用常驻托盘可能跨天运行，本地日期变化时重新拉取今日数据
  watch(todayKey, () => {
    void refresh()
  })

  const addCup = async (): Promise<WaterState | null> => {
    try {
      const next = await getApi().addCup()
      applyState(next)
      error.value = ''
      return next
    } catch {
      error.value = '记录饮水失败，请稍后重试'
      return null
    }
  }

  const setCupMl = async (ml: number): Promise<boolean> => {
    try {
      const next = await getApi().setCupMl(ml)
      // 主进程拒绝非法容量时返回 null
      if (!next) {
        error.value = '保存容量失败，请稍后重试'
        return false
      }
      applyState(next)
      error.value = ''
      return true
    } catch {
      error.value = '保存容量失败，请稍后重试'
      return false
    }
  }

  const removeLast = async (): Promise<void> => {
    error.value = ''
    try {
      applyState(await getApi().removeLast())
    } catch {
      error.value = '撤销失败，请稍后重试'
    }
  }

  const syncCalendar = async (): Promise<WaterSyncResult | null> => {
    try {
      const result = await getApi().syncCalendar()
      if (!result.ok) {
        error.value = result.message || '同步失败，请稍后重试'
        return result
      }
      error.value = ''
      return result
    } catch {
      error.value = '同步到应用日历失败，请稍后重试'
      return null
    }
  }

  onMounted(() => {
    void refresh()
  })

  return {
    state,
    loaded,
    error,
    todayKey,
    addCup,
    setCupMl,
    removeLast,
    syncCalendar,
    refresh
  }
}
