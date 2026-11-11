import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { DEFAULT_GOLD_HOLDING } from '@shared/gold'
import type { GoldHolding, GoldSnapshot, GoldState } from '@shared/gold'

export interface UseGold {
  snapshot: Ref<GoldSnapshot>
  loaded: Ref<boolean>
  holding: ComputedRef<GoldHolding>
  updateHolding: (grams: number, costPerGram: number) => Promise<boolean>
  refreshNow: () => Promise<void>
}

/** 首次加载且尚未拿到数据时的初始快照 */
const INITIAL_SNAPSHOT: GoldSnapshot = {
  status: 'loading',
  quotes: [],
  holding: { ...DEFAULT_GOLD_HOLDING },
  updatedAt: null,
  updatedAtLabel: null,
  failureCount: 0
}

/** 模块级共享状态：多处调用复用同一份快照与订阅 */
const snapshot = ref<GoldSnapshot>({ ...INITIAL_SNAPSHOT })
const loaded = ref(false)

let unsubscribe: (() => void) | null = null
let mountedCount = 0

const applyState = (state: GoldState): void => {
  snapshot.value = state.snapshot
}

/**
 * 积存金数据 composable：封装与主进程的 IPC 交互与响应式状态。
 * 挂载时拉取初始状态并订阅主进程推送的变更。
 */
export function useGold(): UseGold {
  const holding = computed<GoldHolding>(() => snapshot.value.holding)

  /** 更新持仓；成功返回 true，失败回退并返回 false */
  const updateHolding = async (
    grams: number,
    costPerGram: number
  ): Promise<boolean> => {
    try {
      const updated = await window.api.gold.updateHolding({
        grams,
        costPerGram
      })
      if (!updated) {
        return false
      }
      snapshot.value = { ...snapshot.value, holding: updated }
      return true
    } catch {
      return false
    }
  }

  const refreshNow = (): Promise<void> => window.api.gold.refreshNow()

  onMounted(async () => {
    mountedCount += 1
    if (!unsubscribe) {
      unsubscribe = window.api.gold.onStateChanged(applyState)
    }
    try {
      applyState(await window.api.gold.getState())
    } catch {
      snapshot.value = { ...snapshot.value, status: 'failed' }
    } finally {
      loaded.value = true
    }
  })

  onUnmounted(() => {
    mountedCount = Math.max(0, mountedCount - 1)
    if (mountedCount === 0) {
      unsubscribe?.()
      unsubscribe = null
    }
  })

  return { snapshot, loaded, holding, updateHolding, refreshNow }
}
