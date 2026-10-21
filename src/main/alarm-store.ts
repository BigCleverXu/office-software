import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Alarm,
  AlarmDraft,
  IntervalUnit,
  RepeatType,
  Weekday
} from '../shared/types'
import { getIntervalMs } from '../shared/interval'
import type { AlarmRow } from './database'

/** 列名与 Alarm 字段之间的转换 */
function rowToAlarm(row: AlarmRow): Alarm {
  let weekdays: Weekday[] = []
  try {
    weekdays = JSON.parse(row.weekdays) as Weekday[]
  } catch {
    weekdays = []
  }
  return {
    id: row.id,
    label: row.label,
    time: row.time,
    repeat: row.repeat as RepeatType,
    weekdays,
    intervalValue: row.interval_value,
    intervalUnit: row.interval_unit as IntervalUnit,
    nextFireAt: row.next_fire_at,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastFiredAt: row.last_fired_at
  }
}

/**
 * 提醒的本地持久化存储。
 *
 * 数据保存在注入的 SQLite 数据库（`alarms` 表）中，由 database.ts
 * 负责建表与旧数据迁移；本类只做单表读写。
 */
export class AlarmStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 按 id 读取单条提醒；不存在返回 null */
  private getById(id: string): Alarm | null {
    const row = this.db
      .prepare('SELECT * FROM alarms WHERE id = ?')
      .get(id) as unknown as AlarmRow | undefined
    return row ? rowToAlarm(row) : null
  }

  getAll(): Alarm[] {
    const rows = this.db
      .prepare('SELECT * FROM alarms ORDER BY created_at ASC, rowid ASC')
      .all() as unknown as AlarmRow[]
    return rows.map((row) => rowToAlarm(row))
  }

  create(draft: AlarmDraft): Alarm {
    const alarm: Alarm = {
      id: randomUUID(),
      label: draft.label,
      time: draft.time,
      repeat: draft.repeat,
      weekdays: [...draft.weekdays],
      intervalValue: draft.intervalValue,
      intervalUnit: draft.intervalUnit,
      nextFireAt:
        draft.repeat === 'interval'
          ? Date.now() + getIntervalMs(draft.intervalValue, draft.intervalUnit)
          : null,
      enabled: draft.enabled,
      createdAt: Date.now(),
      lastFiredAt: null
    }
    this.db
      .prepare(
        `INSERT INTO alarms (
          id, label, time, repeat, weekdays, interval_value,
          interval_unit, next_fire_at, enabled, created_at, last_fired_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        alarm.id,
        alarm.label,
        alarm.time,
        alarm.repeat,
        JSON.stringify(alarm.weekdays),
        alarm.intervalValue,
        alarm.intervalUnit,
        alarm.nextFireAt,
        alarm.enabled ? 1 : 0,
        alarm.createdAt,
        alarm.lastFiredAt
      )
    return alarm
  }

  update(id: string, draft: AlarmDraft): Alarm | null {
    const current = this.getById(id)
    if (!current) {
      return null
    }
    const updated: Alarm = {
      ...current,
      label: draft.label,
      time: draft.time,
      repeat: draft.repeat,
      weekdays: [...draft.weekdays],
      intervalValue: draft.intervalValue,
      intervalUnit: draft.intervalUnit,
      nextFireAt:
        draft.repeat === 'interval'
          ? Date.now() + getIntervalMs(draft.intervalValue, draft.intervalUnit)
          : null,
      enabled: draft.enabled
    }
    this.db
      .prepare(
        `UPDATE alarms SET
          label = ?, time = ?, repeat = ?, weekdays = ?, interval_value = ?,
          interval_unit = ?, next_fire_at = ?, enabled = ?
        WHERE id = ?`
      )
      .run(
        updated.label,
        updated.time,
        updated.repeat,
        JSON.stringify(updated.weekdays),
        updated.intervalValue,
        updated.intervalUnit,
        updated.nextFireAt,
        updated.enabled ? 1 : 0,
        id
      )
    return updated
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM alarms WHERE id = ?').run(id)
  }

  setEnabled(id: string, enabled: boolean): Alarm | null {
    const current = this.getById(id)
    if (!current) {
      return null
    }
    const updated: Alarm = { ...current, enabled }
    if (enabled && current.repeat === 'interval') {
      updated.nextFireAt =
        Date.now() + getIntervalMs(current.intervalValue, current.intervalUnit)
    }
    this.db
      .prepare('UPDATE alarms SET enabled = ?, next_fire_at = ? WHERE id = ?')
      .run(updated.enabled ? 1 : 0, updated.nextFireAt, id)
    return updated
  }

  markFired(id: string, at: number, nextFireAt?: number | null): Alarm | null {
    const current = this.getById(id)
    if (!current) {
      return null
    }
    const updated: Alarm = {
      ...current,
      lastFiredAt: at,
      nextFireAt: nextFireAt === undefined ? current.nextFireAt : nextFireAt
    }
    this.db
      .prepare(
        'UPDATE alarms SET last_fired_at = ?, next_fire_at = ? WHERE id = ?'
      )
      .run(updated.lastFiredAt, updated.nextFireAt, id)
    return updated
  }
}
