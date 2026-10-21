import type { DatabaseSync } from 'node:sqlite'
import {
  codeFromSymbol,
  normalizeCode,
  type MarketId,
  type MarketSettings,
  type WatchItem
} from '../shared/market'
import {
  DEFAULT_MODULE,
  isAppModuleId,
  type AppModuleId
} from '../shared/navigation'
import {
  DEFAULT_MARKET_SETTINGS,
  type SettingRow,
  type WatchlistRow
} from './database'

/** MAX(sort_order) 查询结果 */
interface MaxSortOrderRow {
  max_order: number | null
}

/** watchlist 行转自选股条目 */
function rowToWatchItem(row: WatchlistRow): WatchItem {
  let code = row.code
  let symbol = row.symbol
  let market = row.market
  if (!symbol || !market) {
    const derived = normalizeCode(code || codeFromSymbol(symbol))
    if (derived) {
      code = derived.code
      symbol = derived.symbol
      market = derived.market
    }
  }
  return {
    code: code || codeFromSymbol(symbol),
    symbol,
    market: market as MarketId,
    name: row.name,
    addedAt: row.added_at,
    sortOrder: row.sort_order
  }
}

/** 解析单个设置值；缺失或非法 JSON 时返回 undefined */
function readSettingValue(values: Map<string, string>, key: string): unknown {
  const raw = values.get(key)
  if (raw === undefined) {
    return undefined
  }
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * 行情看板的本地持久化存储。
 *
 * 自选股列表保存在 watchlist 表，页面设置以 JSON 文本保存在 settings
 * 表，不含任何行情数值。数据库由 `openDatabase` 统一创建与关闭。
 */
export class MarketStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 按 symbol 读取单条自选股，不存在返回 null */
  private findBySymbol(symbol: string): WatchItem | null {
    const row = this.db
      .prepare('SELECT * FROM watchlist WHERE symbol = ?')
      .get(symbol) as unknown as WatchlistRow | undefined
    return row ? rowToWatchItem(row) : null
  }

  /** 自选股列表，按 sortOrder 升序、其次 addedAt 升序返回副本 */
  getWatchlist(): WatchItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM watchlist
         ORDER BY sort_order ASC, added_at ASC`
      )
      .all() as unknown as WatchlistRow[]
    return rows.map((row) => rowToWatchItem(row))
  }

  /**
   * 新增自选股；同 symbol 已存在时直接返回已存在的条目（不重复写入）。
   * addedAt 由本方法写入，sortOrder 取当前最大值 + 1（空表为 0）。
   */
  addWatch(item: {
    code: string
    symbol: string
    market: MarketId
    name: string
  }): WatchItem {
    const existing = this.findBySymbol(item.symbol)
    if (existing) {
      return existing
    }
    const addedAt = Date.now()
    let sortOrder = 0
    this.db.exec('BEGIN')
    try {
      const row = this.db
        .prepare('SELECT MAX(sort_order) AS max_order FROM watchlist')
        .get() as unknown as MaxSortOrderRow | undefined
      sortOrder = (row?.max_order ?? -1) + 1
      this.db
        .prepare(
          `INSERT INTO watchlist (
            symbol, code, market, name, added_at, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(item.symbol, item.code, item.market, item.name, addedAt, sortOrder)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return {
      code: item.code,
      symbol: item.symbol,
      market: item.market,
      name: item.name,
      addedAt,
      sortOrder
    }
  }

  /** 删除自选股，返回删除后的列表副本；symbol 不存在时列表不变 */
  removeWatch(symbol: string): WatchItem[] {
    this.db.prepare('DELETE FROM watchlist WHERE symbol = ?').run(symbol)
    return this.getWatchlist()
  }

  /** 更新名称缓存；name 为空或与原值相同则不写库 */
  updateName(symbol: string, name: string): WatchItem | null {
    const current = this.findBySymbol(symbol)
    if (!current) {
      return null
    }
    if (!name || name === current.name) {
      return current
    }
    this.db
      .prepare('UPDATE watchlist SET name = ? WHERE symbol = ?')
      .run(name, symbol)
    return { ...current, name }
  }

  /** 是否存在某 symbol */
  has(symbol: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM watchlist WHERE symbol = ? LIMIT 1')
      .get(symbol) as unknown as WatchlistRow | undefined
    return row !== undefined
  }

  getSettings(): MarketSettings {
    const rows = this.db
      .prepare(
        `SELECT key, value FROM settings
         WHERE key IN ('paused', 'lastPage')`
      )
      .all() as unknown as SettingRow[]
    const values = new Map(rows.map((row) => [row.key, row.value]))
    const paused = readSettingValue(values, 'paused')
    const lastPage = readSettingValue(values, 'lastPage')
    return {
      paused:
        typeof paused === 'boolean' ? paused : DEFAULT_MARKET_SETTINGS.paused,
      lastPage: isAppModuleId(lastPage) ? lastPage : DEFAULT_MODULE
    }
  }

  /** 合并写入设置（部分字段），返回合并后的完整设置 */
  updateSettings(patch: Partial<MarketSettings>): MarketSettings {
    const next: MarketSettings = { ...this.getSettings(), ...patch }
    const statement = this.db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    )
    statement.run('paused', JSON.stringify(next.paused))
    statement.run('lastPage', JSON.stringify(next.lastPage))
    return next
  }

  /** 便捷方法：设置暂停开关 */
  setPaused(paused: boolean): MarketSettings {
    return this.updateSettings({ paused })
  }

  /** 便捷方法：记录上次停留页面 */
  setLastPage(page: AppModuleId): MarketSettings {
    return this.updateSettings({ lastPage: page })
  }
}
