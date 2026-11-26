import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { PriceAlert, PriceAlertDraft } from '../shared/market'
import type { MarketAlertRow } from './database'

/** market_alerts 行转价格提醒；kind 非法时按 'above' 兜底 */
function rowToAlert(row: MarketAlertRow): PriceAlert {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    kind:
      row.kind === 'above' || row.kind === 'below' || row.kind === 'range'
        ? row.kind
        : 'above',
    threshold: row.threshold,
    rangeLow: row.range_low,
    rangeHigh: row.range_high,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastTriggeredAt: row.last_triggered_at
  }
}

/**
 * 行情价格提醒的本地持久化存储。
 *
 * 数据保存在注入的 SQLite 数据库（`market_alerts` 表）中，由 database.ts
 * 负责建表与旧库升级；本类只做单表读写。
 */
export class MarketAlertStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 按 id 读取单条提醒；不存在返回 null */
  private getById(id: string): PriceAlert | null {
    const row = this.db
      .prepare('SELECT * FROM market_alerts WHERE id = ?')
      .get(id) as unknown as MarketAlertRow | undefined
    return row ? rowToAlert(row) : null
  }

  /** 全部提醒，按创建时间升序、其次插入顺序升序 */
  getAll(): PriceAlert[] {
    const rows = this.db
      .prepare('SELECT * FROM market_alerts ORDER BY created_at ASC, rowid ASC')
      .all() as unknown as MarketAlertRow[]
    return rows.map((row) => rowToAlert(row))
  }

  /** 某只股票的全部提醒，排序与 getAll 一致 */
  getBySymbol(symbol: string): PriceAlert[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM market_alerts
         WHERE symbol = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(symbol) as unknown as MarketAlertRow[]
    return rows.map((row) => rowToAlert(row))
  }

  /** 新增提醒，默认启用、未触发 */
  create(draft: PriceAlertDraft): PriceAlert {
    const alert: PriceAlert = {
      id: randomUUID(),
      symbol: draft.symbol,
      name: draft.name,
      kind: draft.kind,
      threshold: draft.threshold,
      rangeLow: draft.rangeLow,
      rangeHigh: draft.rangeHigh,
      enabled: true,
      createdAt: Date.now(),
      lastTriggeredAt: null
    }
    this.db
      .prepare(
        `INSERT INTO market_alerts (
          id, symbol, name, kind, threshold, range_low, range_high,
          enabled, created_at, last_triggered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        alert.id,
        alert.symbol,
        alert.name,
        alert.kind,
        alert.threshold,
        alert.rangeLow,
        alert.rangeHigh,
        alert.enabled ? 1 : 0,
        alert.createdAt,
        alert.lastTriggeredAt
      )
    return alert
  }

  /** 删除单条提醒 */
  remove(id: string): void {
    this.db.prepare('DELETE FROM market_alerts WHERE id = ?').run(id)
  }

  /** 删除某只股票的全部提醒 */
  removeBySymbol(symbol: string): void {
    this.db.prepare('DELETE FROM market_alerts WHERE symbol = ?').run(symbol)
  }

  /** 启用 / 停用某条提醒；不存在返回 null */
  setEnabled(id: string, enabled: boolean): PriceAlert | null {
    const current = this.getById(id)
    if (!current) {
      return null
    }
    this.db
      .prepare('UPDATE market_alerts SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id)
    return { ...current, enabled }
  }

  /** 记录触发时间并停用提醒；不存在返回 null */
  markTriggered(id: string, at: number): PriceAlert | null {
    const current = this.getById(id)
    if (!current) {
      return null
    }
    this.db
      .prepare(
        'UPDATE market_alerts SET enabled = 0, last_triggered_at = ? WHERE id = ?'
      )
      .run(at, id)
    return { ...current, enabled: false, lastTriggeredAt: at }
  }
}
