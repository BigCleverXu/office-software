import { describe, expect, it, vi } from 'vitest'
import {
  US_QUOTE_ENDPOINT,
  fetchUsQuotes,
  parseUsQuoteResponse
} from './us-quote-provider'

/** 构造与真实接口一致的 ``v_symbol="字段~字段..."`` 行 */
function quoteLine(symbol: string, fields: Record<number, string>): string {
  const payload = Array.from({ length: 40 }, () => '')
  for (const [index, value] of Object.entries(fields)) {
    payload[Number(index)] = value
  }
  return `v_${symbol}="${payload.join('~')}"`
}

/** 苹果固定行：字段索引与真实接口一致 */
const APPLE_FIELDS: Record<number, string> = {
  0: '200',
  1: '苹果',
  2: 'AAPL.OQ',
  3: '234.5',
  4: '230',
  5: '231.2',
  30: '2025-07-15 15:59:59',
  31: '4.5',
  32: '1.96',
  33: '236.1',
  34: '229.8',
  37: '12345678'
}

/** 构造最小 Response 替身，避免依赖全局 fetch */
function fakeResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer)
  } as unknown as Response
}

describe('parseUsQuoteResponse', () => {
  it('字段映射正确且涨跌按现价与昨收自算', () => {
    const text = quoteLine('usAAPL', APPLE_FIELDS)
    const quotes = parseUsQuoteResponse(text, ['usAAPL'])

    expect(quotes).toHaveLength(1)
    expect(quotes[0]).toEqual({
      symbol: 'usAAPL',
      code: 'AAPL',
      market: 'us',
      name: '苹果',
      price: 234.5,
      prevClose: 230,
      change: 4.5,
      changePercent: 1.9565,
      open: 231.2,
      high: 236.1,
      low: 229.8,
      amount: 12345678,
      quoteTime: '15:59:59',
      missing: false
    })
  })

  it('amount 直接取 [37] 原值，不乘 10000', () => {
    const text = quoteLine('usAAPL', APPLE_FIELDS)
    const [quote] = parseUsQuoteResponse(text, ['usAAPL'])
    expect(quote.amount).toBe(12345678)
  })

  it('现价为 0 视为缺失', () => {
    const text = quoteLine('usAAPL', { ...APPLE_FIELDS, 3: '0' })
    const [quote] = parseUsQuoteResponse(text, ['usAAPL'])

    expect(quote.price).toBeNull()
    expect(quote.missing).toBe(true)
    expect(quote.change).toBeNull()
    expect(quote.changePercent).toBeNull()
  })

  it('现价为空或 -- 视为缺失', () => {
    const emptyPrice = quoteLine('usAAPL', { ...APPLE_FIELDS, 3: '' })
    expect(parseUsQuoteResponse(emptyPrice, ['usAAPL'])[0].price).toBeNull()

    const dashPrice = quoteLine('usAAPL', { ...APPLE_FIELDS, 3: '--' })
    const [dashQuote] = parseUsQuoteResponse(dashPrice, ['usAAPL'])
    expect(dashQuote.price).toBeNull()
    expect(dashQuote.missing).toBe(true)
  })

  it('响应中缺失的标的返回空 Quote，顺序与 requested 一致', () => {
    const text = quoteLine('usAAPL', APPLE_FIELDS)
    const quotes = parseUsQuoteResponse(text, ['usMSFT', 'usAAPL'])

    expect(quotes).toHaveLength(2)
    expect(quotes[0]).toMatchObject({
      symbol: 'usMSFT',
      code: 'MSFT',
      market: 'us',
      name: '',
      missing: true
    })
    expect(quotes[0].price).toBeNull()
    expect(quotes[1].symbol).toBe('usAAPL')
    expect(quotes[1].price).toBe(234.5)
  })

  it('symbol 大小写不敏感匹配', () => {
    const text = quoteLine('usaapl', APPLE_FIELDS)
    const [quote] = parseUsQuoteResponse(text, ['usAAPL'])
    expect(quote.price).toBe(234.5)
  })
})

describe('fetchUsQuotes', () => {
  it('正常响应按 symbol 拼接 URL 并解析', async () => {
    const text = quoteLine('usAAPL', APPLE_FIELDS)
    let requestedUrl = ''
    let requestedSignal: AbortSignal | undefined
    const fetchImpl = vi.fn(
      async (url: string, init?: { signal?: AbortSignal }) => {
        requestedUrl = url
        requestedSignal = init?.signal
        return fakeResponse(text)
      }
    )

    const quotes = await fetchUsQuotes(['usAAPL', 'usMSFT'], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(quotes).toHaveLength(2)
    expect(quotes[0].price).toBe(234.5)
    expect(quotes[1].missing).toBe(true)

    expect(requestedUrl.startsWith(US_QUOTE_ENDPOINT)).toBe(true)
    expect(requestedUrl).toContain('usAAPL,usMSFT')
    expect(requestedSignal).toBeInstanceOf(AbortSignal)
  })

  it('非 2xx 响应抛 HTTP 状态错误', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse('', 500))

    await expect(
      fetchUsQuotes(['usAAPL'], {
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow('HTTP 500')
  })

  it('超时抛出行情请求超时', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
    )

    await expect(
      fetchUsQuotes(['usAAPL'], {
        timeoutMs: 10,
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow('超时')
  })

  it('空 symbol 列表直接返回空数组且不请求', async () => {
    const fetchImpl = vi.fn()

    const quotes = await fetchUsQuotes([], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(quotes).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
