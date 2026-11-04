import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickSiteDraft } from '../shared/quick-sites'
import { closeDatabase, openDatabase } from './database'
import { QuickSiteStore } from './quick-site-store'

let db: DatabaseSync
let store: QuickSiteStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new QuickSiteStore(db)
})

afterEach(() => {
  closeDatabase(db)
  vi.restoreAllMocks()
})

/** 构造一份站点草稿 */
function makeDraft(overrides: Partial<QuickSiteDraft> = {}): QuickSiteDraft {
  return {
    name: 'GitHub',
    url: 'github.com',
    browserId: 'system',
    profileId: '',
    ...overrides
  }
}

describe('QuickSiteStore.create', () => {
  it('创建后能完整读回，网址自动补协议且排序从 0 开始', () => {
    const result = store.create(makeDraft())

    expect(result.ok).toBe(true)
    expect(result.site).toMatchObject({
      name: 'GitHub',
      url: 'https://github.com/',
      browserId: 'system',
      profileId: '',
      sortOrder: 0
    })
    expect(result.site?.id).toBeTruthy()
    expect(result.site?.createdAt).toBe(result.site?.updatedAt)
    expect(store.getAll()).toEqual([result.site])
  })

  it('名称留空时回退为去掉 www. 的域名', () => {
    const result = store.create(
      makeDraft({ name: '   ', url: 'https://www.bilibili.com/video' })
    )

    expect(result.ok).toBe(true)
    expect(result.site?.name).toBe('bilibili.com')
    expect(store.getAll()[0].name).toBe('bilibili.com')
  })

  it('非法网址被拒绝且不写入数据库', () => {
    const result = store.create(makeDraft({ url: 'javascript:alert(1)' }))

    expect(result).toEqual({
      ok: false,
      error: '请输入 http / https 开头的网址'
    })
    expect(store.getAll()).toEqual([])
  })

  it('非法浏览器 id 回退 system，且 system 清空角色', () => {
    const result = store.create(
      makeDraft({
        browserId: 'unknown' as QuickSiteDraft['browserId'],
        profileId: 'Default'
      })
    )

    expect(result.ok).toBe(true)
    expect(result.site?.browserId).toBe('system')
    expect(result.site?.profileId).toBe('')
    expect(store.getAll()[0].profileId).toBe('')
  })

  it('非 system 浏览器保留并规整角色', () => {
    const result = store.create(
      makeDraft({ browserId: 'chrome', profileId: '  Profile 1  ' })
    )

    expect(result.site?.profileId).toBe('Profile 1')
    expect(store.getAll()[0]).toEqual(result.site)
  })
})

describe('QuickSiteStore.getAll', () => {
  it('按 sortOrder 升序，删除后新增站点追加在末尾', () => {
    const first = store.create(makeDraft({ name: 'A', url: 'a.com' }))
    const second = store.create(makeDraft({ name: 'B', url: 'b.com' }))
    const third = store.create(makeDraft({ name: 'C', url: 'c.com' }))

    expect(store.getAll().map((site) => site.name)).toEqual(['A', 'B', 'C'])
    store.remove(second.site?.id ?? '')

    const added = store.create(makeDraft({ name: 'D', url: 'd.com' }))
    expect(added.site?.sortOrder).toBe(3)
    expect(store.getAll().map((site) => site.name)).toEqual(['A', 'C', 'D'])
    expect(store.getAll().map((site) => site.sortOrder)).toEqual([0, 2, 3])
    expect(store.getById(third.site?.id ?? '')?.name).toBe('C')
    expect(store.getById(first.site?.id ?? '')).not.toBeNull()
  })

  it('脏数据降级：非法浏览器回退 system、system 清空角色', () => {
    db.prepare(
      `INSERT INTO quick_sites (
        id, name, url, browser_id, profile_id, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'dirty',
      '',
      'https://www.example.com/',
      'unknown',
      'Profile 1',
      0,
      1,
      1
    )

    const sites = store.getAll()

    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({
      id: 'dirty',
      name: 'example.com',
      browserId: 'system',
      profileId: ''
    })
  })

  it('网址非法的行被过滤，其余行保留', () => {
    db.prepare(
      `INSERT INTO quick_sites (
        id, name, url, browser_id, profile_id, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('bad', '坏数据', 'javascript:alert(1)', 'system', '', 0, 1, 1)
    store.create(makeDraft({ name: '好数据', url: 'example.com' }))

    expect(store.getAll().map((site) => site.id)).not.toContain('bad')
    expect(store.getAll()).toHaveLength(1)
    expect(store.getById('bad')).toBeNull()
  })
})

describe('QuickSiteStore.update', () => {
  it('更新字段且保留 createdAt，updatedAt 前进', () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1000)
    const created = store.create(makeDraft())
    nowSpy.mockReturnValue(2000)

    const result = store.update(created.site?.id ?? '', {
      name: '工作台',
      url: 'https://example.com/path',
      browserId: 'edge',
      profileId: 'Personal'
    })

    expect(result.ok).toBe(true)
    expect(result.site).toMatchObject({
      id: created.site?.id,
      name: '工作台',
      url: 'https://example.com/path',
      browserId: 'edge',
      profileId: 'Personal',
      sortOrder: 0,
      createdAt: 1000,
      updatedAt: 2000
    })
    expect(store.getAll()[0]).toEqual(result.site)
  })

  it('切换到系统默认浏览器时清空角色', () => {
    const created = store.create(
      makeDraft({ browserId: 'chrome', profileId: 'Default' })
    )

    const result = store.update(created.site?.id ?? '', {
      name: created.site?.name ?? '',
      url: created.site?.url ?? '',
      browserId: 'system',
      profileId: 'Default'
    })

    expect(result.site?.browserId).toBe('system')
    expect(result.site?.profileId).toBe('')
  })

  it('站点不存在时返回站点不存在', () => {
    const result = store.update('missing', makeDraft())

    expect(result).toEqual({ ok: false, error: '站点不存在' })
  })

  it('更新为非法网址时拒绝且原数据不变', () => {
    const created = store.create(makeDraft())
    const before = store.getAll()

    const result = store.update(
      created.site?.id ?? '',
      makeDraft({ url: 'file:///etc/passwd' })
    )

    expect(result).toEqual({
      ok: false,
      error: '请输入 http / https 开头的网址'
    })
    expect(store.getAll()).toEqual(before)
  })
})

describe('QuickSiteStore.remove', () => {
  it('删除后不再出现，删除不存在的 id 不抛错', () => {
    const keep = store.create(makeDraft({ name: '保留' }))
    const drop = store.create(makeDraft({ name: '删除' }))

    store.remove(drop.site?.id ?? '')

    expect(store.getAll().map((site) => site.id)).toEqual([keep.site?.id])
    expect(() => store.remove('missing')).not.toThrow()
    expect(store.getAll()).toHaveLength(1)
  })
})
