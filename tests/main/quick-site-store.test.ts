import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickSiteDraft } from '../../src/shared/quick-sites'
import { closeDatabase, openDatabase } from '../../src/main/database'
import { QuickSiteStore } from '../../src/main/quick-site-store'

/** UUID v4 格式（node:crypto randomUUID 的输出） */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
    targets: [{ browserId: 'system', profileId: '' }],
    ...overrides
  }
}

/** 读取某行的旧列 */
function readLegacyColumns(
  id: string
): { browser_id: string; profile_id: string } | undefined {
  return db
    .prepare('SELECT browser_id, profile_id FROM quick_sites WHERE id = ?')
    .get(id) as unknown as
    { browser_id: string; profile_id: string } | undefined
}

/** 直接写入一行仅含旧列的数据（targets 使用默认空串） */
function insertLegacyRow(
  id: string,
  url: string,
  browserId: string,
  profileId: string
): void {
  db.prepare(
    `INSERT INTO quick_sites (
      id, name, url, browser_id, profile_id, sort_order,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, '', url, browserId, profileId, 0, 1, 1)
}

describe('QuickSiteStore.create', () => {
  it('创建后能完整读回，网址自动补协议且排序从 0 开始', () => {
    const result = store.create(makeDraft())

    expect(result.ok).toBe(true)
    expect(result.site).toMatchObject({
      name: 'GitHub',
      url: 'https://github.com/',
      targets: [{ browserId: 'system', profileId: '' }],
      sortOrder: 0
    })
    expect(result.site?.id).toMatch(UUID_V4)
    expect(result.site?.createdAt).toBe(result.site?.updatedAt)
    expect(store.getAll()).toEqual([result.site])
  })

  it('两次创建生成不同的 UUID v4 id', () => {
    const first = store.create(makeDraft({ name: 'A', url: 'a.com' }))
    const second = store.create(makeDraft({ name: 'B', url: 'b.com' }))

    expect(first.site?.id).toMatch(UUID_V4)
    expect(second.site?.id).toMatch(UUID_V4)
    expect(first.site?.id).not.toBe(second.site?.id)
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

  it('多目标创建后完整往返并去重保持顺序', () => {
    const result = store.create(
      makeDraft({
        targets: [
          { browserId: 'chrome', profileId: '  P1  ' },
          { browserId: 'edge', profileId: '' },
          { browserId: 'chrome', profileId: 'P1' }
        ]
      })
    )

    expect(result.ok).toBe(true)
    expect(result.site?.targets).toEqual([
      { browserId: 'chrome', profileId: 'P1' },
      { browserId: 'edge', profileId: '' }
    ])
    expect(store.getAll()[0].targets).toEqual(result.site?.targets)
  })

  it('非法浏览器与系统角色在目标中被规整', () => {
    const result = store.create(
      makeDraft({
        targets: [
          {
            browserId: 'unknown' as QuickSiteDraft['targets'][0]['browserId'],
            profileId: 'P1'
          },
          { browserId: 'system', profileId: 'Default' }
        ]
      })
    )

    expect(result.ok).toBe(true)
    expect(result.site?.targets).toEqual([
      { browserId: 'system', profileId: '' }
    ])
    expect(store.getAll()[0].targets).toEqual(result.site?.targets)
  })

  it('非数组 targets 回退系统默认目标', () => {
    const result = store.create(
      makeDraft({
        targets: null as unknown as QuickSiteDraft['targets']
      })
    )

    expect(result.site?.targets).toEqual([
      { browserId: 'system', profileId: '' }
    ])
  })

  it('写入时同步旧列为首个目标', () => {
    const result = store.create(
      makeDraft({
        targets: [
          { browserId: 'chrome', profileId: 'P1' },
          { browserId: 'edge', profileId: 'P2' }
        ]
      })
    )

    expect(readLegacyColumns(result.site?.id ?? '')).toEqual({
      browser_id: 'chrome',
      profile_id: 'P1'
    })
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

  it('旧行 targets 为空时回退旧列生成单个目标', () => {
    insertLegacyRow('legacy', 'https://example.com/', 'chrome', '  P1  ')

    const sites = store.getAll()

    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({
      id: 'legacy',
      name: 'example.com',
      targets: [{ browserId: 'chrome', profileId: 'P1' }]
    })
  })

  it('旧行非法浏览器回退 system 且系统角色清空', () => {
    insertLegacyRow('dirty', 'https://www.example.com/', 'unknown', 'Profile 1')

    const sites = store.getAll()

    expect(sites).toHaveLength(1)
    expect(sites[0].targets).toEqual([{ browserId: 'system', profileId: '' }])
  })

  it('targets JSON 损坏时回退旧列', () => {
    insertLegacyRow('broken', 'https://example.com/', 'edge', 'P1')
    db.prepare('UPDATE quick_sites SET targets = ? WHERE id = ?').run(
      '{',
      'broken'
    )

    expect(store.getAll()[0].targets).toEqual([
      { browserId: 'edge', profileId: 'P1' }
    ])
  })

  it('targets 为空数组时回退旧列', () => {
    insertLegacyRow('empty', 'https://example.com/', 'firefox', '/p1')
    db.prepare('UPDATE quick_sites SET targets = ? WHERE id = ?').run(
      '[]',
      'empty'
    )

    expect(store.getAll()[0].targets).toEqual([
      { browserId: 'firefox', profileId: '/p1' }
    ])
  })

  it('优先读取 targets JSON，忽略旧列', () => {
    insertLegacyRow('multi', 'https://example.com/', 'chrome', 'P1')
    db.prepare('UPDATE quick_sites SET targets = ? WHERE id = ?').run(
      JSON.stringify([
        { browserId: 'chrome', profileId: 'P1' },
        { browserId: 'edge', profileId: 'P2' }
      ]),
      'multi'
    )

    expect(store.getAll()[0].targets).toEqual([
      { browserId: 'chrome', profileId: 'P1' },
      { browserId: 'edge', profileId: 'P2' }
    ])
  })

  it('网址非法的行被过滤，其余行保留', () => {
    insertLegacyRow('bad', 'javascript:alert(1)', 'system', '')
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
      targets: [
        { browserId: 'edge', profileId: 'Personal' },
        { browserId: 'chrome', profileId: '' }
      ]
    })

    expect(result.ok).toBe(true)
    expect(result.site).toMatchObject({
      id: created.site?.id,
      name: '工作台',
      url: 'https://example.com/path',
      targets: [
        { browserId: 'edge', profileId: 'Personal' },
        { browserId: 'chrome', profileId: '' }
      ],
      sortOrder: 0,
      createdAt: 1000,
      updatedAt: 2000
    })
    expect(store.getAll()[0]).toEqual(result.site)
  })

  it('写入时同步旧列为首个目标', () => {
    const created = store.create(makeDraft())

    const result = store.update(created.site?.id ?? '', {
      name: created.site?.name ?? '',
      url: created.site?.url ?? '',
      targets: [{ browserId: 'firefox', profileId: '/p1' }]
    })

    expect(readLegacyColumns(result.site?.id ?? '')).toEqual({
      browser_id: 'firefox',
      profile_id: '/p1'
    })
  })

  it('切换到系统默认浏览器时清空角色', () => {
    const created = store.create(
      makeDraft({ targets: [{ browserId: 'chrome', profileId: 'Default' }] })
    )

    const result = store.update(created.site?.id ?? '', {
      name: created.site?.name ?? '',
      url: created.site?.url ?? '',
      targets: [{ browserId: 'system', profileId: 'Default' }]
    })

    expect(result.site?.targets).toEqual([
      { browserId: 'system', profileId: '' }
    ])
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
