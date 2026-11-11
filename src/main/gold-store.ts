// 主进程积存金持仓存储：读写 gold_holding 单行表（id 固定为 1）
import type { DatabaseSync } from 'node:sqlite'
import {
  isValidHolding,
  normalizeHolding,
  type GoldHolding
} from '../shared/gold'
import type { GoldHoldingRow } from './database'

/** 缺省持仓：未持有 */
const EMPTY_HOLDING: GoldHolding = {
  grams: 0,
  costPerGram: 0,
  updatedAt: null
}

/**
 * 积存金持仓的本地持久化存储。
 *
 * 表中只保留一行（id = 1），缺失时按「未持有」处理；读取时统一走
 * normalizeHolding 兜底，避免历史脏数据产生负数或 NaN。
 */
export class GoldStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 读取当前持仓；无记录时返回未持有 */
  getHolding(): GoldHolding {
    const row = this.db
      .prepare('SELECT grams, cost, updated_at FROM gold_holding WHERE id = 1')
      .get() as unknown as GoldHoldingRow | undefined
    if (!row) {
      return { ...EMPTY_HOLDING }
    }
    return normalizeHolding({
      grams: row.grams,
      costPerGram: row.cost,
      updatedAt: row.updated_at
    })
  }

  /**
   * 写入持仓；克数或成本非法时返回 null 且不写库。
   * updatedAt 由本方法写入当前时间，成功后返回最新持仓。
   */
  updateHolding(raw: unknown): GoldHolding | null {
    if (!isValidHolding(raw)) {
      return null
    }
    const normalized = normalizeHolding(raw)
    const holding: GoldHolding = {
      grams: normalized.grams,
      costPerGram: normalized.costPerGram,
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gold_holding (id, grams, cost, updated_at)
         VALUES (1, ?, ?, ?)`
      )
      .run(holding.grams, holding.costPerGram, holding.updatedAt)
    return holding
  }
}
