import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NoteDraft } from '../shared/notes'
import { closeDatabase, openDatabase } from './database'
import { NoteStore } from './note-store'

let db: DatabaseSync
let store: NoteStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new NoteStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 构造一份便签草稿，默认使用默认色且未置顶 */
function makeDraft(overrides: Partial<NoteDraft> = {}): NoteDraft {
  return {
    title: '标题',
    content: '正文',
    color: 'default',
    pinned: false,
    ...overrides
  }
}

/** 直接改写时间戳 / 置顶标记，便于构造确定的排序场景 */
function seedMeta(
  id: string,
  created: number,
  updated: number,
  pinned = 0
): void {
  db.prepare(
    `UPDATE notes SET
      created_at = ?, updated_at = ?, pinned = ?
    WHERE id = ?`
  ).run(created, updated, pinned, id)
}

describe('NoteStore.create', () => {
  it('返回完整便签，createdAt 与 updatedAt 相同', () => {
    const note = store.create(makeDraft())

    expect(note.id).toBeTruthy()
    expect(typeof note.createdAt).toBe('number')
    expect(note.createdAt).toBe(note.updatedAt)
    expect(store.getAll()).toEqual([note])
  })

  it('全部字段正确持久化', () => {
    const note = store.create(
      makeDraft({
        title: '买菜',
        content: '牛奶、鸡蛋',
        color: 'green',
        pinned: true
      })
    )

    expect(note).toMatchObject({
      title: '买菜',
      content: '牛奶、鸡蛋',
      color: 'green',
      pinned: true
    })
    const reloaded = store.getAll()[0]
    expect(reloaded).toEqual(note)
    expect(reloaded.pinned).toBe(true)
    expect(reloaded.color).toBe('green')
  })
})

describe('NoteStore.getAll', () => {
  it('置顶优先，其次 updatedAt 倒序，再按 createdAt 倒序', () => {
    const plainOld = store.create(makeDraft({ title: '旧' }))
    const plainNew = store.create(makeDraft({ title: '新' }))
    const pinnedOld = store.create(makeDraft({ title: '置顶旧' }))
    const tieNewer = store.create(makeDraft({ title: '同更新时间但更晚创建' }))
    const tieOlder = store.create(makeDraft({ title: '同更新时间较早创建' }))

    seedMeta(plainOld.id, 100, 100)
    seedMeta(plainNew.id, 200, 200)
    seedMeta(pinnedOld.id, 50, 50, 1)
    seedMeta(tieNewer.id, 400, 300)
    seedMeta(tieOlder.id, 300, 300)

    expect(store.getAll().map((note) => note.id)).toEqual([
      pinnedOld.id,
      tieNewer.id,
      tieOlder.id,
      plainNew.id,
      plainOld.id
    ])
  })
})

describe('NoteStore.update', () => {
  it('命中时更新字段，createdAt 不变且 updatedAt 不减', () => {
    const created = store.create(
      makeDraft({ title: '旧标题', content: '旧正文' })
    )

    const updated = store.update(
      created.id,
      makeDraft({
        title: '新标题',
        content: '新正文',
        color: 'pink',
        pinned: true
      })
    )

    expect(updated).toMatchObject({
      id: created.id,
      createdAt: created.createdAt,
      title: '新标题',
      content: '新正文',
      color: 'pink',
      pinned: true
    })
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    expect(store.getAll()).toEqual([updated])
  })

  it('未命中时返回 null 且库中数据不变', () => {
    const created = store.create(makeDraft({ title: '保留' }))
    const before = store.getAll()

    expect(store.update('missing', makeDraft({ title: '改' }))).toBeNull()
    expect(store.getAll()).toEqual(before)
    expect(store.getAll()[0].id).toBe(created.id)
  })
})

describe('NoteStore.remove', () => {
  it('删除后不再出现，删除不存在的 id 不抛错', () => {
    const keep = store.create(makeDraft({ title: '保留' }))
    const drop = store.create(makeDraft({ title: '删除' }))

    store.remove(drop.id)

    expect(store.getAll().map((note) => note.id)).toEqual([keep.id])
    expect(() => store.remove('missing')).not.toThrow()
    expect(store.getAll()).toHaveLength(1)
  })
})

describe('NoteStore 脏数据兜底', () => {
  it('颜色非法时读取为 default', () => {
    const created = store.create(makeDraft({ color: 'blue' }))
    db.prepare('UPDATE notes SET color = ? WHERE id = ?').run(
      'purple',
      created.id
    )

    expect(store.getAll()[0].color).toBe('default')
  })
})
