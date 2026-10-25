import { describe, expect, it } from 'vitest'
import {
  closedReasonText,
  codeFromSymbol,
  directionOf,
  etParts,
  formatAmount,
  formatClockTime,
  formatDateLabel,
  formatPercent,
  formatPrice,
  formatSigned,
  indexNameOf,
  indexSymbolsOf,
  isMarketRegion,
  isSameTradingSession,
  isTradingDay,
  isTradingTime,
  marketFromSymbol,
  nextOpenAt,
  nextUsOpenStart,
  normalizeCode,
  normalizeUsSymbol,
  symbolFromCode,
  usClosedReason,
  usMarketOpen
} from './market'

// 2026-01-05 周一、01-06 周二、01-09 周五
// 2026-01-03 周六、01-04 周日
const monday = new Date(2026, 0, 5, 10, 0)
const tuesday = new Date(2026, 0, 6, 10, 0)
const friday = new Date(2026, 0, 9, 10, 0)
const saturday = new Date(2026, 0, 3, 10, 0)
const sunday = new Date(2026, 0, 4, 10, 0)

describe('normalizeCode', () => {
  it('6 / 9 开头归属上海市场', () => {
    expect(normalizeCode('600519')).toEqual({
      code: '600519',
      symbol: 'sh600519',
      market: 'sh'
    })
    expect(normalizeCode('900901')).toEqual({
      code: '900901',
      symbol: 'sh900901',
      market: 'sh'
    })
  })

  it('0 / 3 开头归属深圳市场', () => {
    expect(normalizeCode('000001')).toEqual({
      code: '000001',
      symbol: 'sz000001',
      market: 'sz'
    })
    expect(normalizeCode('300750')).toEqual({
      code: '300750',
      symbol: 'sz300750',
      market: 'sz'
    })
  })

  it('8 / 4 及其他首位返回 null', () => {
    expect(normalizeCode('830799')).toBeNull()
    expect(normalizeCode('430047')).toBeNull()
    expect(normalizeCode('100000')).toBeNull()
    expect(normalizeCode('200011')).toBeNull()
  })

  it('位数不足或超长返回 null', () => {
    expect(normalizeCode('60051')).toBeNull()
    expect(normalizeCode('6005199')).toBeNull()
    expect(normalizeCode('')).toBeNull()
  })

  it('含字母或非数字返回 null', () => {
    expect(normalizeCode('60051A')).toBeNull()
    expect(normalizeCode('abcdef')).toBeNull()
  })

  it('首尾空格可被 trim 后正常解析', () => {
    expect(normalizeCode('  600519 ')).toEqual({
      code: '600519',
      symbol: 'sh600519',
      market: 'sh'
    })
    expect(normalizeCode(' 000001 ')).toEqual({
      code: '000001',
      symbol: 'sz000001',
      market: 'sz'
    })
  })
})

describe('symbol / code / market 互转', () => {
  it('codeFromSymbol 去掉 sh / sz 前缀', () => {
    expect(codeFromSymbol('sh600519')).toBe('600519')
    expect(codeFromSymbol('sz000001')).toBe('000001')
    expect(codeFromSymbol('sz399006')).toBe('399006')
  })

  it('marketFromSymbol 由前缀推导市场', () => {
    expect(marketFromSymbol('sh600519')).toBe('sh')
    expect(marketFromSymbol('sz000001')).toBe('sz')
  })

  it('symbolFromCode 拼接前缀', () => {
    expect(symbolFromCode('600519', 'sh')).toBe('sh600519')
    expect(symbolFromCode('000001', 'sz')).toBe('sz000001')
  })

  it('归一化后的 symbol 可往返还原', () => {
    const normalized = normalizeCode('600519')
    expect(normalized).not.toBeNull()
    if (normalized) {
      expect(codeFromSymbol(normalized.symbol)).toBe(normalized.code)
      expect(marketFromSymbol(normalized.symbol)).toBe(normalized.market)
    }
  })
})

describe('isTradingDay', () => {
  it('周一至周五为交易日', () => {
    expect(isTradingDay(monday)).toBe(true)
    expect(isTradingDay(tuesday)).toBe(true)
    expect(isTradingDay(friday)).toBe(true)
  })

  it('周六、周日不是交易日', () => {
    expect(isTradingDay(saturday)).toBe(false)
    expect(isTradingDay(sunday)).toBe(false)
  })
})

describe('isTradingTime', () => {
  const at = (hour: number, minute: number, second: number): Date =>
    new Date(2026, 0, 5, hour, minute, second)

  it('上午盘边界', () => {
    expect(isTradingTime(at(9, 29, 59))).toBe(false)
    expect(isTradingTime(at(9, 30, 0))).toBe(true)
    expect(isTradingTime(at(11, 29, 59))).toBe(true)
    expect(isTradingTime(at(11, 30, 0))).toBe(false)
  })

  it('午休与下午盘边界', () => {
    expect(isTradingTime(at(12, 59, 59))).toBe(false)
    expect(isTradingTime(at(13, 0, 0))).toBe(true)
    expect(isTradingTime(at(14, 59, 59))).toBe(true)
    expect(isTradingTime(at(15, 0, 0))).toBe(false)
  })

  it('周末任意时间都不是交易时段', () => {
    expect(isTradingTime(new Date(2026, 0, 3, 10, 0, 0))).toBe(false)
    expect(isTradingTime(new Date(2026, 0, 4, 14, 0, 0))).toBe(false)
  })
})

describe('nextOpenAt', () => {
  it('工作日开盘前 → 当日 09:30 pre-open', () => {
    const info = nextOpenAt(new Date(2026, 0, 5, 9, 0, 0))
    expect(info.reason).toBe('pre-open')
    expect(info.at).toBe(new Date(2026, 0, 5, 9, 30, 0).getTime())
    expect(info.label).toBe('09:30 开盘')
  })

  it('午休 → 当日 13:00 lunch', () => {
    const info = nextOpenAt(new Date(2026, 0, 5, 12, 0, 0))
    expect(info.reason).toBe('lunch')
    expect(info.at).toBe(new Date(2026, 0, 5, 13, 0, 0).getTime())
    expect(info.label).toBe('13:00 恢复')
  })

  it('工作日收盘后 → 下一个工作日 09:30 closed', () => {
    const info = nextOpenAt(new Date(2026, 0, 5, 16, 0, 0))
    expect(info.reason).toBe('closed')
    expect(info.at).toBe(new Date(2026, 0, 6, 9, 30, 0).getTime())
    expect(info.label).toBe('01-06 09:30 开盘')
  })

  it('周五收盘后 → 下周一 09:30', () => {
    const info = nextOpenAt(new Date(2026, 0, 9, 16, 0, 0))
    expect(info.reason).toBe('closed')
    expect(info.at).toBe(new Date(2026, 0, 12, 9, 30, 0).getTime())
    expect(info.label).toBe('01-12 09:30 开盘')
  })

  it('周六、周日 → 下周一 09:30 weekend', () => {
    const fromSaturday = nextOpenAt(new Date(2026, 0, 3, 12, 0, 0))
    expect(fromSaturday.reason).toBe('weekend')
    expect(fromSaturday.at).toBe(new Date(2026, 0, 5, 9, 30, 0).getTime())
    expect(fromSaturday.label).toBe('01-05 09:30 开盘')

    const fromSunday = nextOpenAt(new Date(2026, 0, 4, 8, 0, 0))
    expect(fromSunday.reason).toBe('weekend')
    expect(fromSunday.at).toBe(new Date(2026, 0, 5, 9, 30, 0).getTime())
  })

  it('交易中的时间按已收盘处理，指向下一交易日 09:30', () => {
    const info = nextOpenAt(new Date(2026, 0, 5, 10, 0, 0))
    expect(info.reason).toBe('closed')
    expect(info.at).toBe(new Date(2026, 0, 6, 9, 30, 0).getTime())
    expect(info.label).toBe('01-06 09:30 开盘')
  })
})

describe('closedReasonText', () => {
  it('交易时段返回空字符串', () => {
    expect(closedReasonText(new Date(2026, 0, 5, 10, 0, 0))).toBe('')
  })

  it('开盘前返回「开盘前」', () => {
    expect(closedReasonText(new Date(2026, 0, 5, 9, 0, 0))).toBe('开盘前')
  })

  it('午休返回「午间休市」', () => {
    expect(closedReasonText(new Date(2026, 0, 5, 12, 0, 0))).toBe('午间休市')
  })

  it('收盘后返回「已收盘」', () => {
    expect(closedReasonText(new Date(2026, 0, 5, 16, 0, 0))).toBe('已收盘')
  })

  it('周末返回「周末休市」（含开盘前时段）', () => {
    expect(closedReasonText(new Date(2026, 0, 3, 10, 0, 0))).toBe('周末休市')
    expect(closedReasonText(new Date(2026, 0, 4, 8, 0, 0))).toBe('周末休市')
  })
})

describe('isSameTradingSession', () => {
  it('同一上午盘内的两个时间戳属于同一时段', () => {
    const open = new Date(2026, 0, 5, 9, 30, 0).getTime()
    const mid = new Date(2026, 0, 5, 11, 0, 0).getTime()
    expect(isSameTradingSession(open, mid)).toBe(true)
  })

  it('上午盘与下午盘不是同一时段', () => {
    const morning = new Date(2026, 0, 5, 11, 0, 0).getTime()
    const afternoon = new Date(2026, 0, 5, 14, 0, 0).getTime()
    expect(isSameTradingSession(morning, afternoon)).toBe(false)
  })

  it('午休与下午盘首次开盘不是同一时段', () => {
    const lunch = new Date(2026, 0, 5, 12, 0, 0).getTime()
    const afternoonOpen = new Date(2026, 0, 5, 13, 0, 0).getTime()
    expect(isSameTradingSession(lunch, afternoonOpen)).toBe(false)
  })

  it('不同交易日的同一时段不是同一时段', () => {
    const today = new Date(2026, 0, 5, 10, 0, 0).getTime()
    const tomorrow = new Date(2026, 0, 6, 10, 0, 0).getTime()
    expect(isSameTradingSession(today, tomorrow)).toBe(false)
  })

  it('非交易时段的时间戳返回 false', () => {
    const beforeOpen = new Date(2026, 0, 5, 9, 0, 0).getTime()
    expect(isSameTradingSession(beforeOpen, beforeOpen)).toBe(false)
  })
})

describe('directionOf', () => {
  it('负 -1、正 1、零与空 0', () => {
    expect(directionOf(-1.2)).toBe(-1)
    expect(directionOf(0)).toBe(0)
    expect(directionOf(2.5)).toBe(1)
    expect(directionOf(null)).toBe(0)
  })
})

describe('formatPrice', () => {
  it('空值显示 --，数值保留 2 位小数', () => {
    expect(formatPrice(null)).toBe('--')
    expect(formatPrice(12.3)).toBe('12.30')
    expect(formatPrice(0)).toBe('0.00')
  })
})

describe('formatSigned', () => {
  it('空显示 --，正负号正确，零无符号', () => {
    expect(formatSigned(null)).toBe('--')
    expect(formatSigned(1.23)).toBe('+1.23')
    expect(formatSigned(-0.5)).toBe('-0.50')
    expect(formatSigned(0)).toBe('0.00')
  })
})

describe('formatPercent', () => {
  it('空显示 --，带正负号并以 % 结尾', () => {
    expect(formatPercent(null)).toBe('--')
    expect(formatPercent(1.23)).toBe('+1.23%')
    expect(formatPercent(-1.23)).toBe('-1.23%')
    expect(formatPercent(0)).toBe('0.00%')
  })
})

describe('formatAmount', () => {
  it('空显示 --', () => {
    expect(formatAmount(null)).toBe('--')
  })

  it('小于 1 亿用万元、保留 0 位小数', () => {
    expect(formatAmount(99999999)).toBe('10000 万元')
    expect(formatAmount(1234567)).toBe('123 万元')
  })

  it('大于等于 1 亿用亿元、保留 2 位小数', () => {
    expect(formatAmount(1e8)).toBe('1.00 亿元')
    expect(formatAmount(123450000)).toBe('1.23 亿元')
  })
})

describe('formatClockTime', () => {
  it('空值返回 null', () => {
    expect(formatClockTime(null)).toBeNull()
  })

  it('时间戳按本机时间输出 HH:mm:ss', () => {
    const ms = new Date(2026, 0, 5, 9, 30, 5).getTime()
    expect(formatClockTime(ms)).toBe('09:30:05')
  })
})

describe('formatDateLabel', () => {
  it('固定日期输出 MM-DD 并补零', () => {
    expect(formatDateLabel(new Date(2026, 0, 5))).toBe('01-05')
    expect(formatDateLabel(new Date(2026, 11, 31))).toBe('12-31')
  })
})

// ---------- 美股：时段 / 符号 / 指数 ----------

/** 构造固定 UTC 时刻，避免依赖运行机器的时区 */
function utc(iso: string): Date {
  return new Date(`${iso}Z`)
}

describe('usMarketOpen', () => {
  // 2025-07-15 周二，美东夏令时 EDT = UTC-4
  // 2025-01-15 周三，美东冬令时 EST = UTC-5
  it('夏令时下 09:30 开盘、16:00 收盘（左闭右开）', () => {
    expect(usMarketOpen(utc('2025-07-15T13:29:00'))).toBe(false) // 09:29
    expect(usMarketOpen(utc('2025-07-15T13:30:00'))).toBe(true) // 09:30
    expect(usMarketOpen(utc('2025-07-15T19:59:00'))).toBe(true) // 15:59
    expect(usMarketOpen(utc('2025-07-15T20:00:00'))).toBe(false) // 16:00
  })

  it('周六、周日全天返回 false', () => {
    expect(usMarketOpen(utc('2025-07-19T14:00:00'))).toBe(false)
    expect(usMarketOpen(utc('2025-07-19T23:00:00'))).toBe(false)
    expect(usMarketOpen(utc('2025-07-20T13:30:00'))).toBe(false)
  })

  it('冬令时 EST 换算同样正确', () => {
    expect(usMarketOpen(utc('2025-01-15T14:30:00'))).toBe(true) // 09:30
    expect(usMarketOpen(utc('2025-01-15T20:59:00'))).toBe(true) // 15:59
    expect(usMarketOpen(utc('2025-01-15T21:00:00'))).toBe(false) // 16:00
  })
})

describe('etParts', () => {
  it('夏令时返回与美东墙上时间一致的字段', () => {
    expect(etParts(utc('2025-07-15T13:30:00'))).toEqual({
      year: 2025,
      month: 7,
      day: 15,
      hour: 9,
      minute: 30,
      weekday: 2
    })
  })

  it('冬令时返回与美东墙上时间一致的字段', () => {
    expect(etParts(utc('2025-01-15T15:00:00'))).toEqual({
      year: 2025,
      month: 1,
      day: 15,
      hour: 10,
      minute: 0,
      weekday: 3
    })
  })
})

describe('nextUsOpenStart', () => {
  it('工作日开盘前 → 当天 09:30', () => {
    const now = utc('2025-07-15T12:00:00') // 美东 08:00
    const next = nextUsOpenStart(now)
    expect(next.at).toBe(utc('2025-07-15T13:30:00').getTime())
    expect(next.at).toBeGreaterThan(now.getTime())
    expect(next.label).toBe('09:30 开盘')
  })

  it('工作日盘中 → 下一个工作日 09:30，label 带日期', () => {
    const now = utc('2025-07-15T14:00:00') // 美东周二 10:00
    const next = nextUsOpenStart(now)
    expect(next.at).toBe(utc('2025-07-16T13:30:00').getTime())
    expect(next.at).toBeGreaterThan(now.getTime())
    expect(next.label).toBe('07-16 09:30 开盘')
  })

  it('周五收盘后 → 下周一 09:30', () => {
    const now = utc('2025-07-18T21:00:00') // 美东周五 17:00
    const next = nextUsOpenStart(now)
    expect(next.at).toBe(utc('2025-07-21T13:30:00').getTime())
    expect(next.at).toBeGreaterThan(now.getTime())
    expect(next.label).toBe('07-21 09:30 开盘')
  })
})

describe('usClosedReason', () => {
  it('周末休市', () => {
    expect(usClosedReason(utc('2025-07-19T18:00:00'))).toBe('周末休市')
  })

  it('工作日开盘前', () => {
    // 美东周三 08:00
    expect(usClosedReason(utc('2025-01-15T13:00:00'))).toBe('开盘前')
  })

  it('工作日收盘后', () => {
    // 美东周三 17:00
    expect(usClosedReason(utc('2025-01-15T22:00:00'))).toBe('已收盘')
  })

  it('开盘时段内返回空字符串', () => {
    expect(usClosedReason(utc('2025-07-15T13:30:00'))).toBe('')
    expect(usClosedReason(utc('2025-07-15T19:59:00'))).toBe('')
  })
})

describe('normalizeUsSymbol', () => {
  it('小写 ticker 转大写并拼上 us 前缀', () => {
    expect(normalizeUsSymbol('aapl')).toEqual({
      code: 'AAPL',
      symbol: 'usAAPL',
      market: 'us'
    })
  })

  it('带点号与首尾空格的 ticker 合法', () => {
    expect(normalizeUsSymbol(' brk.b ')).toEqual({
      code: 'BRK.B',
      symbol: 'usBRK.B',
      market: 'us'
    })
  })

  it('首字符非字母、空串、超长或含空格返回 null', () => {
    expect(normalizeUsSymbol('1ABC')).toBeNull()
    expect(normalizeUsSymbol('')).toBeNull()
    expect(normalizeUsSymbol('TOOLONGTICKER')).toBeNull()
    expect(normalizeUsSymbol('A B')).toBeNull()
  })
})

describe('美股 symbol 互转', () => {
  it('codeFromSymbol / marketFromSymbol 支持 us 前缀', () => {
    expect(codeFromSymbol('usAAPL')).toBe('AAPL')
    expect(marketFromSymbol('usAAPL')).toBe('us')
  })

  it('A 股行为保持不变', () => {
    expect(codeFromSymbol('sh600519')).toBe('600519')
    expect(codeFromSymbol('sz000001')).toBe('000001')
    expect(marketFromSymbol('sh600519')).toBe('sh')
    expect(marketFromSymbol('sz000001')).toBe('sz')
  })
})

describe('按市场取指数', () => {
  it('indexSymbolsOf(us) 返回美股四指数且顺序固定', () => {
    expect(indexSymbolsOf('us')).toEqual(['usDJI', 'usIXIC', 'usNDX', 'usINX'])
    expect(indexSymbolsOf('us')).toHaveLength(4)
  })

  it('indexSymbolsOf(cn) 仍为 A 股三指数', () => {
    expect(indexSymbolsOf('cn')).toEqual(['sh000001', 'sz399001', 'sz399006'])
  })

  it('indexNameOf 返回中美指数中文名', () => {
    expect(indexNameOf('usDJI')).toBe('道琼斯')
    expect(indexNameOf('usIXIC')).toBe('纳斯达克')
    expect(indexNameOf('usNDX')).toBe('纳斯达克100')
    expect(indexNameOf('usINX')).toBe('标普500')
    expect(indexNameOf('sh000001')).toBe('上证指数')
  })
})

describe('isMarketRegion', () => {
  it('合法值返回 true', () => {
    expect(isMarketRegion('cn')).toBe(true)
    expect(isMarketRegion('us')).toBe(true)
  })

  it('非法值返回 false', () => {
    expect(isMarketRegion('mars')).toBe(false)
    expect(isMarketRegion('')).toBe(false)
    expect(isMarketRegion(null)).toBe(false)
  })
})
