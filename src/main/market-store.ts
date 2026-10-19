import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  codeFromSymbol,
  normalizeCode,
  type MarketId,
  type MarketPage,
  type MarketSettings,
  type WatchItem
} from '../shared/market'

/** 默认设置（也是损坏数据的兜底值） */
export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  paused: false,
  lastPage: 'alarms'
}

/** market.json 的完整结构 */
interface MarketData {
  watchlist: WatchItem[]
  settings: MarketSettings
}

/** 空数据结构 */
function createEmptyData(): MarketData {
  return {
    watchlist: [],
    settings: { ...DEFAULT_MARKET_SETTINGS }
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
    lastPage: record.lastPage === 'market' ? 'market' : 'alarms'
  }
}

/** 补齐整体结构；结构不符时回退为兜底数据 */
function normalizeData(raw: unknown): MarketData {
  if (!raw || typeof raw !== 'object') {
    return createEmptyData()
  }
  const record = raw as { watchlist?: unknown; settings?: unknown }
  const watchlist = Array.isArray(record.watchlist)
    ? record.watchlist
        .map((item) => normalizeItem(item as Partial<WatchItem>))
        .filter((item): item is WatchItem => item !== null)
    : []
  return {
    watchlist,
    settings: normalizeSettings(record.settings)
  }
}

/**
 * 行情看板的本地持久化存储。
 *
 * 数据以 JSON 对象形式保存在 `app.getPath('userData')/market.json`，
 * 仅保存自选股列表与页面设置，不含任何行情数值。为便于单元测试，
 * `app.getPath` 只在需要真实路径时通过惰性 getter 调用，构造函数
 * 也可传入自定义 filePath。
 */
export class MarketStore {
  private readonly explicitPath?: string
  private data: MarketData | null = null

  constructor(filePath?: string) {
    this.explicitPath = filePath
  }

  private get filePath(): string {
    if (this.explicitPath) {
      return this.explicitPath
    }
    return join(app.getPath('userData'), 'market.json')
  }

  /** 读取内存缓存，首次访问时从磁盘加载（损坏 / 不存在走兜底） */
  private load(): MarketData {
    if (this.data) {
      return this.data
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      this.data = normalizeData(parsed)
    } catch {
      this.data = createEmptyData()
    }
    return this.data
  }

  /** 写回磁盘并更新内存缓存 */
  private persist(data: MarketData): void {
    this.data = data
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('保存行情看板数据失败:', error)
    }
  }

  /** 自选股列表，按 sortOrder 升序、其次 addedAt 升序返回副本 */
  getWatchlist(): WatchItem[] {
    const list = [...this.load().watchlist]
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.addedAt - b.addedAt)
    return list.map((item) => ({ ...item }))
  }

  /**
   * 新增自选股；同 symbol 已存在时直接返回已存在的条目（不重复写入）。
   * addedAt 由本方法写入，sortOrder 取当前最大值 + 1（空列表为 0）。
   */
  addWatch(item: {
    code: string
    symbol: string
    market: MarketId
    name: string
  }): WatchItem {
    const data = this.load()
    const existing = data.watchlist.find(
      (watch) => watch.symbol === item.symbol
    )
    if (existing) {
      return { ...existing }
    }
    const maxOrder = data.watchlist.reduce(
      (max, watch) => Math.max(max, watch.sortOrder),
      -1
    )
    const created: WatchItem = {
      code: item.code,
      symbol: item.symbol,
      market: item.market,
      name: item.name ?? '',
      addedAt: Date.now(),
      sortOrder: maxOrder + 1
    }
    this.persist({
      ...data,
      watchlist: [...data.watchlist, created]
    })
    return { ...created }
  }

  /** 删除自选股，返回删除后的列表副本；symbol 不存在时列表不变 */
  removeWatch(symbol: string): WatchItem[] {
    const data = this.load()
    const next = data.watchlist.filter((watch) => watch.symbol !== symbol)
    if (next.length !== data.watchlist.length) {
      this.persist({ ...data, watchlist: next })
    }
    return this.getWatchlist()
  }

  /** 更新名称缓存；name 为空或与原值相同则不写盘 */
  updateName(symbol: string, name: string): WatchItem | null {
    const data = this.load()
    const index = data.watchlist.findIndex((watch) => watch.symbol === symbol)
    if (index === -1) {
      return null
    }
    const current = data.watchlist[index]
    if (!name || name === current.name) {
      return { ...current }
    }
    const updated: WatchItem = { ...current, name }
    const next = [...data.watchlist]
    next[index] = updated
    this.persist({ ...data, watchlist: next })
    return { ...updated }
  }

  /** 是否存在某 symbol */
  has(symbol: string): boolean {
    return this.load().watchlist.some((watch) => watch.symbol === symbol)
  }

  getSettings(): MarketSettings {
    return { ...this.load().settings }
  }

  /** 合并写入设置（部分字段），返回合并后的完整设置 */
  updateSettings(patch: Partial<MarketSettings>): MarketSettings {
    const data = this.load()
    const next: MarketSettings = { ...data.settings, ...patch }
    this.persist({ ...data, settings: next })
    return { ...next }
  }

  /** 便捷方法：设置暂停开关 */
  setPaused(paused: boolean): MarketSettings {
    return this.updateSettings({ paused })
  }

  /** 便捷方法：记录上次停留页面 */
  setLastPage(page: MarketPage): MarketSettings {
    return this.updateSettings({ lastPage: page })
  }
}
