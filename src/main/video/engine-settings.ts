// 短视频模块：本地口播引擎设置的持久化
// 复用 settings 表的 key-value 存储，key = 'video-engine'
import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_VIDEO_MODULE_SETTINGS,
  normalizeVideoEngineConfig,
  type VideoModuleSettings
} from '../../shared/video'

/** settings 表中保存口播引擎设置的行 key */
const SETTINGS_KEY = 'video-engine'

/** 单列 value 查询结果 */
interface SettingValueRow {
  value: string
}

/** 默认设置的深拷贝，避免调用方误改共享常量 */
function defaultSettings(): VideoModuleSettings {
  return {
    engine: { ...DEFAULT_VIDEO_MODULE_SETTINGS.engine },
    downloadDir: DEFAULT_VIDEO_MODULE_SETTINGS.downloadDir
  }
}

/**
 * 归一化存储中的设置：engine 交给共享校验函数，
 * downloadDir 只接受非空字符串，其余一律回退空串。
 */
function normalizeSettings(raw: unknown): VideoModuleSettings {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultSettings()
  }
  const record = raw as Record<string, unknown>
  const downloadDir =
    typeof record.downloadDir === 'string' ? record.downloadDir.trim() : ''
  return {
    engine: normalizeVideoEngineConfig(record.engine),
    downloadDir
  }
}

/**
 * 口播引擎配置存储。
 *
 * 全部设置以单个 JSON 文档保存在 settings 表 `key = 'video-engine'` 的行中，
 * 读取时逐字段校验并合并默认值；get 永不抛异常。
 */
export class VideoEngineSettingsStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /**
   * 读取设置；缺行、JSON 损坏或结构不符时返回默认设置，不抛异常。
   */
  get(): VideoModuleSettings {
    try {
      const row = this.db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(SETTINGS_KEY) as unknown as SettingValueRow | undefined
      if (!row) {
        return defaultSettings()
      }
      return normalizeSettings(JSON.parse(row.value))
    } catch {
      return defaultSettings()
    }
  }

  /**
   * 合并写入设置（部分字段），非法字段回退默认值、未知字段忽略。
   * 以单事务写入 `key = 'video-engine'` 的行，返回合并后的完整设置。
   */
  update(patch: Partial<VideoModuleSettings>): VideoModuleSettings {
    const current = this.get()
    const rawEngine = patch.engine
    const enginePatch =
      rawEngine !== null &&
      typeof rawEngine === 'object' &&
      !Array.isArray(rawEngine)
        ? rawEngine
        : {}
    const next: VideoModuleSettings = {
      engine: normalizeVideoEngineConfig({ ...current.engine, ...enginePatch }),
      downloadDir:
        typeof patch.downloadDir === 'string'
          ? patch.downloadDir.trim()
          : current.downloadDir
    }
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run(SETTINGS_KEY, JSON.stringify(next))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return next
  }
}
