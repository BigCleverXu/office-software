// 主进程喝水记录存储：读写杯容量单行表与饮水记录表
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_WATER_SETTINGS,
  isValidCupMl,
  localDayRange,
  normalizeCupMl,
  type WaterRecord,
  type WaterSettings
} from '../shared/water'
import type { WaterRecordRow } from './database'

/** water_settings 表行结构 */
interface WaterSettingRow {
  cup_ml: number
  updated_at: number
}

/** 行转记录；amount_ml 非有限或非正数时返回 null，由调用方丢弃脏行 */
function rowToRecord(row: WaterRecordRow): WaterRecord | null {
  const amount = row.amount_ml
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }
  return {
    id: row.id,
    amountMl: amount,
    drankAt: row.drank_at,
    syncedAt: row.synced_at ?? null
  }
}

/**
 * 喝水设置与记录的本地持久化存储。
 *
 * 容量表只保留一行（id = 1），缺失或脏数据时回退默认 500ml；
 * 记录表按饮水时间存储，撤销与今日区间查询都以本地自然日为准。
 */
export class WaterStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 读取杯容量设置；无记录时返回默认值 */
  getSettings(): WaterSettings {
    const row = this.db
      .prepare('SELECT cup_ml, updated_at FROM water_settings WHERE id = 1')
      .get() as unknown as WaterSettingRow | undefined
    if (!row) {
      return { ...DEFAULT_WATER_SETTINGS }
    }
    const updatedAt = row.updated_at
    return {
      cupMl: normalizeCupMl(row.cup_ml),
      updatedAt:
        typeof updatedAt === 'number' &&
        Number.isFinite(updatedAt) &&
        updatedAt > 0
          ? updatedAt
          : null
    }
  }

  /** 写入杯容量；非法值返回 null 且不写库 */
  setCupMl(raw: unknown): WaterSettings | null {
    if (!isValidCupMl(raw)) {
      return null
    }
    const cupMl = raw as number
    const updatedAt = Date.now()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO water_settings (id, cup_ml, updated_at)
         VALUES (1, ?, ?)`
      )
      .run(cupMl, updatedAt)
    return { cupMl, updatedAt }
  }

  /** 查询 [from, to) 区间内的记录，按饮水时间倒序 */
  listRecords(from: number, to: number): WaterRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, amount_ml, drank_at, synced_at, created_at
         FROM water_records
         WHERE drank_at >= ? AND drank_at < ?
         ORDER BY drank_at DESC, created_at DESC`
      )
      .all(from, to) as unknown as WaterRecordRow[]
    return rows
      .map((row) => rowToRecord(row))
      .filter((record): record is WaterRecord => record !== null)
  }

  /** 追加一条饮水记录；毫升数非 50–2000 的整数时返回 null */
  addCup(amountMl: number, now: number = Date.now()): WaterRecord | null {
    if (!isValidCupMl(amountMl)) {
      return null
    }
    const record: WaterRecord = {
      id: randomUUID(),
      amountMl,
      drankAt: now,
      syncedAt: null
    }
    this.db
      .prepare(
        `INSERT INTO water_records (
          id, amount_ml, drank_at, synced_at, created_at
        ) VALUES (?, ?, ?, NULL, ?)`
      )
      .run(record.id, record.amountMl, record.drankAt, now)
    return record
  }

  /** 删除今日时间最晚的一条记录并返回它；没有今日记录时返回 null */
  removeLast(now: number = Date.now()): WaterRecord | null {
    const { from, to } = localDayRange(now)
    const row = this.db
      .prepare(
        `SELECT id, amount_ml, drank_at, synced_at, created_at
         FROM water_records
         WHERE drank_at >= ? AND drank_at < ?
         ORDER BY drank_at DESC, created_at DESC
         LIMIT 1`
      )
      .get(from, to) as unknown as WaterRecordRow | undefined
    if (!row) {
      return null
    }
    this.db.prepare('DELETE FROM water_records WHERE id = ?').run(row.id)
    return rowToRecord(row)
  }

  /** 把指定记录标记为已同步；只更新尚未同步的行，返回实际更新条数 */
  markSynced(ids: readonly string[], now: number = Date.now()): number {
    if (ids.length === 0) {
      return 0
    }
    const update = this.db.prepare(
      `UPDATE water_records SET synced_at = ?
       WHERE id = ? AND synced_at IS NULL`
    )
    let count = 0
    this.db.exec('BEGIN')
    try {
      for (const id of ids) {
        const result = update.run(now, id)
        count += Number(result.changes)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return count
  }
}
