import type { DatabaseSync } from 'node:sqlite'
import { normalizeNewsPlatforms, type NewsPlatformId } from '../shared/news'
import type { SettingRow } from './database'

/** settings 表中存放选中平台的键名 */
export const NEWS_PLATFORMS_KEY = 'newsPlatforms'

/**
 * 热点模块平台选择持久化：
 * 以 JSON 数组形式存入 settings 表，损坏数据回退默认值。
 *
 * 键名固定为 `newsPlatforms`，值为 `JSON.stringify(NewsPlatformId[])`。
 * 数据库由 `openDatabase` 统一创建与关闭。
 */
export class NewsStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 读取选中平台（已归一化，绝不返回空数组） */
  getPlatforms(): NewsPlatformId[] {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(NEWS_PLATFORMS_KEY) as unknown as SettingRow | undefined
    if (!row) {
      return normalizeNewsPlatforms(undefined)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(row.value)
    } catch {
      return normalizeNewsPlatforms(undefined)
    }
    return normalizeNewsPlatforms(parsed)
  }

  /** 归一化后写入并返回写入结果 */
  setPlatforms(platforms: unknown): NewsPlatformId[] {
    const normalized = normalizeNewsPlatforms(platforms)
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(NEWS_PLATFORMS_KEY, JSON.stringify(normalized))
    return normalized
  }
}
