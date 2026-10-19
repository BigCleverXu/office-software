import { describe, expect, it, vi } from 'vitest'
import {
  QUOTE_ENDPOINT,
  fetchQuotes,
  parseQuoteResponse
} from './quote-provider'

/** 构造 40 个字段的 payload（首元素固定为 '1'），overrides 覆盖指定下标 */
function makePayload(overrides: Record<number, string>): string {
  const fields: string[] = new Array(40).fill('')
  fields[0] = '1'
  for (const key of Object.keys(overrides)) {
    const index = Number(key)
    fields[index] = overrides[index]
  }
  return fields.join('~')
}

/** 拼一条 `v_<symbol>="<payload>";` 行 */
function makeLine(symbol: string, fields: Record<number, string>): string {
  return `v_${symbol}="${makePayload(fields)}";`
}

/** 把文本按字节转成 ArrayBuffer，模拟网络响应体 */
function toArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text)
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  )
}

describe('parseQuoteResponse 正常解析', () => {
  it('解析完整字段并完成成交额万元→元换算', () => {
    const text = makeLine('sh600519', {
      1: 'Moutai',
      2: '600519',
      3: '1700.50',
      4: '1650.00',
      5: '1660.00',
      30: '20260414150000',
      33: '1710.00',
      34: '1645.00',
      37: '1234.5'
    })
    const [quote] = parseQuoteResponse(text, ['sh600519'])

    expect(quote.symbol).toBe('sh600519')
    expect(quote.code).toBe('600519')
    expect(quote.market).toBe('sh')
    expect(quote.name).toBe('Moutai')
    expect(quote.price).toBe(1700.5)
    expect(quote.prevClose).toBe(1650)
    expect(quote.open).toBe(1660)
    expect(quote.high).toBe(1710)
    expect(quote.low).toBe(1645)
    // 1234.5 万元 = 12345000 元
    expect(quote.amount).toBe(12345000)
    expect(quote.quoteTime).toBe('15:00:00')
    expect(quote.missing).toBe(false)
  })

  it('change / changePercent 由现价与昨收计算（上涨）', () => {
    const text = makeLine('sh600519', {
      1: 'Up',
      2: '600519',
      3: '110',
      4: '100'
    })
    const [quote] = parseQuoteResponse(text, ['sh600519'])

    expect(quote.change).toBe(10)
    expect(quote.changePercent).toBe(10)
  })

  it('change / changePercent 由现价与昨收计算（下跌）', () => {
    const text = makeLine('sh600519', {
      1: 'Down',
      2: '600519',
      3: '90',
      4: '100'
    })
    const [quote] = parseQuoteResponse(text, ['sh600519'])

    expect(quote.change).toBe(-10)
    expect(quote.changePercent).toBe(-10)
  })

  it('昨收为 0 时 changePercent 为 null，change 仍为现价', () => {
    const text = makeLine('sh600519', {
      1: 'Zero',
      2: '600519',
      3: '100',
      4: '0'
    })
    const [quote] = parseQuoteResponse(text, ['sh600519'])

    expect(quote.change).toBe(100)
    expect(quote.changePercent).toBeNull()
    expect(quote.missing).toBe(false)
  })
})

describe('parseQuoteResponse 缺失与异常', () => {
  it('响应中缺失的 symbol 返回 missing 空 Quote 且顺序对齐', () => {
    const text = makeLine('sh600519', {
      1: 'Moutai',
      2: '600519',
      3: '1700.50',
      4: '1650.00'
    })
    const result = parseQuoteResponse(text, ['sh600519', 'sz000001'])

    expect(result).toHaveLength(2)
    const absent = result[1]
    expect(absent.symbol).toBe('sz000001')
    expect(absent.code).toBe('000001')
    expect(absent.market).toBe('sz')
    expect(absent.name).toBe('')
    expect(absent.price).toBeNull()
    expect(absent.prevClose).toBeNull()
    expect(absent.amount).toBeNull()
    expect(absent.missing).toBe(true)
  })

  it('停牌（现价为 0）标记 missing，但保留名称', () => {
    const text = makeLine('sh600519', {
      1: 'Paused',
      2: '600519',
      3: '0',
      4: '1650.00'
    })
    const [quote] = parseQuoteResponse(text, ['sh600519'])

    expect(quote.missing).toBe(true)
    expect(quote.name).toBe('Paused')
    expect(quote.price).toBeNull()
    expect(quote.change).toBeNull()
    expect(quote.changePercent).toBeNull()
  })

  it('停牌（现价为空）标记 missing，但保留名称', () => {
    const text = makeLine('sh600519', {
      1: 'Paused2',
      2: '600519',
      3: '',
      4: '1650.00'
    })
    const [quote] = parseQuoteResponse(text, ['sh600519'])

    expect(quote.missing).toBe(true)
    expect(quote.name).toBe('Paused2')
    expect(quote.price).toBeNull()
  })

  it('非法字段（-- 与空串）记为 null', () => {
    const text = makeLine('sh600519', {
      1: 'Bad',
      2: '600519',
      3: '--',
      4: '',
      5: '',
      33: '--',
      34: '',
      37: ''
    })
    const [quote] = parseQuoteResponse(text, ['sh600519'])

    expect(quote.price).toBeNull()
    expect(quote.prevClose).toBeNull()
    expect(quote.open).toBeNull()
    expect(quote.high).toBeNull()
    expect(quote.low).toBeNull()
    expect(quote.amount).toBeNull()
    expect(quote.quoteTime).toBeNull()
    expect(quote.missing).toBe(true)
  })

  it('多行以 ; 与换行分隔、行首尾空白不影响解析', () => {
    const first = makeLine('sh600519', {
      1: 'A',
      2: '600519',
      3: '10',
      4: '9'
    })
    const second = makeLine('sz000001', {
      1: 'B',
      2: '000001',
      3: '20',
      4: '19'
    })
    const text = `  ${first}   \n${second}  \n\n`
    const result = parseQuoteResponse(text, ['sh600519', 'sz000001'])

    expect(result[0].name).toBe('A')
    expect(result[0].price).toBe(10)
    expect(result[1].name).toBe('B')
    expect(result[1].price).toBe(20)
  })

  it('输出顺序严格按 requested 顺序', () => {
    const text =
      makeLine('sz399001', {
        1: 'SZDEEP',
        2: '399001',
        3: '1',
        4: '1'
      }) +
      '\n' +
      makeLine('sh000001', {
        1: 'SHINDEX',
        2: '000001',
        3: '2',
        4: '2'
      })
    // 响应的物理顺序与 requested 相反
    const result = parseQuoteResponse(text, ['sh000001', 'sz399001'])

    expect(result.map((quote) => quote.symbol)).toEqual([
      'sh000001',
      'sz399001'
    ])
    expect(result[0].name).toBe('SHINDEX')
    expect(result[1].name).toBe('SZDEEP')
  })
})

describe('fetchQuotes', () => {
  it('请求正确 URL 并解析响应（ASCII 样本，避免 GBK 断言脆弱）', async () => {
    const text = makeLine('sh600519', {
      1: 'Moutai',
      2: '600519',
      3: '1700.50',
      4: '1650.00',
      5: '1660.00',
      33: '1710.00',
      34: '1645.00',
      37: '1234.5',
      30: '20260414150000'
    })
    const arrayBuffer = toArrayBuffer(text)
    const requestedUrls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => arrayBuffer
      }
    })

    const result = await fetchQuotes(['sh600519'], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(requestedUrls).toEqual([`${QUOTE_ENDPOINT}sh600519`])
    expect(result[0].name).toBe('Moutai')
    expect(result[0].price).toBe(1700.5)
    expect(result[0].amount).toBe(12345000)
    expect(result[0].quoteTime).toBe('15:00:00')
  })

  it('多符号以逗号拼接为单个请求', async () => {
    const requestedUrls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(0)
      }
    })

    await fetchQuotes(['sh000001', 'sz399001', 'sz399006'], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(requestedUrls).toEqual([
      `${QUOTE_ENDPOINT}sh000001,sz399001,sz399006`
    ])
  })

  it('符号为空时返回 [] 且不发起请求', async () => {
    const fetchImpl = vi.fn()

    const result = await fetchQuotes([], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('非 2xx 状态抛出错误', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0)
    }))

    await expect(
      fetchQuotes(['sh600519'], {
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow()
  })

  it('超时抛出错误且不挂起', async () => {
    // 监听 abort 后 reject 的 fetch 实现，配合极短 timeoutMs
    const fetchImpl = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
    )

    await expect(
      fetchQuotes(['sh600519'], {
        timeoutMs: 5,
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow('行情请求超时')
  })
})
