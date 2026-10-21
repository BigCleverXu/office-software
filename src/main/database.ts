import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import {
  codeFromSymbol,
  normalizeCode,
  type MarketSettings,
  type WatchItem
} from '../shared/market'
import { DEFAULT_MODULE, isAppModuleId } from '../shared/navigation'
import type { Alarm } from '../shared/types'

/** 数据库文件名 */
export const DATABASE_FILENAME = 'office-software.db'

/** 当前表结构版本 */
export const SCHEMA_VERSION = 1

/** 默认行情看板设置（也是损坏数据的兜底值） */
export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  paused: false,
  lastPage: DEFAULT_MODULE
}

/** 建表语句 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS alarms (
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
CREATE TABLE IF NOT EXISTS watchlist (
  symbol     TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  market     TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** alarms 表行结构 */
interface AlarmRow {
  id: string
  label: string
  time: string
  repeat: string
  weekdays: string
  interval_value: number
  interval_unit: string
  next_fire_at: number | null
  enabled: number
  created_at: number
  last_fired_at: number | null
}

/** watchlist 表行结构 */
interface WatchlistRow {
  symbol: string
  code: string
  market: string
  name: string
  added_at: number
  sort_order: number
}

/** settings 表行结构 */
interface SettingRow {
  key: string
  value: string
}

/** PRAGMA user_version 结果 */
interface UserVersionRow {
  user_version: number
}

/** COUNT(*) 结果 */
interface CountRow {
  n: number
}

/** 打开（必要时创建）数据库文件，并开启外键约束 */
function openFileDatabase(filePath: string): DatabaseSync {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true })
  }
  const db = new DatabaseSync(filePath)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

/** 读取表结构版本 */
function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as unknown as
    UserVersionRow | undefined
  return row?.user_version ?? 0
}

/** 版本为 0 时建表并写入版本号 */
function applySchema(db: DatabaseSync): void {
  if (readUserVersion(db) !== 0) {
    return
  }
  db.exec('BEGIN')
  try {
    db.exec(SCHEMA_SQL)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** 判断某张表是否为空 */
function tableIsEmpty(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .get() as unknown as CountRow | undefined
  return (row?.n ?? 0) === 0
}

/** 补齐缺失字段，兼容旧版本提醒数据 */
function normalizeAlarm(raw: Partial<Alarm>): Alarm {
  return {
    id: raw.id ?? randomUUID(),
    label: raw.label ?? '',
    time: raw.time ?? '',
    repeat: raw.repeat ?? 'none',
    weekdays: raw.weekdays ?? [],
    intervalValue: raw.intervalValue ?? 0,
    intervalUnit: raw.intervalUnit ?? 'minutes',
    nextFireAt: raw.nextFireAt ?? null,
    enabled: raw.enabled ?? true,
    createdAt: raw.createdAt ?? Date.now(),
    lastFiredAt: raw.lastFiredAt ?? null
  }
}

/**
 * 补齐单条自选股字段，兼容旧数据 / 脏数据。
 * 缺少 market / symbol 时按 normalizeCode(code) 推导，
 * 推导失败则返回 null（调用方丢弃该条）。
 */
function normalizeItem(raw: Partial<WatchItem>): WatchItem | null {
  const code =
    typeof raw.code === 'string' && raw.code !== ''
      ? raw.code
      : typeof raw.symbol === 'string'
        ? codeFromSymbol(raw.symbol)
        : ''
  let symbol = raw.symbol
  let market = raw.market
  if (!symbol || !market) {
    const derived = normalizeCode(code)
    if (!derived) {
      return null
    }
    symbol = derived.symbol
    market = derived.market
  }
  return {
    code: code || codeFromSymbol(symbol),
    symbol,
    market,
    name: typeof raw.name === 'string' ? raw.name : '',
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
    sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : 0
  }
}

/** 补齐设置字段 */
function normalizeSettings(raw: unknown): MarketSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_MARKET_SETTINGS }
  }
  const record = raw as Partial<MarketSettings>
  return {
    paused: typeof record.paused === 'boolean' ? record.paused : false,
    lastPage: isAppModuleId(record.lastPage) ? record.lastPage : DEFAULT_MODULE
  }
}

/** 旧文件导入成功后改名为 .bak，失败只记录不中断启动 */
function archiveFile(filePath: string): void {
  try {
    renameSync(filePath, `${filePath}.bak`)
  } catch (error) {
    console.error('备份旧数据文件失败:', error)
  }
}

/** 旧 alarms.json 导入 alarms 表（表非空或文件不存在时跳过） */
function migrateAlarms(db: DatabaseSync, filePath: string): void {
  if (!existsSync(filePath) || !tableIsEmpty(db, 'alarms')) {
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (error) {
    console.error('读取旧提醒数据失败:', error)
    return
  }
  if (!Array.isArray(parsed)) {
    console.error('旧提醒数据结构不符，跳过导入')
    return
  }
  const alarms = parsed.map((item) => normalizeAlarm(item as Partial<Alarm>))
  const insert = db.prepare(
    `INSERT INTO alarms (
      id, label, time, repeat, weekdays, interval_value,
      interval_unit, next_fire_at, enabled, created_at, last_fired_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  db.exec('BEGIN')
  try {
    for (const alarm of alarms) {
      insert.run(
        alarm.id,
        alarm.label,
        alarm.time,
        alarm.repeat,
        JSON.stringify(alarm.weekdays),
        alarm.intervalValue,
        alarm.intervalUnit,
        alarm.nextFireAt,
        alarm.enabled ? 1 : 0,
        alarm.createdAt,
        alarm.lastFiredAt
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  archiveFile(filePath)
}

/** 旧 market.json 导入 watchlist / settings 表（任一表非空时跳过） */
function migrateMarket(db: DatabaseSync, filePath: string): void {
  if (!existsSync(filePath)) {
    return
  }
  if (!tableIsEmpty(db, 'watchlist') || !tableIsEmpty(db, 'settings')) {
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (error) {
    console.error('读取旧行情数据失败:', error)
    return
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { watchlist?: unknown }).watchlist)
  ) {
    console.error('旧行情数据结构不符，跳过导入')
    return
  }
  const record = parsed as { watchlist: unknown[]; settings?: unknown }
  const watchlist = record.watchlist
    .map((item) => normalizeItem(item as Partial<WatchItem>))
    .filter((item): item is WatchItem => item !== null)
  const settings = normalizeSettings(record.settings)
  const insertItem = db.prepare(
    `INSERT INTO watchlist (
      symbol, code, market, name, added_at, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?)`
  )
  const insertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?)'
  )
  db.exec('BEGIN')
  try {
    for (const item of watchlist) {
      insertItem.run(
        item.symbol,
        item.code,
        item.market,
        item.name,
        item.addedAt,
        item.sortOrder
      )
    }
    insertSetting.run('paused', JSON.stringify(settings.paused))
    insertSetting.run('lastPage', JSON.stringify(settings.lastPage))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  archiveFile(filePath)
}

/** 导入 legacyDir 下的旧 JSON 数据 */
function migrateLegacyData(db: DatabaseSync, legacyDir: string): void {
  migrateAlarms(db, join(legacyDir, 'alarms.json'))
  migrateMarket(db, join(legacyDir, 'market.json'))
}

/**
 * 打开应用数据库。
 *
 * 默认路径为 `app.getPath('userData')/office-software.db`；测试可显式
 * 传入 path（含 ':memory:'）与 legacyDir 以避免依赖 electron。
 * 打开失败时回退到内存数据库，保证不抛异常、不影响启动。
 */
export function openDatabase(options?: {
  path?: string
  legacyDir?: string
}): DatabaseSync {
  const filePath =
    options?.path ?? join(app.getPath('userData'), DATABASE_FILENAME)
  let db: DatabaseSync
  try {
    db = openFileDatabase(filePath)
  } catch (error) {
    console.error('打开数据库失败，回退到内存数据库:', error)
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
  }
  applySchema(db)
  const legacyDir =
    options?.legacyDir ?? (filePath === ':memory:' ? null : dirname(filePath))
  if (legacyDir) {
    try {
      migrateLegacyData(db, legacyDir)
    } catch (error) {
      console.error('迁移旧数据失败:', error)
    }
  }
  return db
}

/** 关闭数据库；重复关闭的异常只记录不抛出 */
export function closeDatabase(db: DatabaseSync): void {
  try {
    db.close()
  } catch (error) {
    console.error('关闭数据库失败:', error)
  }
}

/** 行类型供后续 store 改造使用 */
export type { AlarmRow, SettingRow, WatchlistRow }
