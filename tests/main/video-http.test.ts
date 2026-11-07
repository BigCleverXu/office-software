import { describe, expect, it } from 'vitest'
import {
  VideoHttpClient,
  VideoHttpError
} from '../../src/main/video/http-client'
import {
  BilibiliWbiSigner,
  mixinKey,
  signWbiParams
} from '../../src/main/video/signing'

/** 一次被记录的 fetch 调用 */
interface FetchCall {
  url: string
  init: RequestInit
}

/** 把测试用 fetch 实现收窄为全局 fetch 类型 */
function asFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>
): typeof fetch {
  return impl as unknown as typeof fetch
}

/** 构造响应；body 为 null 表示空响应体 */
function makeResponse(
  status: number,
  body: string | null = null,
  headers: HeadersInit = {}
): Response {
  return new Response(body, { status, headers })
}

/** 记录每次 fetch 调用并按序返回预设响应 */
function recordingFetch(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = asFetch(async (url, init) => {
    const call: FetchCall = { url, init: init ?? {} }
    calls.push(call)
    return handler(call, calls.length - 1)
  })
  return { fetchImpl, calls }
}

/** 读取调用携带的请求头 */
function headerOf(call: FetchCall, name: string): string | null {
  return new Headers(call.init.headers).get(name)
}

/** 立即完成的 sleep，并记录每次等待时长 */
function fastSleep(): {
  sleep: (ms: number) => Promise<void>
  delays: number[]
} {
  const delays: number[] = []
  return {
    sleep: async (ms: number) => {
      delays.push(ms)
    },
    delays
  }
}

/** 捕获 Promise 的拒绝原因，便于断言错误类型 */
async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('预期请求失败，实际成功')
}

describe('VideoHttpClient 重试与错误归因', () => {
  it('429 后重试并最终成功', async () => {
    const { sleep, delays } = fastSleep()
    const { fetchImpl, calls } = recordingFetch((_call, index) =>
      index === 0
        ? makeResponse(429, null, { 'retry-after': '0' })
        : makeResponse(200, '{"ok":true}', {
            'content-type': 'application/json'
          })
    )
    const client = new VideoHttpClient({ fetchImpl, sleep, random: () => 0 })

    const response = await client.request({
      url: 'https://www.douyin.com/aweme/v1/web/detail/',
      platform: 'douyin'
    })

    expect(response.status).toBe(200)
    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    // Retry-After=0 立即重试，另有请求间抖动
    expect(delays.some((delay) => delay === 0)).toBe(true)
    expect(delays.some((delay) => delay >= 100 && delay <= 600)).toBe(true)
  })

  it('连续 429 耗尽重试后返回 rate-limited', async () => {
    const { sleep } = fastSleep()
    const { fetchImpl, calls } = recordingFetch(() =>
      makeResponse(429, null, { 'retry-after': '1' })
    )
    const client = new VideoHttpClient({
      fetchImpl,
      sleep,
      random: () => 0,
      maxRetries: 2
    })

    const error = await captureError(
      client.request({
        url: 'https://www.douyin.com/aweme/v1/web/detail/',
        platform: 'douyin'
      })
    )

    expect(error).toBeInstanceOf(VideoHttpError)
    const httpError = error as VideoHttpError
    expect(httpError.reason).toBe('rate-limited')
    expect(httpError.status).toBe(429)
    // 首次 + 2 次重试
    expect(calls).toHaveLength(3)
  })

  it('网络异常重试后成功', async () => {
    const { sleep } = fastSleep()
    const { fetchImpl, calls } = recordingFetch((_call, index) => {
      if (index === 0) {
        throw new TypeError('fetch failed')
      }
      return makeResponse(200, 'ok')
    })
    const client = new VideoHttpClient({
      fetchImpl,
      sleep,
      random: () => 0,
      maxRetries: 1
    })

    const response = await client.request({
      url: 'https://www.kuaishou.com/graphql',
      platform: 'kuaishou'
    })

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('ok')
    expect(calls).toHaveLength(2)
  })

  it('超时以 timeout 拒绝且不重试', async () => {
    const { sleep, delays } = fastSleep()
    const { fetchImpl, calls } = recordingFetch(
      () => new Promise<Response>(() => undefined)
    )
    const client = new VideoHttpClient({ fetchImpl, sleep, random: () => 0 })

    const error = await captureError(
      client.request({
        url: 'https://www.douyin.com/aweme/v1/web/detail/',
        platform: 'douyin',
        timeoutMs: 20
      })
    )

    expect(error).toBeInstanceOf(VideoHttpError)
    expect((error as VideoHttpError).reason).toBe('timeout')
    expect(calls).toHaveLength(1)
    // 只有请求抖动，没有退避等待
    expect(delays.every((delay) => delay < 500)).toBe(true)
  })
})

describe('VideoHttpClient 限流与并发', () => {
  it('同主机默认并发为 1，按顺序放行', async () => {
    const { sleep } = fastSleep()
    let active = 0
    let maxActive = 0
    const releases: Array<() => void> = []
    const { fetchImpl, calls } = recordingFetch(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => {
        releases.push(resolve)
      })
      active -= 1
      return makeResponse(200, 'ok')
    })
    const client = new VideoHttpClient({ fetchImpl, sleep, random: () => 0 })

    const first = client.request({
      url: 'https://www.douyin.com/a',
      platform: 'douyin'
    })
    const second = client.request({
      url: 'https://www.douyin.com/b',
      platform: 'douyin'
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://www.douyin.com/a')

    releases.shift()?.()
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toBe('https://www.douyin.com/b')

    releases.shift()?.()
    await Promise.all([first, second])
    expect(maxActive).toBe(1)
  })

  it('令牌耗尽后按注入时钟等待补充', async () => {
    let clock = 0
    const delays: number[] = []
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms)
      clock += ms
    }
    const { fetchImpl, calls } = recordingFetch(() => makeResponse(200, 'ok'))
    const client = new VideoHttpClient({
      fetchImpl,
      sleep,
      now: () => clock,
      random: () => 0,
      tokenCapacity: 1,
      tokensPerSecond: 1,
      maxConcurrencyPerHost: 4
    })

    await Promise.all([
      client.request({
        url: 'https://www.bilibili.com/a',
        platform: 'bilibili'
      }),
      client.request({
        url: 'https://www.bilibili.com/b',
        platform: 'bilibili'
      })
    ])

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toBe('https://www.bilibili.com/a')
    expect(calls[1]?.url).toBe('https://www.bilibili.com/b')
    // 首个请求消耗唯一的令牌并抖动 100ms，第二个需再等约 900ms
    expect(delays.some((delay) => delay >= 800 && delay <= 1000)).toBe(true)
  })

  it('回填 Set-Cookie 并支持手动补种', async () => {
    const { sleep } = fastSleep()
    const { fetchImpl, calls } = recordingFetch((call) => {
      if (!call.url.endsWith('/first')) {
        return makeResponse(200, 'ok')
      }
      const headers = new Headers()
      headers.append('set-cookie', 'ttwid=abc; Path=/; HttpOnly')
      headers.append('set-cookie', 'sid=xyz; Domain=.douyin.com; Secure')
      return new Response('ok', { status: 200, headers })
    })
    const client = new VideoHttpClient({ fetchImpl, sleep, random: () => 0 })

    await client.request({
      url: 'https://www.douyin.com/first',
      platform: 'douyin'
    })
    await client.request({
      url: 'https://www.douyin.com/second',
      platform: 'douyin'
    })

    expect(calls).toHaveLength(2)
    expect(client.getCookies('www.douyin.com')).toBe('ttwid=abc; sid=xyz')

    const second = calls[1]
    expect(second === undefined ? null : headerOf(second, 'cookie')).toBe(
      'ttwid=abc; sid=xyz'
    )
    // 默认浏览器请求头
    const first = calls[0]
    if (first === undefined) {
      throw new Error('缺少首个请求')
    }
    expect(headerOf(first, 'user-agent')).toContain('Windows NT')
    expect(headerOf(first, 'accept-language')).toBe('zh-CN,zh;q=0.9')
    expect(headerOf(first, 'referer')).toBe('https://www.douyin.com/')

    client.setCookie('www.douyin.com', 'extra=1; Path=/')
    expect(client.getCookies('https://www.douyin.com/x')).toContain('extra=1')
  })
})

describe('VideoHttpClient.resolveRedirect', () => {
  /** 按地址顺序构造重定向链：除最后一个外均返回 302 */
  function chainFetch(chain: string[]): {
    fetchImpl: typeof fetch
    calls: FetchCall[]
  } {
    return recordingFetch((call) => {
      const index = chain.indexOf(call.url)
      const next = index >= 0 ? chain[index + 1] : undefined
      if (next === undefined) {
        return makeResponse(200, 'ok')
      }
      return makeResponse(302, null, { location: next })
    })
  }

  it('跟随 5 跳返回最终地址与每一跳', async () => {
    const { sleep } = fastSleep()
    const chain = [
      'https://b23.tv/abc',
      'https://www.bilibili.com/video/1',
      'https://m.bilibili.com/video/2',
      'https://www.bilibili.com/video/3',
      'https://m.bilibili.com/video/4',
      'https://www.bilibili.com/video/5'
    ]
    const { fetchImpl, calls } = chainFetch(chain)
    const client = new VideoHttpClient({
      fetchImpl,
      sleep,
      random: () => 0,
      tokenCapacity: 10
    })

    const result = await client.resolveRedirect(chain[0] ?? '', {
      platform: 'bilibili'
    })

    expect(result.url).toBe(chain[5])
    expect(result.hops).toEqual(chain)
    expect(calls).toHaveLength(6)
  })

  it('超过 5 跳抛 network', async () => {
    const { sleep } = fastSleep()
    const chain = Array.from(
      { length: 7 },
      (_value, index) => `https://www.bilibili.com/video/${index}`
    )
    const { fetchImpl, calls } = chainFetch(chain)
    const client = new VideoHttpClient({
      fetchImpl,
      sleep,
      random: () => 0,
      tokenCapacity: 10
    })

    const error = await captureError(
      client.resolveRedirect(chain[0] ?? '', { platform: 'bilibili' })
    )

    expect(error).toBeInstanceOf(VideoHttpError)
    expect((error as VideoHttpError).reason).toBe('network')
    expect((error as VideoHttpError).detail).toContain('重定向')
    expect(calls).toHaveLength(6)
  })

  it('拒绝非 HTTPS 与非平台域名的跳转', async () => {
    const targets = [
      'http://www.bilibili.com/video/1',
      'https://evil.example.com/video/1'
    ]
    for (const target of targets) {
      const { sleep } = fastSleep()
      const { fetchImpl } = recordingFetch((call) =>
        call.url === 'https://b23.tv/abc'
          ? makeResponse(302, null, { location: target })
          : makeResponse(200, 'ok')
      )
      const client = new VideoHttpClient({
        fetchImpl,
        sleep,
        random: () => 0
      })

      const error = await captureError(
        client.resolveRedirect('https://b23.tv/abc', { platform: 'bilibili' })
      )

      expect(error).toBeInstanceOf(VideoHttpError)
      expect((error as VideoHttpError).reason).toBe('network')
    }
  })
})

describe('WBI 签名', () => {
  const IMG_KEY = '7cd084941338484aae1ad9425b84077c'
  const SUB_KEY = '493c8503830117e4f9ea4d0e2f1c3f2e'
  const WTS = 1700000000

  it('mixinKey 返回 32 位字符码', () => {
    const codes = mixinKey(`${IMG_KEY}${SUB_KEY}`)
    expect(codes).toHaveLength(32)
    expect(codes.every((code) => code > 0 && code < 128)).toBe(true)
  })

  it('signWbiParams 输出稳定、按键字典序且 w_rid 为 32 位小写 md5', () => {
    const params = { bvid: 'BV1xx411c7mD', cid: 123, fnval: 4048, wts: 1 }
    const first = signWbiParams(params, IMG_KEY, SUB_KEY, WTS)
    const second = signWbiParams(params, IMG_KEY, SUB_KEY, WTS)

    expect(first).toEqual(second)
    expect(first.wts).toBe(String(WTS))
    expect(first.w_rid).toMatch(/^[0-9a-f]{32}$/)
    expect(Object.keys(first)).toEqual(Object.keys(first).slice().sort())
    expect(Object.keys(first)).toEqual(['bvid', 'cid', 'fnval', 'w_rid', 'wts'])

    const swapped = signWbiParams(params, SUB_KEY, IMG_KEY, WTS)
    expect(swapped.w_rid).not.toBe(first.w_rid)
  })

  it('BilibiliWbiSigner 从 nav 提取密钥并缓存', async () => {
    const { sleep } = fastSleep()
    const navBody = JSON.stringify({
      code: 0,
      data: {
        wbi_img: {
          img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
          sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`
        }
      }
    })
    const { fetchImpl, calls } = recordingFetch(() =>
      makeResponse(200, navBody, { 'content-type': 'application/json' })
    )
    const http = new VideoHttpClient({ fetchImpl, sleep, random: () => 0 })
    const clock = 1700000000000
    const signer = new BilibiliWbiSigner({ http, now: () => clock })

    const first = await signer.sign({ bvid: 'BV1xx411c7mD', cid: 123 })
    expect(first.wts).toBe(String(WTS))
    expect(first.w_rid).toMatch(/^[0-9a-f]{32}$/)

    const second = await signer.sign({ bvid: 'BV1xx411c7mD', cid: 124 })
    expect(second.w_rid).not.toBe(first.w_rid)
    // 10 分钟内复用密钥，只请求一次 nav
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.bilibili.com/x/web-interface/nav')
  })
})
