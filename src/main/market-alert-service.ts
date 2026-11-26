import { matchesPriceAlert } from '../shared/market'
import type { PriceAlert, Quote } from '../shared/market'
import type { MarketAlertStore } from './market-alert-store'

export interface MarketAlertServiceDeps {
  store: MarketAlertStore
  /** 命中时弹通知 */
  onTrigger: (alert: PriceAlert, price: number) => void
  /** 有提醒被触发（数据已变化）后回调，用于广播最新状态 */
  onChange: () => void
  /** 注入时钟，默认 Date.now */
  now?: () => number
}

/**
 * 行情价格提醒的触发判定服务。
 *
 * 纯逻辑，不依赖 electron：每轮行情快照到达时调用 evaluate，命中即记录
 * 触发时间并停用该提醒，然后通过 onTrigger 弹通知、onChange 广播状态。
 */
export class MarketAlertService {
  private readonly deps: MarketAlertServiceDeps

  constructor(deps: MarketAlertServiceDeps) {
    this.deps = deps
  }

  /**
   * 评估本轮行情：仅交易时段生效；跳过停用提醒与行情缺失 / 现价为空的标的；
   * 命中则记录触发并停用该提醒，然后通知。返回本轮触发条数。
   */
  evaluate(quotes: Quote[], trading: boolean): number {
    // 非交易时段不判定，避免用休市期间的旧价误触发
    if (!trading) {
      return 0
    }
    // symbol 统一小写建索引，兼容大小写差异
    const quoteMap = new Map<string, Quote>()
    for (const quote of quotes) {
      quoteMap.set(quote.symbol.toLowerCase(), quote)
    }
    const now = this.deps.now ?? Date.now
    let triggered = 0
    for (const alert of this.deps.store.getAll()) {
      if (!alert.enabled) {
        continue
      }
      const quote = quoteMap.get(alert.symbol.toLowerCase())
      // 行情缺失 / 停牌 / 无现价的标的不参与判定
      if (!quote || quote.missing || quote.price === null) {
        continue
      }
      const price = quote.price
      if (!matchesPriceAlert(alert, price)) {
        continue
      }
      // 记录触发时间并停用，保证同一提醒只触发一次
      const updated = this.deps.store.markTriggered(alert.id, now())
      this.deps.onTrigger(updated ?? alert, price)
      triggered += 1
    }
    // 数据已变化：只广播一次
    if (triggered > 0) {
      this.deps.onChange()
    }
    return triggered
  }
}
