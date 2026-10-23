import { describe, expect, it, vi } from 'vitest'
import { HOLIDAY_API_BASE, fetchHolidayYear } from './holiday-provider'

/** 构造 fetch 可返回的极简响应对象 */
function makeResponse(status: number, payload?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as unknown as Response
}

/** 把响应对象包成 fetch 实现 */
function fetchOnce(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

/** 构造一条接口返回的节假日记录 */
function makeItem(
  date: string,
  name: string,
  holiday: boolean
): Record<string, unknown> {
  return { date, name, holiday }
}

describe('fetchHolidayYear 正常解析', () => {
  it('holiday 为 true/false 分别映射为 holiday/workday，并按日期升序', async () => {
    const payload = {
      code: 0,
      holiday: {
        国庆: makeItem('2026-10-01', '国庆节', true),
        补班: makeItem('2026-10-10', '国庆节后补班', false),
        元旦: makeItem('2026-01-01', '元旦', true)
      }
    }

    const result = await fetchHolidayYear(2026, {
      fetchImpl: fetchOnce(makeResponse(200, payload))
    })

    expect(result).toEqual({
      ok: true,
      entries: [
        { date: '2026-01-01', name: '元旦', type: 'holiday' },
        { date: '2026-10-01', name: '国庆节', type: 'holiday' },
        { date: '2026-10-10', name: '国庆节后补班', type: 'workday' }
      ]
    })
  })

  it('同日期去重保留最后一条，只保留 date/name/type', async () => {
    const payload = {
      code: 0,
      holiday: {
        旧: { date: '2026-01-01', name: '旧名', holiday: true, wage: 3 },
        新: { date: '2026-01-01', name: '新名', holiday: false }
      }
    }

    const result = await fetchHolidayYear(2026, {
      fetchImpl: fetchOnce(makeResponse(200, payload))
    })

    expect(result).toEqual({
      ok: true,
      entries: [{ date: '2026-01-01', name: '新名', type: 'workday' }]
    })
  })

  it('请求 URL 与 User-Agent 正确', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return makeResponse(200, { code: 0, holiday: {} })
    })

    await fetchHolidayYear(2026, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(calls[0].url).toBe(`${HOLIDAY_API_BASE}/2026`)
    expect(calls[0].init?.headers).toEqual({
      'User-Agent': 'reminder-app'
    })
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('fetchHolidayYear 结构校验', () => {
  it('code 不为 0 归因为 invalid', async () => {
    const result = await fetchHolidayYear(2026, {
      fetchImpl: fetchOnce(makeResponse(200, { code: 1, holiday: {} }))
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('顶层缺 holiday 归因为 invalid', async () => {
    const result = await fetchHolidayYear(2026, {
      fetchImpl: fetchOnce(makeResponse(200, { code: 0 }))
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('holiday 不是对象（数组 / null / 字符串）归因为 invalid', async () => {
    for (const holiday of [[], null, 'x']) {
      const result = await fetchHolidayYear(2026, {
        fetchImpl: fetchOnce(makeResponse(200, { code: 0, holiday }))
      })
      expect(result).toEqual({ ok: false, reason: 'invalid' })
    }
  })

  it('JSON 解析失败归因为 invalid', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json')
      }
    }))

    const result = await fetchHolidayYear(2026, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('单条缺字段 / 日期非法 / 非对象时跳过，其余保留', async () => {
    const payload = {
      code: 0,
      holiday: {
        保留: makeItem('2026-05-01', '劳动节', true),
        缺日期: { name: '无日期', holiday: true },
        缺名称: { date: '2026-05-02', holiday: true },
        空名称: makeItem('2026-05-03', '', true),
        缺标记: { date: '2026-05-04', name: '无标记' },
        标记非布尔: { date: '2026-05-05', name: '标记非法', holiday: 'yes' },
        日期非法: makeItem('2026-02-30', '假日期', true),
        空值: null
      }
    }

    const result = await fetchHolidayYear(2026, {
      fetchImpl: fetchOnce(makeResponse(200, payload))
    })

    expect(result).toEqual({
      ok: true,
      entries: [{ date: '2026-05-01', name: '劳动节', type: 'holiday' }]
    })
  })
})

describe('fetchHolidayYear 失败归因', () => {
  it('非 200 归因为 http', async () => {
    const result = await fetchHolidayYear(2026, {
      fetchImpl: fetchOnce(makeResponse(403))
    })
    expect(result).toEqual({ ok: false, reason: 'http' })
  })

  it('fetch reject 归因为 network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom')
    })
    const result = await fetchHolidayYear(2026, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect(result).toEqual({ ok: false, reason: 'network' })
  })

  it('fetch 永不 resolve 时按超时归因为 timeout', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined))
    const startedAt = Date.now()

    const result = await fetchHolidayYear(2026, {
      timeoutMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result).toEqual({ ok: false, reason: 'timeout' })
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })
})

describe('fetchHolidayYear 年份校验', () => {
  it('非法年份不发请求并归因为 invalid', async () => {
    for (const year of [0, 2101, 2026.5]) {
      const fetchImpl = vi.fn(async () => makeResponse(200, {}))
      const result = await fetchHolidayYear(year, {
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
      expect(result).toEqual({ ok: false, reason: 'invalid' })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })
})
