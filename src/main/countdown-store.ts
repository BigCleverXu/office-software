import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  COUNTDOWN_TITLE_MAX_LENGTH,
  isDateOnly,
  type Countdown,
  type CountdownDraft
} from '../shared/calendar'
import type { CountdownRow } from './database'

/** 列名与 Countdown 字段之间的转换 */
function rowToCountdown(row: CountdownRow): Countdown {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 校验并规范化倒计日草稿，返回 trim 后的标题。
 * 标题为空、超长或日期非法时抛出对应错误。
 */
function normalizeDraft(draft: CountdownDraft): {
  title: string
  date: string
} {
  const title = draft.title.trim()
  if (title === '') {
    throw new Error('标题不能为空')
  }
  if (title.length > COUNTDOWN_TITLE_MAX_LENGTH) {
    throw new Error('标题不能超过 50 个字符')
  }
  if (!isDateOnly(draft.date)) {
    throw new Error('日期格式不合法')
  }
  return { title, date: draft.date }
}

/**
 * 倒计日的本地持久化存储。
 *
 * 数据保存在注入的 SQLite 数据库（`countdowns` 表）中，由 database.ts
 * 负责建表；本类只做单表读写。
 */
export class CountdownStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 按 id 读取单条倒计日；不存在返回 null */
  private getById(id: string): Countdown | null {
    const row = this.db
      .prepare('SELECT * FROM countdowns WHERE id = ?')
      .get(id) as unknown as CountdownRow | undefined
    return row ? rowToCountdown(row) : null
  }

  /** 按日期升序返回全部倒计日，同日期按创建时间升序 */
  getAll(): Countdown[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM countdowns
        ORDER BY date ASC, created_at ASC`
      )
      .all() as unknown as CountdownRow[]
    return rows.map((row) => rowToCountdown(row))
  }

  create(draft: CountdownDraft): Countdown {
    const { title, date } = normalizeDraft(draft)
    const now = Date.now()
    const countdown: Countdown = {
      id: randomUUID(),
      title,
      date,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO countdowns (
          id, title, date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        countdown.id,
        countdown.title,
        countdown.date,
        countdown.createdAt,
        countdown.updatedAt
      )
    return countdown
  }

  update(id: string, draft: CountdownDraft): Countdown | null {
    const current = this.getById(id)
    if (!current) {
      return null
    }
    const { title, date } = normalizeDraft(draft)
    const updated: Countdown = {
      ...current,
      title,
      date,
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        `UPDATE countdowns SET
          title = ?, date = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(updated.title, updated.date, updated.updatedAt, id)
    return updated
  }

  /** 删除指定倒计日；id 不存在时静默返回 */
  remove(id: string): void {
    this.db.prepare('DELETE FROM countdowns WHERE id = ?').run(id)
  }
}
