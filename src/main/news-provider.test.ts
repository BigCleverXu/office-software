import { describe, expect, it, vi } from 'vitest'
import {
  NEWS_ENDPOINT,
  fetchNewsSections,
  parsePlatformNews
} from './news-provider'

/** 构造一个最小可用的 Response 桩，仅提供取数层用到的字段 */
function makeResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as unknown as Response
}

/** 构造接口成功响应体 */
function makePayload(data: unknown[], status: unknown = '200'): unknown {
  return { status, data }
}

describe('parsePlatformNews 正常解析', () => {
  it('解析条目，content 为 null 与 publish_time 缺失时兜底为空字符串', () => {
    const payload = makePayload([
      {
        title: '第一条',
        url: 'https://example.com/1',
        content: null,
        publish_time: '2026-10-25 10:00:00'
      },
      {
        title: '第二条',
        url: 'https://example.com/2'
      }
    ])

    const section = parsePlatformNews('baidu', payload)

    expect(section.platform).toBe('baidu')
    expect(section.error).toBeNull()
    expect(section.items).toEqual([
      {
        title: '第一条',
        url: 'https://example.com/1',
        content: '',
        publishTime: '2026-10-25 10:00:00'
      },
      {
        title: '第二条',
        url: 'https://example.com/2',
        content: '',
        publishTime: ''
      }
    ])
  })

  it('非字符串 content 与 publish_time 一律兜底为空字符串', () => {
    const payload = makePayload([
      {
        title: '条目',
        url: 'https://example.com/3',
        content: 123,
        publish_time: null
      }
    ])

    const [item] = parsePlatformNews('weibo', payload).items

    expect(item.content).toBe('')
    expect(item.publishTime).toBe('')
  })

  it('空 data 数组是合法结果', () => {
    const section = parsePlatformNews('zhihu', makePayload([]))

    expect(section).toEqual({ platform: 'zhihu', items: [], error: null })
  })
})

describe('parsePlatformNews 条目过滤', () => {
  it('丢弃缺 title / 缺 url / 空白 title 的条目', () => {
    const payload = makePayload([
      { url: 'https://example.com/no-title' },
      { title: '缺链接' },
      { title: '   ', url: 'https://example.com/blank' },
      { title: '合法', url: 'https://example.com/ok' }
    ])

    const section = parsePlatformNews('36kr', payload)

    expect(section.error).toBeNull()
    expect(section.items).toHaveLength(1)
    expect(section.items[0].title).toBe('合法')
  })

  it('条目为 null 等非对象值时丢弃', () => {
    const payload = makePayload([
      null,
      'text',
      123,
      { title: '合法', url: 'https://example.com/ok' }
    ])

    const section = parsePlatformNews('36kr', payload)

    expect(section.items).toHaveLength(1)
    expect(section.items[0].title).toBe('合法')
  })
})

describe('parsePlatformNews 异常数据', () => {
  it('status 非 200 返回格式异常', () => {
    const section = parsePlatformNews(
      'baidu',
      makePayload([{ title: 'A', url: 'https://a' }], '500')
    )

    expect(section).toEqual({
      platform: 'baidu',
      items: [],
      error: '返回数据格式异常'
    })
  })

  it('status 为数字 200 时按成功处理', () => {
    const section = parsePlatformNews(
      'baidu',
      makePayload([{ title: 'A', url: 'https://a' }], 200)
    )

    expect(section.error).toBeNull()
    expect(section.items).toHaveLength(1)
  })

  it('data 非数组返回格式异常', () => {
    const section = parsePlatformNews('baidu', {
      status: '200',
      data: { title: 'A' }
    })

    expect(section.error).toBe('返回数据格式异常')
    expect(section.items).toEqual([])
  })

  it('payload 非对象返回格式异常', () => {
    expect(parsePlatformNews('baidu', null).error).toBe('返回数据格式异常')
    expect(parsePlatformNews('baidu', 'oops').error).toBe('返回数据格式异常')
    expect(parsePlatformNews('baidu', ['x']).error).toBe('返回数据格式异常')
  })
})

describe('fetchNewsSections 请求层', () => {
  it('请求 URL 拼接正确', async () => {
    const requestedUrls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      return makeResponse(makePayload([]))
    })

    await fetchNewsSections(['baidu'], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(requestedUrls).toEqual([`${NEWS_ENDPOINT}baidu`])
    expect(requestedUrls[0]).toBe(
      'https://news.orz.ai/api/v1/dailynews/?platform=baidu'
    )
  })

  it('HTTP 500 时 error 为请求失败（HTTP 500）', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({}, 500))

    const [section] = await fetchNewsSections(['baidu'], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(section.platform).toBe('baidu')
    expect(section.items).toEqual([])
    expect(section.error).toBe('请求失败（HTTP 500）')
  })

  it('fetch 抛错时 error 为网络请求失败', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })

    const [section] = await fetchNewsSections(['baidu'], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(section.error).toBe('网络请求失败')
  })

  it('JSON 解析失败时 error 为返回数据格式异常', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json')
      }
    }))

    const [section] = await fetchNewsSections(['baidu'], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(section.error).toBe('返回数据格式异常')
  })

  it('超时返回请求超时且不挂起', async () => {
    // 永不 resolve，仅监听 abort 后 reject
    const fetchImpl = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
    )

    const [section] = await fetchNewsSections(['baidu'], {
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(section.error).toBe('请求超时')
    expect(section.items).toEqual([])
  })

  it('多平台并发：一成功一失败，分组齐全且顺序与入参一致', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('weibo')) {
        throw new Error('network down')
      }
      return makeResponse(
        makePayload([{ title: '百度新闻', url: 'https://a' }])
      )
    })

    const sections = await fetchNewsSections(['baidu', 'weibo'], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sections).toHaveLength(2)
    expect(sections.map((section) => section.platform)).toEqual([
      'baidu',
      'weibo'
    ])
    expect(sections[0].items).toHaveLength(1)
    expect(sections[0].error).toBeNull()
    expect(sections[1].items).toEqual([])
    expect(sections[1].error).toBeTruthy()
  })

  it('入参为空返回空数组且不发起请求', async () => {
    const fetchImpl = vi.fn()

    const sections = await fetchNewsSections([], {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(sections).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
