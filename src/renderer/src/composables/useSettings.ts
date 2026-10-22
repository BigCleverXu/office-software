import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type {
  AppSettings,
  AppTheme,
  ExportBackupResult,
  OpenDataDirResult,
  SettingsViewState
} from '@shared/settings'

/** 保存失败时的统一提示 */
const SAVE_ERROR = '保存失败，请重试'
/** 加载失败时的统一提示 */
const LOAD_ERROR = '加载设置失败，请重试'

// 模块级共享状态：多个组件调用时只加载与订阅一次
const state = ref<SettingsViewState | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')

let started = false
let loadingPromise: Promise<void> | null = null

/** 订阅主进程广播的设置变更，保证渲染层与主进程一致 */
const subscribe = (): void => {
  window.api.settings.onChanged((next) => {
    state.value = next
  })
}

/** 首次调用时拉取设置并订阅变更，之后的调用复用同一 Promise */
const load = (): Promise<void> => {
  if (loadingPromise) return loadingPromise
  if (!started) {
    started = true
    subscribe()
  }
  loadingPromise = (async () => {
    loading.value = true
    error.value = ''
    try {
      state.value = await window.api.settings.get()
    } catch {
      error.value = LOAD_ERROR
    } finally {
      loading.value = false
    }
  })()
  return loadingPromise
}

interface UseSettings {
  /** 当前设置，加载完成前为 null */
  settings: ComputedRef<AppSettings | null>
  /** 当前应用版本号 */
  appVersion: ComputedRef<string>
  /** 应用数据目录 */
  dataDir: ComputedRef<string>
  /** 当前平台是否支持开机自启 */
  autoLaunchSupported: ComputedRef<boolean>
  /** 平台标识 */
  platform: ComputedRef<string>
  /** 是否正在加载 */
  loading: Ref<boolean>
  /** 是否正在保存 */
  saving: Ref<boolean>
  /** 最近一次失败的中文提示 */
  error: Ref<string>
  /** 局部更新设置，成功返回 true */
  update: (patch: Partial<AppSettings>) => Promise<boolean>
  /** 打开数据目录 */
  openDataDir: () => Promise<OpenDataDirResult>
  /** 导出数据库备份 */
  exportBackup: () => Promise<ExportBackupResult>
}

/**
 * 设置状态 composable：模块级共享 state / loading / saving / error，
 * 首次调用即拉取设置并订阅变更。
 */
export function useSettings(): UseSettings {
  const settings = computed(() => state.value?.settings ?? null)
  const appVersion = computed(() => state.value?.appVersion ?? '')
  const dataDir = computed(() => state.value?.dataDir ?? '')
  const autoLaunchSupported = computed(
    () => state.value?.autoLaunchSupported ?? true
  )
  const platform = computed(() => state.value?.platform ?? '')

  const update = async (patch: Partial<AppSettings>): Promise<boolean> => {
    saving.value = true
    error.value = ''
    try {
      state.value = await window.api.settings.update(patch)
      return true
    } catch {
      error.value = SAVE_ERROR
      return false
    } finally {
      saving.value = false
    }
  }

  const openDataDir = (): Promise<OpenDataDirResult> =>
    window.api.settings.openDataDir()

  const exportBackup = (): Promise<ExportBackupResult> =>
    window.api.settings.exportBackup()

  void load()

  return {
    settings,
    appVersion,
    dataDir,
    autoLaunchSupported,
    platform,
    loading,
    saving,
    error,
    update,
    openDataDir,
    exportBackup
  }
}

/**
 * 应用主题：深色，或跟随系统且系统偏好深色时给根元素加 `.dark`，否则移除。
 * 可在挂载 Vue 前调用，避免首帧主题闪烁。
 */
export function applyTheme(theme: AppTheme): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
}
