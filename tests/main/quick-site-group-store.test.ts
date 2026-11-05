import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QuickSiteGroupDraft } from '../../src/shared/quick-sites'
import { closeDatabase, openDatabase } from '../../src/main/database'
import { QuickSiteGroupStore } from '../../src/main/quick-site-group-store'
import { QuickSiteStore } from '../../src/main/quick-site-store'

let db: DatabaseSync
let siteStore: QuickSiteStore
let groupStore: QuickSiteGroupStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  siteStore = new QuickSiteStore(db)
  groupStore = new QuickSiteGroupStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 创建一个站点并返回其 id */
function makeSite(name: string, url: string): string {
  return (
    siteStore.create({
      name,
      url,
      targets: [{ browserId: 'system', profileId: '' }]
    }).site?.id ?? ''
  )
}

/** 构造一份编组草稿 */
function makeDraft(
  overrides: Partial<QuickSiteGroupDraft> = {}
): QuickSiteGroupDraft {
  return {
    name: '工作',
    siteIds: [],
    ...overrides
  }
}

describe('QuickSiteGroupStore.create', () => {
  it('创建后能完整读回，站点 id 去重且排序从 0 开始', () => {
    const first = makeSite('GitHub', 'github.com')
    const second = makeSite('Bilibili', 'bilibili.com')

    const result = groupStore.create(
      makeDraft({ name: '  工作  ', siteIds: [first, second, first] })
    )

    expect(result.ok).toBe(true)
    expect(result.group).toMatchObject({
      name: '工作',
      siteIds: [first, second],
      sortOrder: 0
    })
    expect(result.group?.id).toBeTruthy()
    expect(result.group?.createdAt).toBe(result.group?.updatedAt)
    expect(groupStore.getAll()).toEqual([result.group])
    expect(groupStore.getById(result.group?.id ?? '')).toEqual(result.group)
  })

  it('名称为空时返回错误且不写入数据库', () => {
    const siteId = makeSite('GitHub', 'github.com')

    const result = groupStore.create(
      makeDraft({ name: '   ', siteIds: [siteId] })
    )

    expect(result).toEqual({ ok: false, error: '请输入编组名称' })
    expect(groupStore.getAll()).toEqual([])
  })

  it('未选择有效站点时返回错误且不写入数据库', () => {
    const result = groupStore.create(makeDraft({ siteIds: [] }))
    expect(result).toEqual({ ok: false, error: '请至少选择一个网站' })

    const missing = groupStore.create(makeDraft({ siteIds: ['missing'] }))
    expect(missing).toEqual({ ok: false, error: '请至少选择一个网站' })
    expect(groupStore.getAll()).toEqual([])
  })

  it('过滤不存在的站点 id，仅保留有效站点', () => {
    const siteId = makeSite('GitHub', 'github.com')

    const result = groupStore.create(
      makeDraft({ siteIds: [siteId, 'missing', siteId] })
    )

    expect(result.ok).toBe(true)
    expect(result.group?.siteIds).toEqual([siteId])
    expect(groupStore.getAll()[0].siteIds).toEqual([siteId])
  })
})

describe('QuickSiteGroupStore.getAll', () => {
  it('读取时过滤不存在站点，非法 site_ids 回退为空数组', () => {
    const siteId = makeSite('GitHub', 'github.com')
    const created = groupStore.create(makeDraft({ siteIds: [siteId] }))
    const groupId = created.group?.id ?? ''

    // 直接写入脏数据：包含不存在的站点与非法 JSON
    db.prepare('UPDATE quick_site_groups SET site_ids = ? WHERE id = ?').run(
      JSON.stringify([siteId, 'missing']),
      groupId
    )
    expect(groupStore.getById(groupId)?.siteIds).toEqual([siteId])

    db.prepare('UPDATE quick_site_groups SET site_ids = ? WHERE id = ?').run(
      '{',
      groupId
    )
    expect(groupStore.getById(groupId)?.siteIds).toEqual([])
  })

  it('过滤后为空的编组仍正常返回', () => {
    const siteId = makeSite('GitHub', 'github.com')
    const created = groupStore.create(makeDraft({ siteIds: [siteId] }))

    siteStore.remove(siteId)

    const groups = groupStore.getAll()
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe(created.group?.id)
    expect(groups[0].siteIds).toEqual([])
  })

  it('按 sortOrder 升序，删除后新增编组追加在末尾', () => {
    const siteId = makeSite('GitHub', 'github.com')
    const first = groupStore.create(makeDraft({ name: 'A', siteIds: [siteId] }))
    const second = groupStore.create(
      makeDraft({ name: 'B', siteIds: [siteId] })
    )
    const third = groupStore.create(makeDraft({ name: 'C', siteIds: [siteId] }))

    expect(groupStore.getAll().map((group) => group.name)).toEqual([
      'A',
      'B',
      'C'
    ])
    groupStore.remove(second.group?.id ?? '')

    const added = groupStore.create(makeDraft({ name: 'D', siteIds: [siteId] }))
    expect(added.group?.sortOrder).toBe(3)
    expect(groupStore.getAll().map((group) => group.name)).toEqual([
      'A',
      'C',
      'D'
    ])
    expect(groupStore.getAll().map((group) => group.sortOrder)).toEqual([
      0, 2, 3
    ])
    expect(groupStore.getById(third.group?.id ?? '')?.name).toBe('C')
    expect(groupStore.getById(first.group?.id ?? '')).not.toBeNull()
  })
})

describe('QuickSiteGroupStore.update', () => {
  it('更新字段且保留 createdAt / sortOrder', () => {
    const first = makeSite('GitHub', 'github.com')
    const second = makeSite('Bilibili', 'bilibili.com')
    const created = groupStore.create(makeDraft({ siteIds: [first] }))

    const result = groupStore.update(created.group?.id ?? '', {
      name: '  日常  ',
      siteIds: [second, first, second]
    })

    expect(result.ok).toBe(true)
    expect(result.group).toMatchObject({
      id: created.group?.id,
      name: '日常',
      siteIds: [second, first],
      sortOrder: 0,
      createdAt: created.group?.createdAt
    })
    expect(groupStore.getAll()[0]).toEqual(result.group)
  })

  it('编组不存在时返回编组不存在', () => {
    const result = groupStore.update('missing', makeDraft())

    expect(result).toEqual({ ok: false, error: '编组不存在' })
  })

  it('名称或站点为空时拒绝且原数据不变', () => {
    const siteId = makeSite('GitHub', 'github.com')
    const created = groupStore.create(makeDraft({ siteIds: [siteId] }))
    const before = groupStore.getAll()

    expect(
      groupStore.update(created.group?.id ?? '', makeDraft({ name: '  ' }))
    ).toEqual({ ok: false, error: '请输入编组名称' })
    expect(
      groupStore.update(created.group?.id ?? '', makeDraft({ siteIds: [] }))
    ).toEqual({ ok: false, error: '请至少选择一个网站' })
    expect(groupStore.getAll()).toEqual(before)
  })
})

describe('QuickSiteGroupStore.remove', () => {
  it('删除后不再出现，删除不存在的 id 不抛错', () => {
    const siteId = makeSite('GitHub', 'github.com')
    const keep = groupStore.create(
      makeDraft({ name: '保留', siteIds: [siteId] })
    )
    const drop = groupStore.create(
      makeDraft({ name: '删除', siteIds: [siteId] })
    )

    groupStore.remove(drop.group?.id ?? '')

    expect(groupStore.getAll().map((group) => group.id)).toEqual([
      keep.group?.id
    ])
    expect(() => groupStore.remove('missing')).not.toThrow()
    expect(groupStore.getAll()).toHaveLength(1)
  })
})
