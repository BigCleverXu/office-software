import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODULE } from '../shared/navigation'
import { closeDatabase, openDatabase, SCHEMA_VERSION } from './database'
import type { AlarmRow, SettingRow, WatchlistRow } from './database'

const opened: DatabaseSync[] = []
const tempDirs: string[] = []

/** 打开数据库并登记，便于 afterEach 统一关闭 */
function openTestDatabase(options?: {
  path?: string
  legacyDir?: string
}): DatabaseSync {
  const db = openDatabase(options)
  opened.push(db)
  return db
}

/** 主动关闭并从登记表移除，避免 afterEach 重复关闭 */
function closeTestDatabase(db: DatabaseSync): void {
  closeDatabase(db)
  const index = opened.indexOf(db)
  if (index >= 0) {
    opened.splice(index, 1)
  }
}

/** 建一个用例专属的临时目录 */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'db-test-'))
  tempDirs.push(dir)
  return dir
}

/** 读取全部业务表名 */
function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as unknown as { name: string }[]
  return rows.map((row) => row.name).sort()
}

/** 读取表结构版本 */
function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as unknown as {
    user_version: number
  }
  return row.user_version
}

/** 统计表行数 */
function countRows(db: DatabaseSync, table: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .get() as unknown as { n: number }
  return row.n
}

/** 读取 settings 表并解析 JSON 值 */
function readSettings(db: DatabaseSync): Record<string, unknown> {
  const rows = db
    .prepare('SELECT key, value FROM settings')
    .all() as unknown as SettingRow[]
  const result: Record<string, unknown> = {}
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value)
  }
  return result
}

afterEach(() => {
  for (const db of opened.splice(0)) {
    closeDatabase(db)
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('openDatabase 建库', () => {
  it(':memory: 打开后四张表存在且版本号为 2', () => {
    const db = openTestDatabase({ path: ':memory:' })
    expect(tableNames(db)).toEqual(['alarms', 'notes', 'settings', 'watchlist'])
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(2)
  })

  it('没有 legacyDir 且无旧文件时不迁移、不报错', () => {
    const dir = makeTempDir()
    const db = openTestDatabase({ path: join(dir, 'test.db') })
    expect(tableNames(db)).toEqual(['alarms', 'notes', 'settings', 'watchlist'])
    expect(countRows(db, 'alarms')).toBe(0)
    expect(countRows(db, 'watchlist')).toBe(0)
    expect(countRows(db, 'settings')).toBe(0)
    expect(countRows(db, 'notes')).toBe(0)
  })
})

describe('openDatabase 版本升级', () => {
  it('v1 数据库升级到 v2 时新增 notes 表且保留原有数据', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'test.db')

    // 手工构造一个 v1 数据库（仅 alarms / watchlist / settings）
    const legacy = new DatabaseSync(dbPath)
    legacy.exec(`
CREATE TABLE alarms (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL DEFAULT '',
  time           TEXT NOT NULL DEFAULT '',
  repeat         TEXT NOT NULL DEFAULT 'none',
  weekdays       TEXT NOT NULL DEFAULT '[]',
  interval_value INTEGER NOT NULL DEFAULT 0,
  interval_unit  TEXT NOT NULL DEFAULT 'minutes',
  next_fire_at   INTEGER,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  last_fired_at  INTEGER
);
CREATE TABLE watchlist (
  symbol     TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  market     TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)
    legacy
      .prepare(
        `INSERT INTO alarms (id, label, time, created_at)
        VALUES (?, ?, ?, ?)`
      )
      .run('a1', '旧提醒', '08:00', 100)
    legacy
      .prepare(
        `INSERT INTO watchlist (symbol, code, market, added_at)
        VALUES (?, ?, ?, ?)`
      )
      .run('sh600519', '600519', 'sh', 200)
    legacy.exec('PRAGMA user_version = 1')
    legacy.close()

    const db = openTestDatabase({ path: dbPath })

    expect(tableNames(db)).toEqual(['alarms', 'notes', 'settings', 'watchlist'])
    expect(userVersion(db)).toBe(2)
    expect(countRows(db, 'alarms')).toBe(1)
    expect(countRows(db, 'watchlist')).toBe(1)
  })
})

describe('openDatabase 迁移旧 alarms.json', () => {
  it('导入合法数组、补齐缺字段并归档为 .bak', () => {
    const dir = makeTempDir()
    const alarmsPath = join(dir, 'alarms.json')
    const legacy = [
      {
        id: 'a1',
        label: '喝水',
        time: '09:00',
        repeat: 'weekly',
        weekdays: [1, 3],
        intervalValue: 0,
        intervalUnit: 'minutes',
        nextFireAt: null,
        enabled: true,
        createdAt: 111,
        lastFiredAt: null
      },
      {
        id: 'a2',
        label: '休息',
        time: '10:00',
        repeat: 'interval',
        weekdays: [],
        intervalValue: 30,
        intervalUnit: 'minutes',
        nextFireAt: 2222,
        enabled: false,
        createdAt: 222,
        lastFiredAt: 1000
      },
      { label: '缺字段' }
    ]
    writeFileSync(alarmsPath, JSON.stringify(legacy))

    const db = openTestDatabase({
      path: join(dir, 'test.db'),
      legacyDir: dir
    })

    const rows = db
      .prepare('SELECT * FROM alarms ORDER BY created_at ASC, rowid ASC')
      .all() as unknown as AlarmRow[]
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      id: 'a1',
      label: '喝水',
      time: '09:00',
      repeat: 'weekly',
      interval_value: 0,
      interval_unit: 'minutes',
      next_fire_at: null,
      enabled: 1,
      created_at: 111,
      last_fired_at: null
    })
    expect(JSON.parse(rows[0].weekdays)).toEqual([1, 3])
    expect(rows[1]).toMatchObject({
      id: 'a2',
      repeat: 'interval',
      interval_value: 30,
      next_fire_at: 2222,
      enabled: 0,
      last_fired_at: 1000
    })

    // 缺字段条目由 normalizeAlarm 补齐
    expect(rows[2].id).toBeTruthy()
    expect(rows[2]).toMatchObject({
      label: '缺字段',
      time: '',
      repeat: 'none',
      interval_value: 0,
      interval_unit: 'minutes',
      next_fire_at: null,
      enabled: 1,
      last_fired_at: null
    })
    expect(JSON.parse(rows[2].weekdays)).toEqual([])
    expect(rows[2].created_at).toBeGreaterThan(222)

    expect(existsSync(alarmsPath)).toBe(false)
    expect(existsSync(`${alarmsPath}.bak`)).toBe(true)
  })
})

describe('openDatabase 迁移旧 market.json', () => {
  it('导入 watchlist 与 settings 并归档为 .bak', () => {
    const dir = makeTempDir()
    const marketPath = join(dir, 'market.json')
    const legacy = {
      watchlist: [
        {
          code: '600519',
          symbol: 'sh600519',
          market: 'sh',
          name: '贵州茅台',
          addedAt: 100,
          sortOrder: 0
        },
        {
          code: '000001',
          market: 'sz',
          name: '平安银行',
          addedAt: 200,
          sortOrder: 1
        }
      ],
      settings: { paused: true, lastPage: 'market' }
    }
    writeFileSync(marketPath, JSON.stringify(legacy))

    const db = openTestDatabase({
      path: join(dir, 'test.db'),
      legacyDir: dir
    })

    const rows = db
      .prepare('SELECT * FROM watchlist ORDER BY sort_order ASC')
      .all() as unknown as WatchlistRow[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      symbol: 'sh600519',
      code: '600519',
      market: 'sh',
      name: '贵州茅台',
      added_at: 100,
      sort_order: 0
    })
    // 缺 symbol 的条目按 code 推导
    expect(rows[1]).toEqual({
      symbol: 'sz000001',
      code: '000001',
      market: 'sz',
      name: '平安银行',
      added_at: 200,
      sort_order: 1
    })

    expect(readSettings(db)).toEqual({
      paused: true,
      lastPage: 'market'
    })
    expect(existsSync(marketPath)).toBe(false)
    expect(existsSync(`${marketPath}.bak`)).toBe(true)
  })
})

describe('openDatabase 迁移幂等与异常数据', () => {
  it('重复打开同一数据库不会重复导入', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'test.db')
    const alarmsPath = join(dir, 'alarms.json')
    const marketPath = join(dir, 'market.json')
    writeFileSync(
      alarmsPath,
      JSON.stringify([{ id: 'a1', label: '旧提醒', time: '08:00' }])
    )
    writeFileSync(
      marketPath,
      JSON.stringify({
        watchlist: [
          {
            code: '600519',
            symbol: 'sh600519',
            market: 'sh',
            name: '贵州茅台',
            addedAt: 100,
            sortOrder: 0
          }
        ],
        settings: { paused: false, lastPage: 'alarms' }
      })
    )

    const first = openTestDatabase({ path: dbPath, legacyDir: dir })
    expect(countRows(first, 'alarms')).toBe(1)
    expect(countRows(first, 'watchlist')).toBe(1)
    closeTestDatabase(first)

    // 旧文件重新出现时，已有数据不应被再次导入
    writeFileSync(alarmsPath, JSON.stringify([{ id: 'a2' }, { id: 'a3' }]))
    writeFileSync(
      marketPath,
      JSON.stringify({
        watchlist: [
          {
            code: '000001',
            symbol: 'sz000001',
            market: 'sz',
            name: '平安银行',
            addedAt: 200,
            sortOrder: 1
          }
        ],
        settings: { paused: true, lastPage: 'market' }
      })
    )

    const second = openTestDatabase({ path: dbPath, legacyDir: dir })
    expect(countRows(second, 'alarms')).toBe(1)
    expect(countRows(second, 'watchlist')).toBe(1)
    expect(readSettings(second)).toEqual({
      paused: false,
      lastPage: DEFAULT_MODULE
    })
    // 表非空导致跳过迁移，原文件保留且未被改名
    expect(existsSync(alarmsPath)).toBe(true)
    expect(existsSync(marketPath)).toBe(true)
  })

  it('损坏 JSON 不阻塞打开、表为空且保留原文件', () => {
    const dir = makeTempDir()
    const alarmsPath = join(dir, 'alarms.json')
    const marketPath = join(dir, 'market.json')
    writeFileSync(alarmsPath, '{')
    writeFileSync(marketPath, '{')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const db = openTestDatabase({
        path: join(dir, 'test.db'),
        legacyDir: dir
      })
      expect(tableNames(db)).toEqual([
        'alarms',
        'notes',
        'settings',
        'watchlist'
      ])
      expect(countRows(db, 'alarms')).toBe(0)
      expect(countRows(db, 'watchlist')).toBe(0)
      expect(countRows(db, 'settings')).toBe(0)
    } finally {
      errorSpy.mockRestore()
    }

    expect(existsSync(alarmsPath)).toBe(true)
    expect(existsSync(marketPath)).toBe(true)
    expect(existsSync(`${alarmsPath}.bak`)).toBe(false)
    expect(existsSync(`${marketPath}.bak`)).toBe(false)
  })

  it('结构不符时跳过导入并保留原文件', () => {
    const dir = makeTempDir()
    const alarmsPath = join(dir, 'alarms.json')
    const marketPath = join(dir, 'market.json')
    writeFileSync(alarmsPath, '"123"')
    writeFileSync(marketPath, '{}')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const db = openTestDatabase({
        path: join(dir, 'test.db'),
        legacyDir: dir
      })
      expect(countRows(db, 'alarms')).toBe(0)
      expect(countRows(db, 'watchlist')).toBe(0)
      expect(countRows(db, 'settings')).toBe(0)
    } finally {
      errorSpy.mockRestore()
    }

    expect(existsSync(alarmsPath)).toBe(true)
    expect(existsSync(marketPath)).toBe(true)
    expect(existsSync(`${alarmsPath}.bak`)).toBe(false)
    expect(existsSync(`${marketPath}.bak`)).toBe(false)
  })
})
