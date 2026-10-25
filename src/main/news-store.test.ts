import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from './database'
import { NEWS_PLATFORMS_KEY, NewsStore } from './news-store'

let db: DatabaseSync
let store: NewsStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new NewsStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 统计 settings 表中 newsPlatforms 的记录数 */
function countPlatformRows(): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?')
    .get(NEWS_PLATFORMS_KEY) as unknown as { n: number }
  return row.n
}

describe('NewsStore 空库', () => {
  it('getPlatforms 返回默认四个平台', () => {
    expect(store.getPlatforms()).toEqual(['baidu', 'weibo', 'zhihu', '36kr'])
  })
})

describe('NewsStore.setPlatforms', () => {
  it('写入合法平台后重新读取一致', () => {
    expect(store.setPlatforms(['github'])).toEqual(['github'])
    expect(store.getPlatforms()).toEqual(['github'])
    expect(new NewsStore(db).getPlatforms()).toEqual(['github'])
  })

  it('过滤非法项并去重', () => {
    expect(store.setPlatforms(['github', 'nope', 'github', 123])).toEqual([
      'github'
    ])
    expect(store.getPlatforms()).toEqual(['github'])
  })

  it('输出按 NEWS_PLATFORMS 顺序而非传入顺序', () => {
    expect(store.setPlatforms(['36kr', 'baidu'])).toEqual(['baidu', '36kr'])
    expect(store.getPlatforms()).toEqual(['baidu', '36kr'])
  })

  it('空数组 / 非数组 / null 回退默认值', () => {
    expect(store.setPlatforms([])).toEqual(['baidu', 'weibo', 'zhihu', '36kr'])
    expect(store.setPlatforms('nope')).toEqual([
      'baidu',
      'weibo',
      'zhihu',
      '36kr'
    ])
    expect(store.setPlatforms(null)).toEqual([
      'baidu',
      'weibo',
      'zhihu',
      '36kr'
    ])
  })

  it('重复写入覆盖旧值且表中只有一条记录', () => {
    store.setPlatforms(['github'])
    store.setPlatforms(['36kr', 'baidu'])

    expect(store.getPlatforms()).toEqual(['baidu', '36kr'])
    expect(countPlatformRows()).toBe(1)
  })
})

describe('NewsStore.getPlatforms 损坏数据', () => {
  it('settings 中非法 JSON 回退默认且不抛错', () => {
    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(NEWS_PLATFORMS_KEY, 'not-json')

    expect(() => store.getPlatforms()).not.toThrow()
    expect(store.getPlatforms()).toEqual(['baidu', 'weibo', 'zhihu', '36kr'])
  })

  it('settings 中值为空数组时回退默认', () => {
    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(NEWS_PLATFORMS_KEY, '[]')

    expect(store.getPlatforms()).toEqual(['baidu', 'weibo', 'zhihu', '36kr'])
  })
})
