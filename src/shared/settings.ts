// 设置模块共享契约：类型 + 校验纯函数 + IPC 通道
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 主题模式：跟随系统 / 浅色 / 深色 */
export type AppTheme = 'system' | 'light' | 'dark'

/** 全局应用设置 */
export interface AppSettings {
  /** 是否开机自启 */
  launchAtLogin: boolean
  /** 主题模式 */
  theme: AppTheme
}

/** 默认设置（也是非法数据的兜底值） */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  launchAtLogin: false,
  theme: 'system'
}

/** 合法主题集合 */
const APP_THEMES: readonly AppTheme[] = ['system', 'light', 'dark']

/** 是否为合法主题值 */
function isAppTheme(value: unknown): value is AppTheme {
  return (
    typeof value === 'string' &&
    (APP_THEMES as readonly string[]).includes(value)
  )
}

/**
 * 逐字段校验设置：只接受普通对象，布尔字段非 boolean 回退默认，
 * theme 仅接受三个枚举值否则回退 'system'，未知字段忽略。
 * 任何异常都返回默认设置，不向调用方抛出。
 */
export function normalizeAppSettings(raw: unknown): AppSettings {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ...DEFAULT_APP_SETTINGS }
    }
    const record = raw as Record<string, unknown>
    return {
      launchAtLogin:
        typeof record.launchAtLogin === 'boolean'
          ? record.launchAtLogin
          : DEFAULT_APP_SETTINGS.launchAtLogin,
      theme: isAppTheme(record.theme)
        ? record.theme
        : DEFAULT_APP_SETTINGS.theme
    }
  } catch {
    return { ...DEFAULT_APP_SETTINGS }
  }
}

/** 设置相关 IPC 通道 */
export const SETTINGS_CHANNELS = {
  get: 'settings:get',
  update: 'settings:update',
  changed: 'settings:changed',
  openDataDir: 'settings:open-data-dir',
  exportBackup: 'settings:export-backup'
} as const

/** 设置页需要的完整状态 */
export interface SettingsViewState {
  settings: AppSettings
  /** 当前应用版本号 */
  appVersion: string
  /** 应用数据目录 */
  dataDir: string
  /** 当前平台是否支持开机自启 */
  autoLaunchSupported: boolean
  /** 平台标识，如 'win32' / 'darwin' / 'linux' */
  platform: string
}

/** 打开数据目录的结果 */
export interface OpenDataDirResult {
  ok: boolean
  error?: string
}

/** 导出数据库备份的结果 */
export interface ExportBackupResult {
  canceled: boolean
  filePath?: string
  error?: string
}

/** preload 暴露给渲染层的设置 API */
export interface SettingsApi {
  /** 启动首帧使用的主题，避免闪烁 */
  initialTheme: AppTheme
  get(): Promise<SettingsViewState>
  update(patch: Partial<AppSettings>): Promise<SettingsViewState>
  openDataDir(): Promise<OpenDataDirResult>
  exportBackup(): Promise<ExportBackupResult>
  onChanged(callback: (state: SettingsViewState) => void): () => void
}
