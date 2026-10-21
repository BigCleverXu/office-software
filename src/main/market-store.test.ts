import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MODULE } from '../shared/navigation'
import type { MarketId } from '../shared/market'
import { closeDatabase, openDatabase } from './database'
import { MarketStore } from './market-store'

interface WatchInput {
  code: string
  symbol: string
  market: MarketId
  name: string
}

let db: DatabaseSync
let store: MarketStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new MarketStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

const maotai: WatchInput = {
  code: '600519',
  symbol: 'sh600519',
  market: 'sh',
  name: '贵州茅台'
}

const pingan: WatchInput = {
  code: '000001',
  symbol: 'sz000001',
  market: 'sz',
  name: '平安银行'
}

describe('MarketStore 空库', () => {
  it('getWatchlist 为空数组，getSettings 为默认设置', () => {
    expect(store.getWatchlist()).toEqual([])
    expect(store.getSettings()).toEqual({
      paused: false,
      lastPage: DEFAULT_MODULE
    })
  })
})

describe('MarketStore.addWatch', () => {
  it('sortOrder 从 0 开始递增，列表顺序与添加顺序一致', () => {
    const first = store.addWatch(maotai)
    const second = store.addWatch(pingan)

    expect(first.sortOrder).toBe(0)
    expect(second.sortOrder).toBe(1)
    expect(typeof first.addedAt).toBe('number')
    expect(store.getWatchlist().map((item) => item.symbol)).toEqual([
      'sh600519',
      'sz000001'
    ])
    expect(store.getWatchlist()).toEqual([first, second])
  })

  it('同 symbol 重复添加返回既有条目，列表长度不变', () => {
    const first = store.addWatch(maotai)
    const duplicate = store.addWatch({ ...maotai, name: '另一个名字' })

    expect(duplicate).toEqual(first)
    expect(store.getWatchlist()).toHaveLength(1)
    expect(store.getWatchlist()[0].name).toBe('贵州茅台')
  })
})

describe('MarketStore.removeWatch', () => {
  it('返回删除后的列表；不存在 symbol 不报错且列表不变', () => {
    store.addWatch(maotai)
    store.addWatch(pingan)

    const remaining = store.removeWatch('sh600519')
    expect(remaining.map((item) => item.symbol)).toEqual(['sz000001'])

    expect(() => store.removeWatch('sh000000')).not.toThrow()
    expect(store.getWatchlist().map((item) => item.symbol)).toEqual([
      'sz000001'
    ])
  })
})

describe('MarketStore.updateName', () => {
  it('不存在的 symbol 返回 null', () => {
    expect(store.updateName('sh600519', '名称')).toBeNull()
  })

  it('空字符串或同名时不写库，返回值仍为旧名称', () => {
    const added = store.addWatch({ ...maotai, name: '旧名称' })

    expect(store.updateName(added.symbol, '')).toEqual(added)
    expect(store.updateName(added.symbol, '旧名称')).toEqual(added)

    const row = db
      .prepare('SELECT name FROM watchlist WHERE symbol = ?')
      .get(added.symbol) as unknown as { name: string }
    expect(row.name).toBe('旧名称')
  })

  it('正常更新名称并持久化', () => {
    const added = store.addWatch({ ...maotai, name: '旧名称' })

    const updated = store.updateName(added.symbol, '新名称')
    expect(updated?.name).toBe('新名称')
    expect(updated?.symbol).toBe(added.symbol)
    expect(store.getWatchlist()[0].name).toBe('新名称')
  })
})

describe('MarketStore.has', () => {
  it('命中已存在 symbol，未命中不存在 symbol', () => {
    store.addWatch(maotai)

    expect(store.has('sh600519')).toBe(true)
    expect(store.has('sz000001')).toBe(false)
  })
})

describe('MarketStore 设置', () => {
  it('setPaused / setLastPage 持久化，重新读取一致', () => {
    expect(store.setPaused(true)).toEqual({
      paused: true,
      lastPage: DEFAULT_MODULE
    })
    expect(store.setLastPage('market')).toEqual({
      paused: true,
      lastPage: 'market'
    })

    const reloaded = new MarketStore(db)
    expect(reloaded.getSettings()).toEqual({
      paused: true,
      lastPage: 'market'
    })
  })

  it('updateSettings 部分更新保留其他字段', () => {
    store.setLastPage('market')

    const merged = store.updateSettings({ paused: true })
    expect(merged).toEqual({ paused: true, lastPage: 'market' })
    expect(new MarketStore(db).getSettings()).toEqual(merged)
  })

  it('settings 中非法 lastPage 回退默认模块', () => {
    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run('lastPage', 'nope')

    expect(store.getSettings().lastPage).toBe(DEFAULT_MODULE)
  })

  it('settings 中非法 JSON 值回退默认设置', () => {
    const insert = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    )
    insert.run('paused', '{')
    insert.run('lastPage', '{')

    expect(store.getSettings()).toEqual({
      paused: false,
      lastPage: DEFAULT_MODULE
    })
  })
})
