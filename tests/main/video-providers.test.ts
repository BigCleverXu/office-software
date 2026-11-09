import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DouyinBrowserBridge } from '../../src/main/video/browser-resolver'
import {
  VideoHttpClient,
  type VideoHttpClientOptions
} from '../../src/main/video/http-client'
import { resolveShareLink } from '../../src/main/video/link'
import { VideoParseService } from '../../src/main/video/parse-service'
import {
  readEmbeddedJson,
  stripHtml
} from '../../src/main/video/providers/embedded'
import { bilibiliProvider } from '../../src/main/video/providers/bilibili'
import { douyinProvider } from '../../src/main/video/providers/douyin'
import { kuaishouProvider } from '../../src/main/video/providers/kuaishou'
import { xiaohongshuProvider } from '../../src/main/video/providers/xiaohongshu'
import type {
  ProviderContext,
  ProviderParseResult
} from '../../src/main/video/providers/types'
import type { PlatformSigner } from '../../src/main/video/signing'
import type { XiaohongshuBrowserBridge } from '../../src/main/video/xiaohongshu-browser'
import type { VideoParseResult, VideoResource } from '../../src/shared/video'

/** 读取测试夹具文本 */
function fixture(name: string): string {
  return readFileSync(
    new URL(`../fixtures/video/${name}`, import.meta.url),
    'utf8'
  )
}

/** 单条夹具路由 */
interface Route {
  match: (url: URL) => boolean
  body: string
  status?: number
  headers?: Record<string, string>
}

/** 把测试用 fetch 实现收窄为全局 fetch 类型 */
function asFetch(impl: (url: string) => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch
}

/** 按路由返回夹具；未配置的请求直接失败，保证不访问真实网络 */
function makeFetch(routes: Route[], calls: string[] = []): typeof fetch {
  return asFetch(async (raw) => {
    calls.push(raw)
    const url = new URL(raw)
    const route = routes.find((item) => item.match(url))
    if (route === undefined) {
      throw new Error(`未配置的请求: ${raw}`)
    }
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: route.headers ?? {}
    })
  })
}

/** 构造无退避等待、重试为 0 的客户端 */
function createClient(
  fetchImpl: typeof fetch,
  options: VideoHttpClientOptions = {}
): VideoHttpClient {
  return new VideoHttpClient({
    fetchImpl,
    sleep: async () => undefined,
    random: () => 0,
    maxRetries: 0,
    ...options
  })
}

/** B 站 JSON 接口路由 */
function bilibiliApi(path: string, body: string, status = 200): Route {
  return {
    match: (url) =>
      url.hostname === 'api.bilibili.com' && url.pathname === path,
    body,
    status,
    headers: { 'content-type': 'application/json' }
  }
}

/** 假 B 站签名器，便于断言签名参数已附加 */
const bilibiliSigner: PlatformSigner = {
  platform: 'bilibili',
  async sign(params) {
    const signed: Record<string, string> = {
      wts: '1700000000',
      w_rid: 'test-w-rid'
    }
    for (const [key, value] of Object.entries(params)) {
      signed[key] = String(value)
    }
    return signed
  }
}

/** 断言解析成功并返回资源 */
function resourceOf(result: ProviderParseResult): VideoResource {
  if (!result.ok) {
    throw new Error(`解析失败：${result.reason} ${result.detail ?? ''}`)
  }
  return result.resource
}

/** 断言服务解析成功并返回资源 */
function serviceResourceOf(result: VideoParseResult): VideoResource {
  if (!result.ok) {
    throw new Error(`解析失败：${result.reason} ${result.detail ?? ''}`)
  }
  return result.resource
}

/** 把最终地址与原始地址组成适配器入参 */
function inputOf(url: string): { sourceUrl: string; resolvedUrl: string } {
  return { sourceUrl: url, resolvedUrl: url }
}

/** 构造适配器上下文 */
function contextOf(
  client: VideoHttpClient,
  signer?: PlatformSigner,
  xiaohongshuBrowser?: XiaohongshuBrowserBridge
): ProviderContext {
  return { client, signer, xiaohongshuBrowser }
}

describe('内嵌 JSON 与 HTML 清洗', () => {
  it('按大括号配对读取字符串中的括号与转义', () => {
    const payload = {
      text: '}{ "quote" \\ end',
      nested: { a: 1 },
      arr: [{ b: 2 }]
    }
    const html = `<script>window.__INITIAL_STATE__ = ${JSON.stringify(payload)};</script>`

    expect(readEmbeddedJson(html, 'window.__INITIAL_STATE__ =')).toEqual(
      payload
    )
    expect(readEmbeddedJson(html, 'window.__INITIAL_STATE__')).toEqual(payload)
  })

  it('支持 _ROUTER_DATA 与 __APOLLO_STATE__ 标记', () => {
    const router = '<script>window._ROUTER_DATA = {"a":1}</script>'
    const apollo = '<script>window.__APOLLO_STATE__ = {"b":{"c":2}}</script>'

    expect(readEmbeddedJson(router, 'window._ROUTER_DATA =')).toEqual({ a: 1 })
    expect(readEmbeddedJson(apollo, 'window.__APOLLO_STATE__ =')).toEqual({
      b: { c: 2 }
    })
    expect(
      readEmbeddedJson('<div>无状态</div>', 'window._ROUTER_DATA')
    ).toBeNull()
  })

  it('stripHtml 去除脚本样式并解码实体', () => {
    const html =
      '<style>.a{}</style><p>第一段</p><script>alert(1)</script>' +
      '<p>第二段&nbsp;内容 &amp; 更多</p>'
    expect(stripHtml(html)).toBe('第一段 第二段 内容 & 更多')
  })
})

describe('哔哩哔哩适配器', () => {
  it('解析分 P 视频并映射 DASH 清晰度与音轨', async () => {
    const calls: string[] = []
    const client = createClient(
      makeFetch(
        [
          bilibiliApi('/x/web-interface/view', fixture('bilibili-view.json')),
          bilibiliApi('/x/player/playurl', fixture('bilibili-playurl.json'))
        ],
        calls
      )
    )
    const url = 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'
    const resource = resourceOf(
      await bilibiliProvider.parse(
        inputOf(url),
        contextOf(client, bilibiliSigner)
      )
    )

    expect(resource.id).toBe('bilibili:BV1xx411c7mD')
    expect(resource.kind).toBe('video')
    expect(resource.title).toBe('测试视频标题 - 第二期')
    expect(resource.author).toBe('测试UP主')
    expect(resource.durationSec).toBe(245)
    expect(resource.cover?.url).toBe(
      'https://i0.hdslb.com/bfs/archive/cover.jpg'
    )
    expect(resource.stats).toEqual({ likes: 1234, comments: 56, collects: 789 })
    expect(resource.variants.map((variant) => variant.label)).toEqual([
      '1080P',
      '720P',
      '480P'
    ])
    expect(resource.variants[0]?.container).toBe('m4s')
    expect(resource.variants[0]?.audioUrl).toBe(
      'https://upos-sz-mirrorcos.bilivideo.com/audio-high.m4s'
    )

    const playUrl = new URL(
      calls.find((call) => call.includes('/x/player/playurl')) ?? ''
    )
    expect(playUrl.searchParams.get('cid')).toBe('222')
    expect(playUrl.searchParams.get('qn')).toBe('127')
    expect(playUrl.searchParams.get('fnval')).toBe('4048')
    expect(playUrl.searchParams.get('fourk')).toBe('1')
    expect(playUrl.searchParams.get('wts')).toBe('1700000000')
    expect(playUrl.searchParams.get('w_rid')).toBe('test-w-rid')
  })

  it('无 DASH 时合并 durl 为合流档位', async () => {
    const client = createClient(
      makeFetch([
        bilibiliApi('/x/web-interface/view', fixture('bilibili-view.json')),
        bilibiliApi('/x/player/playurl', fixture('bilibili-playurl-durl.json'))
      ])
    )
    const resource = resourceOf(
      await bilibiliProvider.parse(
        inputOf('https://www.bilibili.com/video/BV1xx411c7mD'),
        contextOf(client, bilibiliSigner)
      )
    )

    expect(resource.variants).toHaveLength(1)
    expect(resource.variants[0]?.label).toBe('1080P合流')
    expect(resource.variants[0]?.container).toBe('flv')
    expect(resource.variants[0]?.audioUrl).toBeUndefined()
  })

  it('解析专栏图文并清洗正文', async () => {
    const client = createClient(
      makeFetch([
        bilibiliApi('/x/article/view', fixture('bilibili-article.json'))
      ])
    )
    const resource = resourceOf(
      await bilibiliProvider.parse(
        inputOf('https://www.bilibili.com/read/cv8899'),
        contextOf(client)
      )
    )

    expect(resource.id).toBe('bilibili:cv8899')
    expect(resource.kind).toBe('note')
    expect(resource.title).toBe('专栏图文标题')
    expect(resource.author).toBe('专栏作者')
    expect(resource.variants).toEqual([])
    expect(resource.images).toHaveLength(3)
    expect(resource.images[1]?.url).toBe(
      'https://i0.hdslb.com/bfs/article/b.jpg'
    )
    expect(resource.description).toBe('第一段 第二段 内容 & 更多')
    expect(resource.cover?.url).toBe(
      'https://i0.hdslb.com/bfs/article/banner.jpg'
    )
  })
})

describe('抖音适配器', () => {
  /** 分享页路由 */
  function shareRoute(kind: 'video' | 'note' | 'empty' | 'changed'): Route {
    const body =
      kind === 'video'
        ? fixture('douyin-share.html')
        : kind === 'note'
          ? fixture('douyin-note.html')
          : kind === 'empty'
            ? fixture('douyin-share-empty.html')
            : fixture('douyin-share-changed.html')
    return {
      match: (url) =>
        url.hostname === 'www.iesdouyin.com' &&
        url.pathname.startsWith('/share/'),
      body,
      headers: { 'content-type': 'text/html' }
    }
  }

  /** 旧接口路由 */
  function itemInfoRoute(name: string): Route {
    return {
      match: (url) =>
        url.hostname === 'www.iesdouyin.com' &&
        url.pathname === '/web/api/v2/aweme/iteminfo/',
      body: fixture(name),
      headers: { 'content-type': 'application/json' }
    }
  }

  it('解析分享页视频并去除水印', async () => {
    const client = createClient(makeFetch([shareRoute('video')]))
    const url = 'https://www.douyin.com/video/7345678901234567890'
    const resource = resourceOf(
      await douyinProvider.parse(inputOf(url), contextOf(client))
    )

    expect(resource.id).toBe('douyin:7345678901234567890')
    expect(resource.kind).toBe('video')
    expect(resource.title).toBe('抖音测试视频 #测试')
    expect(resource.author).toBe('抖音用户')
    expect(resource.durationSec).toBe(15)
    expect(resource.variants).toHaveLength(1)
    expect(resource.variants[0]?.label).toBe('1080P')
    expect(resource.variants[0]?.url).toBe(
      'https://v3-web.douyinvod.com/play/video.mp4'
    )
    expect(resource.cover?.url).toBe(
      'https://p3-pc-sign.douyinpic.com/cover.jpg'
    )
    expect(resource.stats).toEqual({ likes: 1000, comments: 50, collects: 20 })
  })

  it('分享页单一播放地址按 ratio 参数标注清晰度', async () => {
    const data = {
      loaderData: {
        'video_(id)/page': {
          videoInfoRes: {
            item_list: [
              {
                aweme_id: '7345678901234567899',
                desc: 'ratio 测试',
                video: {
                  width: 3840,
                  height: 2160,
                  duration: 2200,
                  play_addr: {
                    url_list: [
                      'https://v3-web.douyinvod.com/play/?ratio=720p&video_id=v1'
                    ]
                  }
                }
              }
            ]
          }
        }
      }
    }
    const html = `<script>window._ROUTER_DATA = ${JSON.stringify(data)}</script>`
    const route: Route = {
      match: (url) =>
        url.hostname === 'www.iesdouyin.com' &&
        url.pathname.startsWith('/share/'),
      body: html,
      headers: { 'content-type': 'text/html' }
    }
    const client = createClient(makeFetch([route]))
    const resource = resourceOf(
      await douyinProvider.parse(
        inputOf('https://www.douyin.com/video/7345678901234567899'),
        contextOf(client)
      )
    )

    // 真实档位由播放地址的 ratio 决定，不能用作品原始宽高误标为 4K
    expect(resource.variants).toHaveLength(1)
    expect(resource.variants[0]?.label).toBe('720P')
    expect(resource.variants[0]?.qualityRank).toBe(720)
    expect(resource.variants[0]?.width).toBeUndefined()
  })

  it('解析图文笔记并保留全部图片', async () => {
    const client = createClient(makeFetch([shareRoute('note')]))
    const url = 'https://www.douyin.com/note/7345678901234567891'
    const resource = resourceOf(
      await douyinProvider.parse(inputOf(url), contextOf(client))
    )

    expect(resource.kind).toBe('note')
    expect(resource.title).toBe('抖音图文测试')
    expect(resource.author).toBe('图文作者')
    expect(resource.variants).toEqual([])
    expect(resource.images).toHaveLength(3)
    expect(resource.images[2]?.url).toBe(
      'https://p3-pc-sign.douyinpic.com/img3.jpg'
    )
  })

  it('分享页缺失时回退旧版 iteminfo 接口', async () => {
    const client = createClient(
      makeFetch([shareRoute('empty'), itemInfoRoute('douyin-iteminfo.json')])
    )
    const resource = resourceOf(
      await douyinProvider.parse(
        inputOf('https://www.douyin.com/video/7345678901234567892'),
        contextOf(client)
      )
    )

    expect(resource.title).toBe('旧接口视频')
    expect(resource.author).toBe('旧接口作者')
    expect(resource.variants[0]?.label).toBe('720P')
    expect(resource.durationSec).toBe(6)
  })

  /** 浏览器降级返回的作品详情 */
  function browserDetail(awemeId: string): Record<string, unknown> {
    return {
      aweme_id: awemeId,
      desc: '浏览器降级视频',
      author: { nickname: '浏览器作者' },
      video: {
        play_addr: {
          url_list: ['https://v3-web.douyinvod.com/playwm/browser.mp4']
        },
        cover: { url_list: ['https://p3-pc-sign.douyinpic.com/browser.jpg'] },
        duration: 8000,
        width: 1080,
        height: 1920
      },
      statistics: { digg_count: 3, comment_count: 1, collect_count: 0 }
    }
  }

  /** 构造 HTTP 全部失效的客户端 */
  function brokenClient(): VideoHttpClient {
    return createClient(
      makeFetch([
        shareRoute('changed'),
        itemInfoRoute('douyin-iteminfo-empty.json')
      ])
    )
  }

  it('HTTP 链路失效时使用浏览器降级解析', async () => {
    const calls: Array<{ url: string; awemeId: string }> = []
    const browser: DouyinBrowserBridge = {
      async captureAwemeDetail(input) {
        calls.push({ url: input.url, awemeId: input.awemeId })
        return browserDetail(input.awemeId)
      }
    }
    const url = 'https://www.douyin.com/video/7345678901234567895'
    const resource = resourceOf(
      await douyinProvider.parse(inputOf(url), {
        client: brokenClient(),
        browser
      })
    )

    expect(resource.id).toBe('douyin:7345678901234567895')
    expect(resource.title).toBe('浏览器降级视频')
    expect(resource.author).toBe('浏览器作者')
    expect(resource.durationSec).toBe(8)
    expect(resource.variants[0]?.url).toBe(
      'https://v3-web.douyinvod.com/play/browser.mp4'
    )
    expect(calls).toEqual([{ url, awemeId: '7345678901234567895' }])
  })

  it('浏览器降级也失败时归为 api-changed', async () => {
    const browser: DouyinBrowserBridge = {
      async captureAwemeDetail() {
        return null
      }
    }
    const result = await douyinProvider.parse(
      inputOf('https://www.douyin.com/video/7345678901234567896'),
      { client: brokenClient(), browser }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('api-changed')
      expect(result.detail).toBe('抖音需要浏览器渲染，未能获取作品数据')
    }
  })
})

describe('快手适配器', () => {
  /** 分享页路由 */
  function pageRoute(id: string, name: string, status = 200): Route {
    return {
      match: (url) =>
        url.hostname.endsWith('kuaishou.com') && url.pathname.includes(id),
      body: fixture(name),
      status,
      headers: { 'content-type': 'text/html' }
    }
  }

  /** 对可打印 ASCII 做 +1 位移，模拟移动页 INIT_STATE 编码 */
  function shiftText(text: string): string {
    let result = ''
    for (const char of text) {
      const code = char.charCodeAt(0)
      if (code >= 1 && code <= 126) {
        result += String.fromCharCode(code === 126 ? 1 : code + 1)
      } else {
        result += char
      }
    }
    return result
  }

  /** 递归编码对象键名与字符串 */
  function encodeValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return shiftText(value)
    }
    if (Array.isArray(value)) {
      return value.map((item) => encodeValue(item))
    }
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) {
        result[shiftText(key)] = encodeValue(item)
      }
      return result
    }
    return value
  }

  /** 由状态对象构造内联移动页 */
  function mobilePage(state: unknown): string {
    const encoded = JSON.stringify(encodeValue(state))
    return (
      '<!doctype html><html><body>' +
      `<script>window.INIT_STATE = ${encoded};</script>` +
      '<div>移动端作品页</div></body></html>'
    )
  }

  it('解析视频 manifest 清晰度档位', async () => {
    const client = createClient(
      makeFetch([
        pageRoute('3xabc', 'kuaishou-share.html'),
        pageRoute('3xnote', 'kuaishou-note.html')
      ])
    )
    const resource = resourceOf(
      await kuaishouProvider.parse(
        inputOf('https://www.kuaishou.com/short-video/3xabc'),
        contextOf(client)
      )
    )

    expect(resource.id).toBe('kuaishou:3xabc')
    expect(resource.kind).toBe('video')
    expect(resource.title).toBe('快手测试视频')
    expect(resource.author).toBe('快手用户')
    expect(resource.durationSec).toBe(12)
    expect(resource.variants).toHaveLength(2)
    expect(resource.variants[0]?.label).toBe('1080p')
    expect(resource.variants[0]?.url).toBe('https://v.kwaicdn.com/1080.mp4')
    expect(resource.variants[0]?.qualityRank).toBe(2500000)
    expect(resource.cover?.url).toBe('https://p1.kwaicdn.com/cover.jpg')
  })

  it('解析图文 atlas 图片', async () => {
    const client = createClient(
      makeFetch([pageRoute('3xnote', 'kuaishou-note.html')])
    )
    const resource = resourceOf(
      await kuaishouProvider.parse(
        inputOf('https://www.kuaishou.com/photo/3xnote'),
        contextOf(client)
      )
    )

    expect(resource.kind).toBe('note')
    expect(resource.title).toBe('快手图文标题')
    expect(resource.author).toBe('图文作者')
    expect(resource.variants).toEqual([])
    expect(resource.images).toHaveLength(2)
    expect(resource.images[1]?.url).toBe('https://p1.kwaicdn.com/b.jpg')
  })

  it('移动端页面解码 INIT_STATE 并优选白名单 CDN', async () => {
    const id = '3x3pk285r7w5qpi'
    const manifest = JSON.stringify({
      adaptationSet: [
        {
          representation: [
            {
              url: 'https://k0u73ydfy.djvod.ndcimgs.com/a.mp4',
              backupUrl: ['https://v23-3.kwaicdn.com/a.mp4'],
              width: 1920,
              height: 1080,
              avgBitrate: 2000000,
              qualityLabel: '1080p'
            }
          ]
        }
      ]
    })
    const html = mobilePage({
      result: 1,
      photo: {
        photoId: id,
        caption: '移动端标题',
        userName: '移动端作者',
        duration: 16000,
        coverUrls: ['https://p1.kwaicdn.com/mobile-cover.jpg'],
        manifest
      }
    })
    const calls: string[] = []
    const client = createClient(
      makeFetch(
        [
          {
            match: (url) => url.pathname.includes(id),
            body: html,
            headers: { 'content-type': 'text/html' }
          }
        ],
        calls
      )
    )
    const url = `https://www.kuaishou.com/short-video/${id}?shareToken=${id}&shareMethod=picture`
    const resource = resourceOf(
      await kuaishouProvider.parse(inputOf(url), contextOf(client))
    )

    expect(resource.title).toBe('移动端标题')
    expect(resource.author).toBe('移动端作者')
    expect(resource.durationSec).toBe(16)
    expect(resource.variants).toHaveLength(1)
    expect(resource.variants[0]?.url).toBe('https://v23-3.kwaicdn.com/a.mp4')
    expect(resource.cover?.url).toBe('https://p1.kwaicdn.com/mobile-cover.jpg')
    expect(calls[0]).toContain('shareToken=')
  })

  it('缺少编码状态归为 api-changed', async () => {
    const id = '3x3pk285r7w5qpi'
    const client = createClient(
      makeFetch([
        {
          match: (url) => url.pathname.includes(id),
          body: '<!doctype html><html><body><div>快手页面占位</div></body></html>',
          headers: { 'content-type': 'text/html' }
        }
      ])
    )
    const result = await kuaishouProvider.parse(
      inputOf(`https://www.kuaishou.com/short-video/${id}`),
      contextOf(client)
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('api-changed')
      expect(result.detail).toContain('快手页面受限')
    }
  })
})

describe('小红书适配器', () => {
  /** 笔记页路由 */
  function pageRoute(id: string, name: string): Route {
    return {
      match: (url) =>
        url.hostname === 'www.xiaohongshu.com' &&
        url.pathname === `/explore/${id}`,
      body: fixture(name),
      headers: { 'content-type': 'text/html' }
    }
  }

  it('解析图文笔记并在请求中保留 xsec_token', async () => {
    const calls: string[] = []
    const client = createClient(
      makeFetch(
        [pageRoute('64a1b2c3d4e5f6a7b8c9d0e1', 'xiaohongshu-share.html')],
        calls
      )
    )
    const url =
      'https://www.xiaohongshu.com/explore/64a1b2c3d4e5f6a7b8c9d0e1' +
      '?xsec_token=TOKEN123&xsec_source=pc_share'
    const resource = resourceOf(
      await xiaohongshuProvider.parse(inputOf(url), contextOf(client))
    )

    expect(resource.kind).toBe('note')
    expect(resource.title).toBe('小红书图文标题')
    expect(resource.author).toBe('小红书用户')
    expect(resource.description).toBe('图文正文内容')
    expect(resource.variants).toEqual([])
    expect(resource.images).toHaveLength(3)
    expect(resource.images[0]?.url).toBe(
      'https://sns-img-qc.xhscdn.com/img1.jpg'
    )
    expect(resource.cover?.url).toBe('https://sns-img-qc.xhscdn.com/img1.jpg')
    const requestUrl = new URL(calls[0] ?? '')
    expect(requestUrl.searchParams.get('xsec_token')).toBe('TOKEN123')
    expect(requestUrl.searchParams.get('xsec_source')).toBe('pc_share')
  })

  it('解析视频笔记并按清晰度排序', async () => {
    const client = createClient(
      makeFetch([
        pageRoute('aaaabbbbccccddddeeeeffff', 'xiaohongshu-video.html')
      ])
    )
    const resource = resourceOf(
      await xiaohongshuProvider.parse(
        inputOf('https://www.xiaohongshu.com/explore/aaaabbbbccccddddeeeeffff'),
        contextOf(client)
      )
    )

    expect(resource.kind).toBe('video')
    expect(resource.title).toBe('小红书视频标题')
    expect(resource.author).toBe('视频作者')
    expect(resource.variants.length).toBeGreaterThanOrEqual(3)
    expect(resource.variants[0]?.label).toBe('1080P')
    expect(resource.variants[0]?.url).toBe(
      'https://sns-video-bd.xhscdn.com/v1080.mp4'
    )
    expect(resource.variants[1]?.label).toBe('1080P')
    expect(resource.cover?.url).toBe(
      'https://sns-img-qc.xhscdn.com/video-cover.jpg'
    )
  })

  /** 登录页：有内嵌状态但没有 noteDetailMap */
  function loginPageHtml(): string {
    return (
      '<!doctype html><html><head><script>' +
      'window.__INITIAL_STATE__ = {"note":{"noteDetailMap":{}}};' +
      '</script></head><body><div>登录后查看</div></body></html>'
    )
  }

  /** 浏览器降级返回的状态 */
  function browserState(id: string): Record<string, unknown> {
    return {
      note: {
        noteDetailMap: {
          [id]: {
            note: {
              noteId: id,
              type: 'normal',
              title: '浏览器降级笔记',
              user: { nickname: '浏览器作者' },
              imageList: [
                {
                  urlDefault: 'https://sns-img-qc.xhscdn.com/b1.jpg',
                  width: 1080,
                  height: 1440
                },
                {
                  urlDefault: 'https://sns-img-qc.xhscdn.com/b2.jpg',
                  width: 1080,
                  height: 1440
                }
              ]
            }
          }
        }
      }
    }
  }

  it('HTTP 返回登录页时使用浏览器降级解析', async () => {
    const id = 'aaaabbbbccccddddeeeeffff'
    const calls: string[] = []
    const browser: XiaohongshuBrowserBridge = {
      async loadNoteState(input) {
        calls.push(input.url)
        return browserState(id)
      }
    }
    const client = createClient(
      makeFetch([
        {
          match: (url) =>
            url.hostname === 'www.xiaohongshu.com' &&
            url.pathname === `/explore/${id}`,
          body: loginPageHtml(),
          headers: { 'content-type': 'text/html' }
        }
      ])
    )
    const url =
      `https://www.xiaohongshu.com/explore/${id}` +
      '?xsec_token=TOKEN123&xsec_source=pc_share'
    const resource = resourceOf(
      await xiaohongshuProvider.parse(
        inputOf(url),
        contextOf(client, undefined, browser)
      )
    )

    expect(resource.title).toBe('浏览器降级笔记')
    expect(resource.author).toBe('浏览器作者')
    expect(resource.kind).toBe('note')
    expect(resource.images.map((image) => image.url)).toEqual([
      'https://sns-img-qc.xhscdn.com/b1.jpg',
      'https://sns-img-qc.xhscdn.com/b2.jpg'
    ])
    expect(calls).toEqual([url])
  })

  it('浏览器降级也失败时归为 api-changed', async () => {
    const id = 'aaaabbbbccccddddeeeeffff'
    const browser: XiaohongshuBrowserBridge = {
      async loadNoteState() {
        return null
      }
    }
    const client = createClient(
      makeFetch([
        {
          match: (url) =>
            url.hostname === 'www.xiaohongshu.com' &&
            url.pathname === `/explore/${id}`,
          body: loginPageHtml(),
          headers: { 'content-type': 'text/html' }
        }
      ])
    )
    const result = await xiaohongshuProvider.parse(
      inputOf(`https://www.xiaohongshu.com/explore/${id}`),
      contextOf(client, undefined, browser)
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('api-changed')
      expect(result.detail).toContain('小红书页面受限')
    }
  })
})

describe('失效与结构变更样本', () => {
  it('B 站接口返回无效码时归为 expired', async () => {
    const client = createClient(
      makeFetch([
        bilibiliApi(
          '/x/web-interface/view',
          fixture('bilibili-view-expired.json')
        )
      ])
    )
    const result = await bilibiliProvider.parse(
      inputOf('https://www.bilibili.com/video/BV1xx411c7mD'),
      contextOf(client, bilibiliSigner)
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('expired')
    }
  })

  it('B 站 playurl 缺少档位时归为 api-changed', async () => {
    const client = createClient(
      makeFetch([
        bilibiliApi('/x/web-interface/view', fixture('bilibili-view.json')),
        bilibiliApi(
          '/x/player/playurl',
          fixture('bilibili-playurl-changed.json')
        )
      ])
    )
    const result = await bilibiliProvider.parse(
      inputOf('https://www.bilibili.com/video/BV1xx411c7mD'),
      contextOf(client, bilibiliSigner)
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('api-changed')
    }
  })

  it('抖音无作品数据时归为 api-changed，接口失效不等同于过期', async () => {
    const emptyClient = createClient(
      makeFetch([
        {
          match: (url) =>
            url.hostname === 'www.iesdouyin.com' &&
            url.pathname.startsWith('/share/'),
          body: fixture('douyin-share-empty.html')
        },
        {
          match: (url) =>
            url.hostname === 'www.iesdouyin.com' &&
            url.pathname === '/web/api/v2/aweme/iteminfo/',
          body: fixture('douyin-iteminfo-empty.json')
        }
      ])
    )
    const empty = await douyinProvider.parse(
      inputOf('https://www.douyin.com/video/7345678901234567893'),
      contextOf(emptyClient)
    )
    expect(empty.ok).toBe(false)
    if (!empty.ok) {
      expect(empty.reason).toBe('api-changed')
      expect(empty.detail).toBe('未找到作品数据')
    }

    const changedClient = createClient(
      makeFetch([
        {
          match: (url) =>
            url.hostname === 'www.iesdouyin.com' &&
            url.pathname.startsWith('/share/'),
          body: fixture('douyin-share-changed.html')
        },
        {
          match: (url) =>
            url.hostname === 'www.iesdouyin.com' &&
            url.pathname === '/web/api/v2/aweme/iteminfo/',
          body: fixture('douyin-iteminfo-changed.json')
        }
      ])
    )
    const changed = await douyinProvider.parse(
      inputOf('https://www.douyin.com/video/7345678901234567894'),
      contextOf(changedClient)
    )
    expect(changed.ok).toBe(false)
    if (!changed.ok) {
      expect(changed.reason).toBe('api-changed')
    }
  })

  it('快手缺失作品归为 expired，空状态归为 api-changed', async () => {
    const expiredClient = createClient(
      makeFetch([
        {
          match: (url) => url.pathname.includes('3xmiss'),
          body: fixture('kuaishou-share-missing.html')
        }
      ])
    )
    const expired = await kuaishouProvider.parse(
      inputOf('https://www.kuaishou.com/short-video/3xmiss'),
      contextOf(expiredClient)
    )
    expect(expired.ok).toBe(false)
    if (!expired.ok) {
      expect(expired.reason).toBe('expired')
    }

    const changedClient = createClient(
      makeFetch([
        {
          match: (url) => url.pathname.includes('3xchange'),
          body: fixture('kuaishou-share-changed.html')
        }
      ])
    )
    const changed = await kuaishouProvider.parse(
      inputOf('https://www.kuaishou.com/short-video/3xchange'),
      contextOf(changedClient)
    )
    expect(changed.ok).toBe(false)
    if (!changed.ok) {
      expect(changed.reason).toBe('api-changed')
    }
  })

  it('小红书缺失笔记归为 expired，状态异常归为 api-changed', async () => {
    const id = '64a1b2c3d4e5f6a7b8c9d0e1'
    const expiredClient = createClient(
      makeFetch([
        {
          match: (url) => url.pathname === `/explore/${id}`,
          body: fixture('xiaohongshu-share-missing.html')
        }
      ])
    )
    const expired = await xiaohongshuProvider.parse(
      inputOf(`https://www.xiaohongshu.com/explore/${id}`),
      contextOf(expiredClient)
    )
    expect(expired.ok).toBe(false)
    if (!expired.ok) {
      expect(expired.reason).toBe('expired')
    }

    const changedClient = createClient(
      makeFetch([
        {
          match: (url) => url.pathname === `/explore/${id}`,
          body: fixture('xiaohongshu-share-changed.html')
        }
      ])
    )
    const changed = await xiaohongshuProvider.parse(
      inputOf(`https://www.xiaohongshu.com/explore/${id}`),
      contextOf(changedClient)
    )
    expect(changed.ok).toBe(false)
    if (!changed.ok) {
      expect(changed.reason).toBe('api-changed')
    }

    const brokenClient = createClient(
      makeFetch([
        {
          match: (url) => url.pathname === `/explore/${id}`,
          body: fixture('xiaohongshu-share-broken.html')
        }
      ])
    )
    const broken = await xiaohongshuProvider.parse(
      inputOf(`https://www.xiaohongshu.com/explore/${id}`),
      contextOf(brokenClient)
    )
    expect(broken.ok).toBe(false)
    if (!broken.ok) {
      expect(broken.reason).toBe('api-changed')
    }
  })
})

describe('resolveShareLink', () => {
  /** 短链用例：短链 302 到最终地址 */
  const cases: Array<{
    text: string
    shortUrl: string
    finalUrl: string
    platform: string
  }> = [
    {
      text: '复制打开抖音 https://v.douyin.com/abc123/ 看看',
      shortUrl: 'https://v.douyin.com/abc123/',
      finalUrl: 'https://www.douyin.com/video/7345678901234567890',
      platform: 'douyin'
    },
    {
      text: '快手 https://v.kuaishou.com/xyz789 复制此消息',
      shortUrl: 'https://v.kuaishou.com/xyz789',
      finalUrl: 'https://www.kuaishou.com/short-video/3xabc',
      platform: 'kuaishou'
    },
    {
      text: '小红书 https://xhslink.com/a/AbCdEf，复制本条信息',
      shortUrl: 'https://xhslink.com/a/AbCdEf',
      finalUrl:
        'https://www.xiaohongshu.com/explore/64a1b2c3d4e5f6a7b8c9d0e1' +
        '?xsec_token=TOKEN123&xsec_source=pc_share',
      platform: 'xiaohongshu'
    },
    {
      text: '【哔哩哔哩】 https://b23.tv/BV1xx411c7mD。',
      shortUrl: 'https://b23.tv/BV1xx411c7mD',
      finalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      platform: 'bilibili'
    }
  ]

  for (const item of cases) {
    it(`跟随短链并识别 ${item.platform}`, async () => {
      const fetchImpl = makeFetch([
        {
          match: (url) => url.toString() === item.shortUrl,
          body: '',
          status: 302,
          headers: { location: item.finalUrl }
        },
        {
          match: (url) => url.toString() === item.finalUrl,
          body: 'ok'
        }
      ])
      const client = createClient(fetchImpl)

      const result = await resolveShareLink(client, item.text)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.platform).toBe(item.platform)
        expect(result.sourceUrl).toBe(item.shortUrl)
        expect(result.resolvedUrl).toBe(item.finalUrl)
      }
    })
  }

  it('普通文字返回 invalid-link 且不发起请求', async () => {
    let called = 0
    const client = createClient(
      asFetch(async () => {
        called += 1
        return new Response('', { status: 200 })
      })
    )

    const result = await resolveShareLink(client, '这是一段普通文字')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid-link')
      expect(result.platform).toBeNull()
    }
    expect(called).toBe(0)
  })

  it('其他站点返回 unsupported-platform', async () => {
    let called = 0
    const client = createClient(
      asFetch(async () => {
        called += 1
        return new Response('', { status: 200 })
      })
    )

    const result = await resolveShareLink(client, 'https://example.com/video/1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-platform')
    }
    expect(called).toBe(0)
  })

  it('超过 5 跳归为 short-link-failed', async () => {
    const client = createClient(
      makeFetch([
        {
          match: () => true,
          body: '',
          status: 302,
          headers: { location: 'https://www.bilibili.com/video/BV1xx411c7mD' }
        }
      ])
    )

    const result = await resolveShareLink(client, 'https://b23.tv/loop')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('short-link-failed')
    }
  })
})

describe('VideoParseService 编排', () => {
  it('按平台分发并缓存资源，过期后清理', async () => {
    let clock = 1700000000000
    const client = createClient(
      makeFetch([
        bilibiliApi('/x/web-interface/view', fixture('bilibili-view.json')),
        bilibiliApi('/x/player/playurl', fixture('bilibili-playurl.json'))
      ])
    )
    const service = new VideoParseService({
      client,
      signers: { bilibili: bilibiliSigner },
      now: () => clock,
      cacheTtlMs: 60000
    })

    const result = await service.parse(
      '看视频 https://www.bilibili.com/video/BV1xx411c7mD'
    )
    const resource = serviceResourceOf(result)

    expect(resource.id).toBe('bilibili:BV1xx411c7mD')
    expect(service.getResource('bilibili:BV1xx411c7mD')).not.toBeNull()

    clock += 61000
    expect(service.getResource('bilibili:BV1xx411c7mD')).toBeNull()
  })

  it('非法入参返回 invalid-link 且不发起请求', async () => {
    let called = 0
    const client = createClient(
      asFetch(async () => {
        called += 1
        return new Response('', { status: 200 })
      })
    )
    const service = new VideoParseService({ client })

    const inputs: unknown[] = [null, 42, '   ', 'x'.repeat(5001)]
    for (const input of inputs) {
      const result = await service.parse(input)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('invalid-link')
      }
    }
    expect(called).toBe(0)
  })

  it('总超时归为 network 并附「解析超时」', async () => {
    const fetchImpl = asFetch(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response(fixture('douyin-share.html'), { status: 200 }))
          }, 60)
        })
    )
    const client = createClient(fetchImpl)
    const service = new VideoParseService({ client, timeoutMs: 16 })

    const result = await service.parse(
      'https://www.douyin.com/video/7345678901234567890'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('network')
      expect(result.detail).toBe('解析超时')
    }
  })

  it('HTTP 403 归为 signature-failed', async () => {
    const client = createClient(
      makeFetch([
        bilibiliApi('/x/web-interface/view', fixture('bilibili-view.json')),
        bilibiliApi('/x/player/playurl', '', 403)
      ])
    )
    const service = new VideoParseService({
      client,
      signers: { bilibili: bilibiliSigner }
    })

    const result = await service.parse(
      'https://www.bilibili.com/video/BV1xx411c7mD'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('signature-failed')
      expect(result.message).toBe('平台签名校验失败，请稍后重试')
    }
  })

  it('HTTP 404 归为 expired，429 归为 rate-limited', async () => {
    const expiredClient = createClient(
      makeFetch([bilibiliApi('/x/web-interface/view', '', 404)])
    )
    const expiredService = new VideoParseService({
      client: expiredClient,
      signers: { bilibili: bilibiliSigner }
    })
    const expired = await expiredService.parse(
      'https://www.bilibili.com/video/BV1xx411c7mD'
    )
    expect(expired.ok).toBe(false)
    if (!expired.ok) {
      expect(expired.reason).toBe('expired')
    }

    const limitedClient = createClient(
      makeFetch([
        bilibiliApi('/x/web-interface/view', fixture('bilibili-view.json')),
        bilibiliApi('/x/player/playurl', '', 429)
      ])
    )
    const limitedService = new VideoParseService({
      client: limitedClient,
      signers: { bilibili: bilibiliSigner }
    })
    const limited = await limitedService.parse(
      'https://www.bilibili.com/video/BV1xx411c7mD'
    )
    expect(limited.ok).toBe(false)
    if (!limited.ok) {
      expect(limited.reason).toBe('rate-limited')
    }
  })

  it('接口结构变化归为 api-changed', async () => {
    const client = createClient(
      makeFetch([
        bilibiliApi('/x/web-interface/view', fixture('bilibili-view.json')),
        bilibiliApi(
          '/x/player/playurl',
          fixture('bilibili-playurl-changed.json')
        )
      ])
    )
    const service = new VideoParseService({
      client,
      signers: { bilibili: bilibiliSigner }
    })

    const result = await service.parse(
      'https://www.bilibili.com/video/BV1xx411c7mD'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('api-changed')
    }
  })
})

describe('有效夹具解析成功率', () => {
  it('成功率不低于 95% 且样本不少于 8 个', async () => {
    const cases: Array<{
      name: string
      text: string
      routes: Route[]
    }> = [
      {
        name: 'bilibili 视频',
        text: 'https://www.bilibili.com/video/BV1xx411c7mD',
        routes: [
          bilibiliApi('/x/web-interface/view', fixture('bilibili-view.json')),
          bilibiliApi('/x/player/playurl', fixture('bilibili-playurl.json'))
        ]
      },
      {
        name: 'bilibili 专栏',
        text: 'https://www.bilibili.com/read/cv8899',
        routes: [
          bilibiliApi('/x/article/view', fixture('bilibili-article.json'))
        ]
      },
      {
        name: 'douyin 视频',
        text: 'https://www.douyin.com/video/7345678901234567890',
        routes: [
          {
            match: (url) =>
              url.hostname === 'www.iesdouyin.com' &&
              url.pathname.startsWith('/share/'),
            body: fixture('douyin-share.html')
          }
        ]
      },
      {
        name: 'douyin 图文',
        text: 'https://www.douyin.com/note/7345678901234567891',
        routes: [
          {
            match: (url) =>
              url.hostname === 'www.iesdouyin.com' &&
              url.pathname.startsWith('/share/'),
            body: fixture('douyin-note.html')
          }
        ]
      },
      {
        name: 'douyin iteminfo 回退',
        text: 'https://www.douyin.com/video/7345678901234567892',
        routes: [
          {
            match: (url) =>
              url.hostname === 'www.iesdouyin.com' &&
              url.pathname.startsWith('/share/'),
            body: fixture('douyin-share-empty.html')
          },
          {
            match: (url) =>
              url.hostname === 'www.iesdouyin.com' &&
              url.pathname === '/web/api/v2/aweme/iteminfo/',
            body: fixture('douyin-iteminfo.json')
          }
        ]
      },
      {
        name: 'kuaishou 视频',
        text: 'https://www.kuaishou.com/short-video/3xabc',
        routes: [
          {
            match: (url) =>
              url.hostname.endsWith('kuaishou.com') &&
              url.pathname.includes('3xabc'),
            body: fixture('kuaishou-share.html')
          }
        ]
      },
      {
        name: 'kuaishou 图文',
        text: 'https://www.kuaishou.com/photo/3xnote',
        routes: [
          {
            match: (url) =>
              url.hostname.endsWith('kuaishou.com') &&
              url.pathname.includes('3xnote'),
            body: fixture('kuaishou-note.html')
          }
        ]
      },
      {
        name: 'xiaohongshu 视频',
        text: 'https://www.xiaohongshu.com/explore/aaaabbbbccccddddeeeeffff',
        routes: [
          {
            match: (url) =>
              url.hostname === 'www.xiaohongshu.com' &&
              url.pathname === '/explore/aaaabbbbccccddddeeeeffff',
            body: fixture('xiaohongshu-video.html')
          }
        ]
      },
      {
        name: 'xiaohongshu 图文',
        text:
          'https://www.xiaohongshu.com/explore/64a1b2c3d4e5f6a7b8c9d0e1' +
          '?xsec_token=TOKEN123&xsec_source=pc_share',
        routes: [
          {
            match: (url) =>
              url.hostname === 'www.xiaohongshu.com' &&
              url.pathname === '/explore/64a1b2c3d4e5f6a7b8c9d0e1',
            body: fixture('xiaohongshu-share.html')
          }
        ]
      }
    ]

    const results: VideoParseResult[] = []
    for (const item of cases) {
      const client = createClient(makeFetch(item.routes))
      const service = new VideoParseService({
        client,
        signers: { bilibili: bilibiliSigner }
      })
      results.push(await service.parse(item.text))
    }

    const successCount = results.filter((result) => result.ok).length
    const successRate = successCount / results.length

    expect(results.length).toBeGreaterThanOrEqual(8)
    expect(successRate).toBeGreaterThanOrEqual(0.95)
    expect(successCount).toBe(results.length)
  })
})
