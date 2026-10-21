import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { isNoteColor, type Note, type NoteDraft } from '../shared/notes'
import type { NoteRow } from './database'

/** 列名与 Note 字段之间的转换 */
function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    // 脏数据（非法颜色）回退为默认色
    color: isNoteColor(row.color) ? row.color : 'default',
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 便签的本地持久化存储。
 *
 * 数据保存在注入的 SQLite 数据库（`notes` 表）中，由 database.ts
 * 负责建表；本类只做单表读写。
 */
export class NoteStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 按 id 读取单条便签；不存在返回 null */
  private getById(id: string): Note | null {
    const row = this.db
      .prepare('SELECT * FROM notes WHERE id = ?')
      .get(id) as unknown as NoteRow | undefined
    return row ? rowToNote(row) : null
  }

  getAll(): Note[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notes
        ORDER BY pinned DESC, updated_at DESC, created_at DESC`
      )
      .all() as unknown as NoteRow[]
    return rows.map((row) => rowToNote(row))
  }

  create(draft: NoteDraft): Note {
    const now = Date.now()
    const note: Note = {
      id: randomUUID(),
      title: draft.title,
      content: draft.content,
      color: draft.color,
      pinned: draft.pinned,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO notes (
          id, title, content, color, pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        note.id,
        note.title,
        note.content,
        note.color,
        note.pinned ? 1 : 0,
        note.createdAt,
        note.updatedAt
      )
    return note
  }

  update(id: string, draft: NoteDraft): Note | null {
    const current = this.getById(id)
    if (!current) {
      return null
    }
    const updated: Note = {
      ...current,
      title: draft.title,
      content: draft.content,
      color: draft.color,
      pinned: draft.pinned,
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        `UPDATE notes SET
          title = ?, content = ?, color = ?, pinned = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        updated.title,
        updated.content,
        updated.color,
        updated.pinned ? 1 : 0,
        updated.updatedAt,
        id
      )
    return updated
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
  }
}
