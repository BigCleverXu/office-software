import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import {
  DEVICE_REFRESH_INTERVAL_MS,
  normalizeDeviceSnapshot
} from '@shared/devices'
import type {
  DeviceActionResult,
  DeviceSnapshot,
  DeviceState
} from '@shared/devices'

export interface UseDevices {
  snapshot: Ref<DeviceSnapshot>
  loaded: Ref<boolean>
  refreshing: Ref<boolean>
  lastError: Ref<string | null>
  setVisible: (visible: boolean) => void
  refresh: () => Promise<void>
  setMasterVolume: (volume: number) => Promise<boolean>
  setOutputVolume: (id: string, volume: number) => Promise<boolean>
  setMuted: (muted: boolean) => Promise<boolean>
  setPointerSpeed: (speed: number) => Promise<boolean>
  reset: () => Promise<boolean>
}

/** 当前平台标识，用于快照兜底归一化 */
const platform = window.api.update.platform

/** 模块级共享状态：多个入口复用同一份快照与订阅 */
const snapshot = ref<DeviceSnapshot>(
  normalizeDeviceSnapshot(undefined, platform)
)
const loaded = ref(false)
const refreshing = ref(false)
const lastError = ref<string | null>(null)

let unsubscribe: (() => void) | null = null
let mountedCount = 0
/** 面板是否处于可见状态，由 useElementVisibility 驱动 */
let visible = false
let timer: number | null = null

/** 主进程推送的快照统一走归一化，避免渲染层直接信任 IPC 数据 */
const applyState = (state: DeviceState): void => {
  snapshot.value = normalizeDeviceSnapshot(state.snapshot, platform)
}

/** 轮询前置条件：面板可见、页面可见且窗口拥有焦点 */
const canPoll = (): boolean =>
  visible && document.visibilityState === 'visible' && document.hasFocus()

const stopTimer = (): void => {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

/** 按当前可见性启停定时器；任一条件不满足时立即停止，避免隐藏时发请求 */
const syncPolling = (): void => {
  if (!canPoll()) {
    stopTimer()
    return
  }
  if (timer !== null) {
    return
  }
  timer = window.setInterval(() => {
    if (!canPoll()) {
      stopTimer()
      return
    }
    void refresh()
  }, DEVICE_REFRESH_INTERVAL_MS)
}

/** 页面可见性与窗口焦点变化都重新评估轮询条件 */
const handleWake = (): void => {
  syncPolling()
}

const attachListeners = (): void => {
  document.addEventListener('visibilitychange', handleWake)
  window.addEventListener('focus', handleWake)
  window.addEventListener('blur', handleWake)
}

const detachListeners = (): void => {
  document.removeEventListener('visibilitychange', handleWake)
  window.removeEventListener('focus', handleWake)
  window.removeEventListener('blur', handleWake)
}

/** 拉取一次完整快照；失败保留旧数据，只记录最新一条错误 */
const refresh = async (): Promise<void> => {
  refreshing.value = true
  try {
    const state = await window.api.devices.refresh()
    applyState(state)
    lastError.value = null
  } catch {
    lastError.value = '设备状态读取失败'
  } finally {
    refreshing.value = false
  }
}

/**
 * 写操作的通用流程：先乐观更新本地快照，失败时恢复备份。
 * 成功用返回的快照归一化覆盖；失败保留返回结果的错误文案。
 */
const runWrite = async (
  optimistic: (current: DeviceSnapshot) => DeviceSnapshot,
  action: () => Promise<DeviceActionResult>
): Promise<boolean> => {
  const previous = snapshot.value
  snapshot.value = optimistic(previous)
  try {
    const result = await action()
    if (result.ok) {
      snapshot.value = normalizeDeviceSnapshot(result.snapshot, platform)
      lastError.value = null
      return true
    }
    snapshot.value = previous
    lastError.value = result.error ?? '设备设置失败，请稍后重试'
    return false
  } catch {
    snapshot.value = previous
    lastError.value = '设备设置失败，请稍后重试'
    return false
  }
}

const setMasterVolume = (volume: number): Promise<boolean> =>
  runWrite(
    (current) => ({
      ...current,
      audio: { ...current.audio, masterVolume: volume }
    }),
    () => window.api.devices.setMasterVolume(volume)
  )

const setOutputVolume = (id: string, volume: number): Promise<boolean> =>
  runWrite(
    (current) => ({
      ...current,
      audio: {
        ...current.audio,
        outputs: current.audio.outputs.map((output) =>
          output.id === id ? { ...output, volume } : output
        )
      }
    }),
    () => window.api.devices.setOutputVolume(id, volume)
  )

const setMuted = (muted: boolean): Promise<boolean> =>
  runWrite(
    (current) => ({
      ...current,
      audio: { ...current.audio, masterMuted: muted }
    }),
    () => window.api.devices.setMuted(muted)
  )

const setPointerSpeed = (speed: number): Promise<boolean> =>
  runWrite(
    (current) => ({
      ...current,
      pointer: { ...current.pointer, speed }
    }),
    () => window.api.devices.setPointerSpeed(speed)
  )

/** 恢复默认设置：无论成败都用返回的快照覆盖，失败可能只是部分成功 */
const reset = async (): Promise<boolean> => {
  try {
    const result = await window.api.devices.reset()
    snapshot.value = normalizeDeviceSnapshot(result.snapshot, platform)
    if (result.ok) {
      lastError.value = null
      return true
    }
    lastError.value = result.error ?? '恢复默认设置失败，请稍后重试'
    return false
  } catch {
    lastError.value = '恢复默认设置失败，请稍后重试'
    return false
  }
}

const setVisible = (next: boolean): void => {
  visible = next
  syncPolling()
}

/**
 * 设备状态 composable：封装与主进程的 IPC 交互、订阅与可见性轮询。
 * 仅在面板可见、页面可见且窗口有焦点时按固定间隔刷新。
 */
export function useDevices(): UseDevices {
  onMounted(async () => {
    mountedCount += 1
    if (!unsubscribe) {
      unsubscribe = window.api.devices.onStateChanged(applyState)
      attachListeners()
    }
    syncPolling()
    try {
      applyState(await window.api.devices.getState())
    } catch {
      lastError.value = '设备状态读取失败'
    } finally {
      loaded.value = true
    }
  })

  onUnmounted(() => {
    mountedCount = Math.max(0, mountedCount - 1)
    if (mountedCount === 0) {
      visible = false
      stopTimer()
      detachListeners()
      unsubscribe?.()
      unsubscribe = null
    }
  })

  return {
    snapshot,
    loaded,
    refreshing,
    lastError,
    setVisible,
    refresh,
    setMasterVolume,
    setOutputVolume,
    setMuted,
    setPointerSpeed,
    reset
  }
}
