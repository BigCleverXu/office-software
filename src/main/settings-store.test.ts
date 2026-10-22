import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../shared/settings'
import { closeDatabase, openDatabase } from './database'
import { SettingsStore } from './settings-store'

/** COUNT(*) 查询结果 */
interface CountRow {
  n: number
}

let db: DatabaseSync
let store: SettingsStore

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new SettingsStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 直接向 settings 表写入 app 行，用于构造脏数据 */
function writeRawAppValue(value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'app',
    value
  )
}

describe('SettingsStore 空库', () => {
  it('返回默认设置', () => {
    expect(store.get()).toEqual(DEFAULT_APP_SETTINGS)
  })
})

describe('SettingsStore.update', () => {
  it('局部更新合并，未提供字段保持原值', () => {
    expect(store.update({ launchAtLogin: true })).toEqual({
      launchAtLogin: true,
      theme: 'system'
    })

    const merged = store.update({ theme: 'dark' })
    expect(merged).toEqual({ launchAtLogin: true, theme: 'dark' })
    expect(store.get()).toEqual(merged)
  })
})

describe('SettingsStore 非法值回退', () => {
  it('先设为 true 后再传非法值，仅该字段回退默认', () => {
    store.update({ launchAtLogin: true })
    const patch = {
      launchAtLogin: 'yes',
      theme: 'blue'
    } as unknown as Partial<AppSettings>

    expect(store.update(patch)).toEqual({
      launchAtLogin: false,
      theme: 'system'
    })
  })

  it('数据库中布尔字段为字符串、theme 非法时逐字段回退', () => {
    writeRawAppValue(JSON.stringify({ launchAtLogin: 'true', theme: 'blue' }))

    expect(store.get()).toEqual({ launchAtLogin: false, theme: 'system' })
  })

  it('数据库为数组等非对象结构时回退默认', () => {
    writeRawAppValue(JSON.stringify(['dark']))

    expect(store.get()).toEqual(DEFAULT_APP_SETTINGS)
  })
})

describe('SettingsStore 未知字段', () => {
  it('补丁中的未知字段被忽略且不进入返回对象', () => {
    const patch = {
      theme: 'dark',
      unknownField: 'x'
    } as unknown as Partial<AppSettings>

    const updated = store.update(patch)
    expect(updated).toEqual({ launchAtLogin: false, theme: 'dark' })
    expect(Object.keys(updated)).toEqual(['launchAtLogin', 'theme'])
    expect('unknownField' in updated).toBe(false)
  })

  it('数据库中的未知字段不进入返回对象，更新后不被写回', () => {
    writeRawAppValue(
      JSON.stringify({ launchAtLogin: true, theme: 'light', extra: 1 })
    )

    expect(store.get()).toEqual({ launchAtLogin: true, theme: 'light' })

    store.update({})
    const stored = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('app') as unknown as { value: string }
    expect(Object.keys(JSON.parse(stored.value))).toEqual([
      'launchAtLogin',
      'theme'
    ])
  })
})

describe('SettingsStore 持久化', () => {
  it('更新后重新构造 Store 读到相同值', () => {
    store.update({ launchAtLogin: true, theme: 'dark' })

    const reloaded = new SettingsStore(db)
    expect(reloaded.get()).toEqual({ launchAtLogin: true, theme: 'dark' })
  })

  it('多次更新后 settings 表中 app 只有一行', () => {
    store.update({ launchAtLogin: true })
    store.update({ theme: 'dark' })
    store.update({ launchAtLogin: false })

    const row = db
      .prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?')
      .get('app') as unknown as CountRow
    expect(row.n).toBe(1)
    expect(store.get()).toEqual({ launchAtLogin: false, theme: 'dark' })
  })
})

describe('SettingsStore 损坏数据', () => {
  it('JSON 损坏时回退默认且不抛异常', () => {
    writeRawAppValue('{')

    expect(() => store.get()).not.toThrow()
    expect(store.get()).toEqual(DEFAULT_APP_SETTINGS)
  })
})
