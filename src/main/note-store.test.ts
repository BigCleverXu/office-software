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

/** 构造一份便签草稿，默认使用默认色、无分类且未置顶 */
function makeDraft(overrides: Partial<NoteDraft> = {}): NoteDraft {
  return {
    title: '标题',
    content: '正文',
    category: '',
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

  it('带分类创建后能正确读回', () => {
    const note = store.create(makeDraft({ category: '工作' }))

    expect(note.category).toBe('工作')
    expect(store.getAll()[0].category).toBe('工作')
  })

  it('分类去除首尾空格并截断到 12 个字符', () => {
    const note = store.create(
      makeDraft({ category: '  这是一个超过十二个字符的分类  ' })
    )

    expect(note.category).toBe('这是一个超过十二个字符的')
    expect(store.getAll()[0].category).toBe('这是一个超过十二个字符的')
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

  it('更新时能改写分类，且 updatedAt 正常更新', () => {
    const created = store.create(makeDraft({ category: '工作' }))

    const updated = store.update(
      created.id,
      makeDraft({ category: '生活', title: '改标题' })
    )

    expect(updated?.category).toBe('生活')
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    expect(store.getAll()[0].category).toBe('生活')
  })

  it('仅更新置顶且分类相同时分类保持不变', () => {
    const created = store.create(makeDraft({ category: '工作' }))

    const updated = store.update(
      created.id,
      makeDraft({ category: '工作', pinned: true })
    )

    expect(updated?.pinned).toBe(true)
    expect(updated?.category).toBe('工作')
    expect(store.getAll()[0].category).toBe('工作')
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

describe('NoteStore.setCategory', () => {
  it('只更新指定 id 的分类并返回受影响条数', () => {
    const first = store.create(makeDraft({ title: 'A', category: '旧' }))
    const second = store.create(makeDraft({ title: 'B', category: '旧' }))
    const keep = store.create(makeDraft({ title: 'C', category: '旧' }))

    expect(store.setCategory([first.id, second.id], '工作')).toBe(2)

    const byId = new Map(store.getAll().map((note) => [note.id, note]))
    expect(byId.get(first.id)?.category).toBe('工作')
    expect(byId.get(second.id)?.category).toBe('工作')
    expect(byId.get(keep.id)?.category).toBe('旧')
  })

  it('规整分类：去空格、超长截断、空串取消分类', () => {
    const note = store.create(makeDraft({ category: '旧' }))

    expect(store.setCategory([note.id], '  工作  ')).toBe(1)
    expect(store.getAll()[0].category).toBe('工作')

    expect(store.setCategory([note.id], '一二三四五六七八九十甲乙丙')).toBe(1)
    expect(store.getAll()[0].category).toBe('一二三四五六七八九十甲乙')

    expect(store.setCategory([note.id], '')).toBe(1)
    expect(store.getAll()[0].category).toBe('')
  })

  it('不改变 updatedAt，也不改变 getAll 排序', () => {
    const old = store.create(makeDraft({ title: '旧' }))
    const fresh = store.create(makeDraft({ title: '新' }))
    seedMeta(old.id, 100, 100)
    seedMeta(fresh.id, 200, 200)
    const before = store.getAll()

    store.setCategory([old.id, fresh.id], '批量')

    expect(store.getAll().map((note) => note.id)).toEqual(
      before.map((note) => note.id)
    )
    expect(store.getAll().map((note) => note.updatedAt)).toEqual(
      before.map((note) => note.updatedAt)
    )
  })

  it('空数组与全部未知 id 返回 0 且数据不变', () => {
    store.create(makeDraft({ category: '工作' }))

    expect(store.setCategory([], '生活')).toBe(0)
    expect(store.setCategory(['missing', 'another'], '生活')).toBe(0)
    expect(store.getAll()[0].category).toBe('工作')
  })
})

describe('NoteStore.renameCategory', () => {
  it('批量改名返回条数，updatedAt 与排序不变', () => {
    const first = store.create(makeDraft({ title: 'A', category: '工作' }))
    const second = store.create(makeDraft({ title: 'B', category: '工作' }))
    const other = store.create(makeDraft({ title: 'C', category: '生活' }))
    seedMeta(first.id, 100, 100)
    seedMeta(second.id, 200, 200)
    seedMeta(other.id, 300, 300)
    const before = store.getAll()

    expect(store.renameCategory('  工作  ', '职场')).toBe(2)

    expect(store.getAll().map((note) => note.id)).toEqual(
      before.map((note) => note.id)
    )
    expect(store.getAll().map((note) => note.updatedAt)).toEqual(
      before.map((note) => note.updatedAt)
    )
    const byId = new Map(store.getAll().map((note) => [note.id, note]))
    expect(byId.get(first.id)?.category).toBe('职场')
    expect(byId.get(second.id)?.category).toBe('职场')
    expect(byId.get(other.id)?.category).toBe('生活')
  })

  it('目标分类已存在时合并，便签总数不变', () => {
    const first = store.create(makeDraft({ title: 'A', category: '工作' }))
    const second = store.create(makeDraft({ title: 'B', category: '职场' }))
    const other = store.create(makeDraft({ title: 'C', category: '生活' }))

    expect(store.renameCategory('工作', '职场')).toBe(1)

    const notes = store.getAll()
    expect(notes).toHaveLength(3)
    expect(
      notes
        .filter((note) => note.category === '职场')
        .map((note) => note.id)
        .sort()
    ).toEqual([first.id, second.id].sort())
    expect(notes.find((note) => note.id === other.id)?.category).toBe('生活')
  })

  it('from/to 为空或同名返回 0 且数据不变', () => {
    store.create(makeDraft({ category: '工作' }))

    expect(store.renameCategory('', '生活')).toBe(0)
    expect(store.renameCategory('工作', '')).toBe(0)
    expect(store.renameCategory('  工作  ', '工作')).toBe(0)
    expect(store.getAll()[0].category).toBe('工作')
  })
})

describe('NoteStore.removeCategory', () => {
  it('该分类清空为未分类，其余便签与其他分类不受影响', () => {
    const first = store.create(makeDraft({ title: 'A', category: '工作' }))
    const second = store.create(makeDraft({ title: 'B', category: '工作' }))
    const other = store.create(makeDraft({ title: 'C', category: '生活' }))
    seedMeta(first.id, 100, 100)
    seedMeta(second.id, 200, 200)
    seedMeta(other.id, 300, 300)

    expect(store.removeCategory('  工作  ')).toBe(2)

    const notes = store.getAll()
    expect(notes).toHaveLength(3)
    expect(notes.find((note) => note.id === first.id)?.category).toBe('')
    expect(notes.find((note) => note.id === second.id)?.category).toBe('')
    expect(notes.find((note) => note.id === other.id)?.category).toBe('生活')
    expect(notes.map((note) => note.updatedAt)).toEqual([300, 200, 100])
  })

  it('未知分类或空字符串返回 0', () => {
    store.create(makeDraft({ category: '工作' }))

    expect(store.removeCategory('生活')).toBe(0)
    expect(store.removeCategory('')).toBe(0)
    expect(store.removeCategory('   ')).toBe(0)
    expect(store.getAll()[0].category).toBe('工作')
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
