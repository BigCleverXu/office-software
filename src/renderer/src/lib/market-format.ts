import {
  directionOf,
  FAILURE_THRESHOLD,
  formatAmount,
  formatClockTime,
  formatPercent,
  formatPrice,
  formatSigned
} from '@shared/market'
import type { MarketSnapshot } from '@shared/market'

export {
  formatAmount,
  formatClockTime,
  formatPercent,
  formatPrice,
  formatSigned
}

/**
 * 涨跌数值的颜色类：红涨、绿跌，平盘（0）与缺失值使用中性色。
 */
export function toneClass(value: number | null): string {
  const direction = directionOf(value)
  if (direction > 0) {
    return 'text-red-500'
  }
  if (direction < 0) {
    return 'text-green-600'
  }
  return 'text-muted-foreground'
}

/** 表头全局状态文案 */
export function statusLabel(snapshot: MarketSnapshot): string {
  switch (snapshot.status) {
    case 'loading':
      return '加载中…'
    case 'refreshing':
      return '刷新中…'
    case 'ok':
      return snapshot.updatedAtLabel
        ? `已更新 ${snapshot.updatedAtLabel}`
        : '已更新'
    case 'failed': {
      const base = `刷新失败 · 上次成功 ${snapshot.updatedAtLabel ?? '--'}`
      return snapshot.failureCount >= FAILURE_THRESHOLD
        ? `${base}（网络异常，重试中）`
        : base
    }
    case 'load-failed':
      return '加载失败'
    case 'closed': {
      const parts = [snapshot.closedReason, snapshot.nextOpenLabel].filter(
        (part): part is string => Boolean(part)
      )
      return parts.length > 0 ? `已休市 · ${parts.join(' · ')}` : '已休市'
    }
    case 'paused':
      return '已暂停'
    default:
      return ''
  }
}

/** 表头状态文案的颜色类 */
export function statusToneClass(snapshot: MarketSnapshot): string {
  if (snapshot.status === 'failed' || snapshot.status === 'load-failed') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}
