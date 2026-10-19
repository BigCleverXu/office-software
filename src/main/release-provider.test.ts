import { describe, expect, it, vi } from 'vitest'
import {
  GITEE_OWNER,
  GITEE_RELEASES_ENDPOINT,
  GITEE_REPO
} from '../shared/update'
import { fetchLatestRelease } from './release-provider'

/** 构造 fetch 可返回的极简响应对象 */
function makeResponse(
  status: number,
  payload?: unknown
): {
  ok: boolean
  status: number
  json: () => Promise<unknown>
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  }
}

/** 把响应对象包成 fetch 实现 */
function fetchOnce(response: {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

const latestPath =
  `${GITEE_RELEASES_ENDPOINT}/${GITEE_OWNER}` + `/${GITEE_REPO}/releases/latest`

describe('fetchLatestRelease 正常返回', () => {
  it('200 + 合法 JSON 返回规范化后的 ReleaseInfo', async () => {
    const payload = {
      tag_name: 'v1.2.3',
      name: '1.2.3 发布',
      body: '修复若干问题',
      created_at: '2026-04-14T15:00:00+08:00'
    }
    const fetchImpl = vi.fn(async () => makeResponse(200, payload))

    const result = await fetchLatestRelease({
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.release).not.toBeNull()
      const release = result.release
      expect(release?.version).toBe('1.2.3')
      expect(release?.tag).toBe('v1.2.3')
      expect(release?.title).toBe('1.2.3 发布')
      expect(release?.notes).toBe('修复若干问题')
      expect(release?.publishedAt).toBe('2026-04-14T15:00:00+08:00')
      expect(release?.pageUrl).toBe(
        `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/tag/v1.2.3`
      )
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(latestPath, expect.anything())
  })

  it('请求携带 Accept 头与 signal', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return makeResponse(404)
    })
    await fetchLatestRelease({
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect(calls[0].url).toBe(latestPath)
    expect(calls[0].init?.headers).toEqual({ Accept: 'application/json' })
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('fetchLatestRelease 状态归因', () => {
  it('404 视为暂无发行版', async () => {
    const result = await fetchLatestRelease({
      fetchImpl: fetchOnce(makeResponse(404, { message: '404 Not Found' }))
    })
    expect(result).toEqual({ ok: true, release: null })
  })

  it('429 归因为 rate-limited', async () => {
    const result = await fetchLatestRelease({
      fetchImpl: fetchOnce(makeResponse(429))
    })
    expect(result).toEqual({ ok: false, reason: 'rate-limited' })
  })

  it('403 归因为 unreadable', async () => {
    const result = await fetchLatestRelease({
      fetchImpl: fetchOnce(makeResponse(403))
    })
    expect(result).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('401 归因为 unreadable', async () => {
    const result = await fetchLatestRelease({
      fetchImpl: fetchOnce(makeResponse(401))
    })
    expect(result).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('500 归因为 network', async () => {
    const result = await fetchLatestRelease({
      fetchImpl: fetchOnce(makeResponse(500))
    })
    expect(result).toEqual({ ok: false, reason: 'network' })
  })
})

describe('fetchLatestRelease 解析与异常', () => {
  it('200 但缺 tag_name 归因为 unknown', async () => {
    const result = await fetchLatestRelease({
      fetchImpl: fetchOnce(makeResponse(200, { name: 'no tag' }))
    })
    expect(result).toEqual({ ok: false, reason: 'unknown' })
  })

  it('200 但 JSON 解析抛错归因为 unknown', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json')
      }
    }))
    const result = await fetchLatestRelease({
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect(result).toEqual({ ok: false, reason: 'unknown' })
  })

  it('超时归因为 timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )
    const result = await fetchLatestRelease({
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect(result).toEqual({ ok: false, reason: 'timeout' })
  })

  it('fetch 直接 reject 归因为 network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom')
    })
    const result = await fetchLatestRelease({
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect(result).toEqual({ ok: false, reason: 'network' })
  })
})
