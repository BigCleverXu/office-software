import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CountdownDraft } from '../shared/calendar'
import { CountdownStore } from './countdown-store'
import { closeDatabase, openDatabase } from './database'

let db: DatabaseSync
let store: CountdownStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new CountdownStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 构造一份倒计日草稿 */
function makeDraft(overrides: Partial<CountdownDraft> = {}): CountdownDraft {
  return {
    title: '春节',
    date: '2026-02-17',
    ...overrides
  }
}

describe('CountdownStore.create', () => {
  it('返回完整倒计日，createdAt 与 updatedAt 相同', () => {
    const item = store.create(makeDraft())

    expect(item.id).toBeTruthy()
    expect(typeof item.createdAt).toBe('number')
    expect(item.createdAt).toBe(item.updatedAt)
    expect(store.getAll()).toEqual([item])
  })

  it('全部字段正确持久化，标题自动 trim', () => {
    const item = store.create(
      makeDraft({ title: '  结婚纪念日  ', date: '2026-05-20' })
    )

    expect(item).toMatchObject({
      title: '结婚纪念日',
      date: '2026-05-20'
    })
    const reloaded = store.getAll()[0]
    expect(reloaded).toEqual(item)
    expect(reloaded.title).toBe('结婚纪念日')
  })
})

describe('CountdownStore.getAll', () => {
  it('按日期升序返回，同日期按创建时间升序', () => {
    const later = store.create(makeDraft({ title: '较晚', date: '2026-12-01' }))
    const sameDateLater = store.create(
      makeDraft({ title: '同日期较晚创建', date: '2026-03-01' })
    )
    const sameDateEarlier = store.create(
      makeDraft({ title: '同日期较早创建', date: '2026-03-01' })
    )
    const earliest = store.create(
      makeDraft({ title: '最早', date: '2026-01-05' })
    )

    // 直接改写创建时间，构造确定的同日期排序场景
    db.prepare('UPDATE countdowns SET created_at = ? WHERE id = ?').run(
      200,
      sameDateLater.id
    )
    db.prepare('UPDATE countdowns SET created_at = ? WHERE id = ?').run(
      100,
      sameDateEarlier.id
    )

    expect(store.getAll().map((item) => item.id)).toEqual([
      earliest.id,
      sameDateEarlier.id,
      sameDateLater.id,
      later.id
    ])
  })
})

describe('CountdownStore.update', () => {
  it('命中时更新字段，createdAt 不变且 updatedAt 刷新', () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1000)
    const created = store.create(makeDraft({ title: '旧标题' }))
    nowSpy.mockReturnValue(2000)

    try {
      const updated = store.update(
        created.id,
        makeDraft({ title: ' 新标题 ', date: '2026-06-18' })
      )

      expect(updated).toMatchObject({
        id: created.id,
        title: '新标题',
        date: '2026-06-18',
        createdAt: 1000,
        updatedAt: 2000
      })
      expect(updated?.createdAt).toBe(created.createdAt)
      expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt)
      expect(store.getAll()).toEqual([updated])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('未命中时返回 null 且库中数据不变', () => {
    const created = store.create(makeDraft({ title: '保留' }))
    const before = store.getAll()

    expect(store.update('missing', makeDraft({ title: '改' }))).toBeNull()
    expect(store.getAll()).toEqual(before)
    expect(store.getAll()[0].id).toBe(created.id)
  })
})

describe('CountdownStore.remove', () => {
  it('删除后不再出现，重复删除不抛错', () => {
    const keep = store.create(makeDraft({ title: '保留' }))
    const drop = store.create(makeDraft({ title: '删除', date: '2026-09-09' }))

    store.remove(drop.id)

    expect(store.getAll().map((item) => item.id)).toEqual([keep.id])
    expect(() => store.remove(drop.id)).not.toThrow()
    expect(() => store.remove('missing')).not.toThrow()
    expect(store.getAll()).toHaveLength(1)
  })
})

describe('CountdownStore 草稿校验', () => {
  it('空标题抛错且不写入', () => {
    expect(() => store.create(makeDraft({ title: '' }))).toThrow('标题不能为空')
    expect(store.getAll()).toHaveLength(0)
  })

  it('纯空白标题抛错且不写入', () => {
    expect(() => store.create(makeDraft({ title: '   ' }))).toThrow(
      '标题不能为空'
    )
    expect(store.getAll()).toHaveLength(0)
  })

  it('超长标题抛错且不写入', () => {
    expect(() => store.create(makeDraft({ title: '长'.repeat(51) }))).toThrow(
      '标题不能超过 50 个字符'
    )
    expect(store.getAll()).toHaveLength(0)
  })

  it('恰好 50 个字符的标题允许保存', () => {
    const title = '长'.repeat(50)
    expect(store.create(makeDraft({ title })).title).toBe(title)
    expect(store.getAll()).toHaveLength(1)
  })

  it('非法日期抛错且不写入', () => {
    const invalidDates = [
      '2026-02-29',
      '2026-2-3',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      'not-a-date',
      ''
    ]
    for (const date of invalidDates) {
      expect(() => store.create(makeDraft({ date }))).toThrow('日期格式不合法')
    }
    expect(store.getAll()).toHaveLength(0)
  })

  it('更新时校验失败不改变原数据', () => {
    const created = store.create(makeDraft({ title: '原标题' }))
    const before = store.getAll()

    expect(() => store.update(created.id, makeDraft({ title: '   ' }))).toThrow(
      '标题不能为空'
    )
    expect(() =>
      store.update(created.id, makeDraft({ date: '2026-02-29' }))
    ).toThrow('日期格式不合法')
    expect(store.getAll()).toEqual(before)
  })
})
