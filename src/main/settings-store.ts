import type { DatabaseSync } from 'node:sqlite'
import { normalizeAppSettings, type AppSettings } from '../shared/settings'

/** settings 表中保存全局设置的行 key */
const SETTINGS_KEY = 'app'

/** 单列 value 查询结果 */
interface SettingValueRow {
  value: string
}

/**
 * 全局应用设置的本地持久化存储。
 *
 * 所有设置以单个 JSON 文档保存在 settings 表 `key = 'app'` 的行中，
 * 读取时逐字段校验并合并默认值。数据库由 `openDatabase` 统一创建与关闭。
 */
export class SettingsStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /**
   * 读取设置；缺行、JSON 损坏或结构不符时返回默认设置，不抛异常。
   */
  get(): AppSettings {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SETTINGS_KEY) as unknown as SettingValueRow | undefined
    if (!row) {
      return normalizeAppSettings(undefined)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(row.value)
    } catch {
      return normalizeAppSettings(undefined)
    }
    return normalizeAppSettings(parsed)
  }

  /**
   * 合并写入设置（部分字段），非法字段回退默认值、未知字段忽略。
   * 以单事务写入 `key = 'app'` 的行，返回合并后的完整设置。
   */
  update(patch: Partial<AppSettings>): AppSettings {
    const next = normalizeAppSettings({ ...this.get(), ...patch })
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
