// 主进程应用内日程事件存储：按日期区间查询、按来源记录去重写入与联动删除
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  eventDateKey,
  isDateOnly,
  type CalendarEvent,
  type CalendarEventSource
} from '../shared/calendar'
import type { WaterRecord } from '../shared/water'
import type { CalendarEventRow } from './database'

/** 行转事件 */
function rowToEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    startAt: row.start_at,
    amountMl: row.amount_ml,
    source: row.source as CalendarEventSource,
    sourceId: row.source_id,
    createdAt: row.created_at
  }
}

/**
 * 应用内日程事件的本地持久化存储。
 *
 * 数据保存在注入的 SQLite 数据库（`calendar_events` 表）中，由 database.ts
 * 负责建表；本类只做单表读写，`source_id` 唯一约束负责同步去重。
 */
export class CalendarEventStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 查询 [from, to] 闭区间内的事件，按日期升序、同日按开始时间升序 */
  listByDateRange(from: string, to: string): CalendarEvent[] {
    if (!isDateOnly(from) || !isDateOnly(to) || from > to) {
      return []
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM calendar_events
         WHERE date >= ? AND date <= ?
         ORDER BY date ASC, start_at ASC`
      )
      .all(from, to) as unknown as CalendarEventRow[]
    return rows.map((row) => rowToEvent(row))
  }

  /**
   * 把饮水记录逐条写入日程事件，按来源记录 id 去重。
   * 已存在的记录由唯一约束忽略，返回实际新增条数。
   */
  upsertWaterRecords(records: readonly WaterRecord[]): number {
    if (records.length === 0) {
      return 0
    }
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO calendar_events (
        id, title, date, start_at, amount_ml, source, source_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const createdAt = Date.now()
    let created = 0
    this.db.exec('BEGIN')
    try {
      for (const record of records) {
        // 时间戳异常时跳过，避免写入无法归日的脏事件
        const date = eventDateKey(record.drankAt)
        if (date === '') {
          continue
        }
        const result = insert.run(
          randomUUID(),
          `喝水 ${record.amountMl} ml`,
          date,
          record.drankAt,
          record.amountMl,
          'water',
          record.id,
          createdAt
        )
        created += Number(result.changes)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return created
  }

  /** 按来源记录 id 批量删除事件，返回删除条数 */
  removeBySourceIds(ids: readonly string[]): number {
    if (ids.length === 0) {
      return 0
    }
    const remove = this.db.prepare(
      'DELETE FROM calendar_events WHERE source_id = ?'
    )
    let removed = 0
    this.db.exec('BEGIN')
    try {
      for (const id of ids) {
        removed += Number(remove.run(id).changes)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return removed
  }
}
