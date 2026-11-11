import { describe, expect, it } from 'vitest'
import { GOLD_NAMES, GOLD_SYMBOLS } from '../../src/shared/gold'
import {
  GOLD_QUOTE_ENDPOINT,
  parseGoldResponse
} from '../../src/main/gold-provider'

/** 真实接口响应片段（GBK 解码后的文本） */
const SAMPLE = [
  'var hq_str_gds_AU9999="869.00,0,868.66,869.00,878.60,862.05,09:57:40,883.42,876.00,93766,294.00,16.00,2026-11-11,沪金99";',
  'var hq_str_hf_XAU="4045.50,4032.730,4045.50,4045.85,4052.49,4026.55,09:57:00,4032.73,4035.41,0,0,0,2026-11-11,伦敦金（现货黄金）";',
  'var hq_str_fx_susdcnh="09:57:40,6.674200,6.674500,6.676300,73,6.676600,6.680600,6.673300,6.674200,离岸人民币（香港）,-0.030000,-0.002100,0.001093,,6.995700,6.642700,,2026-11-11";'
].join('\n')

describe('GOLD_QUOTE_ENDPOINT', () => {
  it('请求三类品种', () => {
    expect(GOLD_QUOTE_ENDPOINT).toBe(
      'https://hq.sinajs.cn/list=gds_AU9999,hf_XAU,fx_susdcnh'
    )
  })
})

describe('parseGoldResponse 三品种', () => {
  const quotes = parseGoldResponse(SAMPLE)

  it('顺序固定为 GOLD_SYMBOLS 且均不缺数据', () => {
    expect(quotes.map((quote) => quote.symbol)).toEqual([...GOLD_SYMBOLS])
    expect(quotes.every((quote) => quote.missing === false)).toBe(true)
  })

  it('解析沪金 99：现价、昨收、涨跌、时间与名称', () => {
    const quote = quotes[0]
    expect(quote.symbol).toBe('au9999')
    expect(quote.name).toBe('沪金99')
    expect(quote.price).toBe(869)
    expect(quote.prevClose).toBe(883.42)
    expect(quote.change).toBe(-14.42)
    expect(quote.changePercent).toBeCloseTo(-1.6323, 3)
    expect(quote.open).toBe(876)
    expect(quote.high).toBe(878.6)
    expect(quote.low).toBe(862.05)
    expect(quote.quoteTime).toBe('09:57:40')
  })

  it('解析伦敦金：昨收取第 8 列、今开为 null', () => {
    const quote = quotes[1]
    expect(quote.symbol).toBe('xau')
    expect(quote.name).toBe('伦敦金（现货黄金）')
    expect(quote.price).toBe(4045.5)
    expect(quote.prevClose).toBe(4032.73)
    expect(quote.change).toBe(12.77)
    expect(quote.changePercent).toBeCloseTo(0.3167, 3)
    expect(quote.open).toBeNull()
    expect(quote.high).toBe(4052.49)
    expect(quote.low).toBe(4026.55)
    expect(quote.quoteTime).toBe('09:57:00')
  })

  it('解析离岸人民币：涨跌取接口字段，昨收由现价反推', () => {
    const quote = quotes[2]
    expect(quote.symbol).toBe('cnh')
    expect(quote.name).toBe('离岸人民币（香港）')
    expect(quote.price).toBe(6.6742)
    expect(quote.prevClose).toBe(6.6763)
    expect(quote.change).toBe(-0.0021)
    expect(quote.changePercent).toBe(-0.03)
    expect(quote.open).toBeNull()
    expect(quote.high).toBeNull()
    expect(quote.low).toBeNull()
    expect(quote.quoteTime).toBe('09:57:40')
  })
})

describe('parseGoldResponse 缺失与容错', () => {
  it('响应缺少品种时返回空 Quote 并用 GOLD_NAMES 兜底', () => {
    const quotes = parseGoldResponse(SAMPLE.split('\n')[0])

    expect(quotes).toHaveLength(3)
    expect(quotes[0].price).toBe(869)
    expect(quotes[1]).toMatchObject({
      symbol: 'xau',
      name: GOLD_NAMES.xau,
      price: null,
      prevClose: null,
      change: null,
      changePercent: null,
      quoteTime: null,
      missing: true
    })
    expect(quotes[2]).toMatchObject({
      symbol: 'cnh',
      name: GOLD_NAMES.cnh,
      price: null,
      missing: true
    })
  })

  it('伦敦金第 8 列为空时昨收回落到第 2 列', () => {
    const line =
      'var hq_str_hf_XAU="4045.50,4045.50,4045.50,4045.85,4052.49,4026.55,' +
      '09:57:00,,4035.41,0,0,0,2026-11-11,伦敦金（现货黄金）";'
    const quote = parseGoldResponse(line)[1]

    expect(quote.prevClose).toBe(4045.5)
    expect(quote.change).toBe(0)
    expect(quote.changePercent).toBe(0)
    expect(quote.missing).toBe(false)
  })

  it('空串与嘈杂前缀不抛异常', () => {
    expect(() => parseGoldResponse('')).not.toThrow()
    const empty = parseGoldResponse('')
    expect(empty.map((quote) => quote.missing)).toEqual([true, true, true])

    const noisy = `一些无关内容\n${SAMPLE}\n另一行 noise`
    expect(() => parseGoldResponse(noisy)).not.toThrow()
    expect(parseGoldResponse(noisy).map((quote) => quote.price)).toEqual([
      869, 4045.5, 6.6742
    ])
  })

  it('某个品种价格非法时标记 missing 且其余字段不伪造', () => {
    const line =
      'var hq_str_gds_AU9999="--,0,868.66,869.00,878.60,862.05,' +
      '09:57:40,883.42,876.00,93766,294.00,16.00,2026-11-11,沪金99";'
    const quote = parseGoldResponse(line)[0]

    expect(quote.price).toBeNull()
    expect(quote.change).toBeNull()
    expect(quote.changePercent).toBeNull()
    expect(quote.missing).toBe(true)
    expect(quote.name).toBe('沪金99')
  })
})
