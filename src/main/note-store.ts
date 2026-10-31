import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  isNoteColor,
  normalizeNoteCategory,
  type Note,
  type NoteDraft
} from '../shared/notes'
import type { NoteRow } from './database'

/** 列名与 Note 字段之间的转换 */
function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    // 脏数据（非法颜色）回退为默认色
    color: isNoteColor(row.color) ? row.color : 'default',
    category: normalizeNoteCategory(row.category),
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
      category: normalizeNoteCategory(draft.category),
      pinned: draft.pinned,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO notes (
          id, title, content, color, category, pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        note.id,
        note.title,
        note.content,
        note.color,
        note.category,
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
      category: normalizeNoteCategory(draft.category),
      pinned: draft.pinned,
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        `UPDATE notes SET
          title = ?, content = ?, color = ?, category = ?, pinned = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        updated.title,
        updated.content,
        updated.color,
        updated.category,
        updated.pinned ? 1 : 0,
        updated.updatedAt,
        id
      )
    return updated
  }

  /** 批量设置分类：仅改写 category 列，不动 updated_at */
  setCategory(ids: string[], category: string): number {
    if (!Array.isArray(ids) || ids.length === 0) {
      return 0
    }
    const target = normalizeNoteCategory(category)
    let affected = 0
    const statement = this.db.prepare(
      'UPDATE notes SET category = ? WHERE id = ?'
    )
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') {
        continue
      }
      const result = statement.run(target, id)
      affected += Number(result.changes)
    }
    return affected
  }

  /** 批量重命名分类：目标已存在时自然合并，不动 updated_at */
  renameCategory(from: string, to: string): number {
    const source = normalizeNoteCategory(from)
    const target = normalizeNoteCategory(to)
    if (source === '' || target === '' || source === target) {
      return 0
    }
    const result = this.db
      .prepare('UPDATE notes SET category = ? WHERE category = ?')
      .run(target, source)
    return Number(result.changes)
  }

  /** 删除分类：相关便签回落为未分类，不动 updated_at */
  removeCategory(name: string): number {
    const source = normalizeNoteCategory(name)
    if (source === '') {
      return 0
    }
    const result = this.db
      .prepare("UPDATE notes SET category = '' WHERE category = ?")
      .run(source)
    return Number(result.changes)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
  }
}
