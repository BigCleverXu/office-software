import { describe, expect, it } from 'vitest'
import {
  createDouyinBrowserResolver,
  extractAwemeDetail,
  type DouyinBrowserBridge,
  type DouyinBrowserWindow,
  type DouyinDebuggerListener,
  type DouyinDebuggerSession,
  type DouyinNavigationEvent,
  type DouyinWebContents
} from '../../src/main/video/browser-resolver'

/** 目标作品 ID */
const TARGET_ID = '7704388866999864611'

/** 作品详情接口地址 */
const DETAIL_URL = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${TARGET_ID}`

/** 构造 aweme/detail 响应体 */
function detailPayload(awemeId: string, desc: string): Record<string, unknown> {
  return {
    aweme_detail: {
      aweme_id: awemeId,
      desc,
      author: { nickname: '浏览器作者' },
      video: {
        play_addr: {
          url_list: ['https://v3-web.douyinvod.com/playwm/browser.mp4']
        },
        cover: { url_list: ['https://p3-pc-sign.douyinpic.com/browser.jpg'] }
      }
    }
  }
}

/** 假 CDP 调试会话：记录调用并按 requestId 返回响应体 */
class FakeDebugger implements DouyinDebuggerSession {
  attached = false
  attachCalls: string[] = []
  detachCount = 0
  commands: Array<{ method: string; params?: Record<string, unknown> }> = []
  bodies = new Map<string, string>()
  private listener: DouyinDebuggerListener | null = null

  attach(protocolVersion: string): void {
    this.attached = true
    this.attachCalls.push(protocolVersion)
  }

  detach(): void {
    this.attached = false
    this.detachCount += 1
  }

  async sendCommand(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    this.commands.push({ method, params })
    if (method !== 'Network.getResponseBody') {
      return {}
    }
    const requestId =
      typeof params?.requestId === 'string' ? params.requestId : ''
    return { body: this.bodies.get(requestId) ?? '', base64Encoded: false }
  }

  on(event: string, listener: DouyinDebuggerListener): void {
    if (event === 'message') {
      this.listener = listener
    }
  }

  /** 触发一次 Network.responseReceived */
  emitDetail(url: string, requestId: string): void {
    this.listener?.(
      {},
      'Network.responseReceived',
      { requestId, response: { url } },
      undefined
    )
  }
}

/** 假窗口工厂入参 */
interface FakeWindowOptions {
  onLoad?: (window: FakeWindow) => void | Promise<void>
  loadError?: Error
}

/** 假浏览器窗口：不发起任何真实网络请求 */
class FakeWindow implements DouyinBrowserWindow {
  readonly debugger = new FakeDebugger()
  readonly webContents: DouyinWebContents
  readonly userAgents: string[] = []
  readonly loadedUrls: string[] = []
  readonly navListeners: Array<
    (event: DouyinNavigationEvent, url: string) => void
  > = []
  windowOpenHandler: (() => { action: 'deny' }) | null = null
  destroyCount = 0
  private readonly options: FakeWindowOptions
  private destroyed = false

  constructor(options: FakeWindowOptions = {}) {
    this.options = options
    this.webContents = {
      debugger: this.debugger,
      setUserAgent: (userAgent) => {
        this.userAgents.push(userAgent)
      },
      setWindowOpenHandler: (handler) => {
        this.windowOpenHandler = handler
      },
      on: (_event, listener) => {
        this.navListeners.push(listener)
      },
      loadURL: async (url) => {
        this.loadedUrls.push(url)
        if (this.options.loadError !== undefined) {
          throw this.options.loadError
        }
        await this.options.onLoad?.(this)
      }
    }
  }

  destroy(): void {
    this.destroyed = true
    this.destroyCount += 1
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  /** 模拟 will-navigate，返回是否被阻止 */
  emitNavigate(url: string): boolean {
    let prevented = false
    const event: DouyinNavigationEvent = {
      preventDefault: () => {
        prevented = true
      }
    }
    for (const listener of this.navListeners) {
      listener(event, url)
    }
    return prevented
  }
}

/** 创建指向假窗口的解析器 */
function resolverWith(
  window: FakeWindow,
  timeoutMs?: number
): DouyinBrowserBridge {
  return createDouyinBrowserResolver({
    createWindow: () => window,
    random: () => 0.5,
    timeoutMs
  })
}

describe('extractAwemeDetail', () => {
  it('只返回 aweme_id 精确匹配的作品', () => {
    const payload = {
      aweme_detail: { aweme_id: TARGET_ID, desc: '目标作品' }
    }

    expect(extractAwemeDetail(payload, TARGET_ID)).toEqual(payload.aweme_detail)
    expect(extractAwemeDetail(payload, '9999999999999999999')).toBeNull()
    expect(extractAwemeDetail(payload, '')).toBeNull()
    expect(extractAwemeDetail(null, TARGET_ID)).toBeNull()
    expect(extractAwemeDetail({ aweme_detail: {} }, TARGET_ID)).toBeNull()
  })
})

describe('createDouyinBrowserResolver', () => {
  it('命中目标作品后返回详情并清理窗口与调试器', async () => {
    const window = new FakeWindow({
      onLoad: (self) => {
        self.debugger.bodies.set(
          'req-1',
          JSON.stringify(detailPayload(TARGET_ID, '目标作品'))
        )
        self.debugger.emitDetail(DETAIL_URL, 'req-1')
      }
    })

    const detail = await resolverWith(window, 5000).captureAwemeDetail({
      url: `https://www.douyin.com/video/${TARGET_ID}`,
      awemeId: TARGET_ID
    })

    expect(detail?.desc).toBe('目标作品')
    expect(window.userAgents[0]).toContain('Chrome')
    expect(window.debugger.attachCalls).toEqual(['1.3'])
    expect(window.debugger.commands.map((entry) => entry.method)).toContain(
      'Network.enable'
    )
    expect(window.destroyCount).toBe(1)
    expect(window.debugger.detachCount).toBe(1)
    expect(window.debugger.attached).toBe(false)
    expect(window.windowOpenHandler?.()).toEqual({ action: 'deny' })
    expect(window.emitNavigate('https://evil.example/video/1')).toBe(true)
    expect(
      window.emitNavigate(`https://www.douyin.com/video/${TARGET_ID}`)
    ).toBe(false)
  })

  it('忽略其他 aweme_id 并等待目标作品', async () => {
    const window = new FakeWindow({
      onLoad: async (self) => {
        self.debugger.bodies.set(
          'other',
          JSON.stringify(detailPayload('9999999999999999999', '推荐流作品'))
        )
        self.debugger.bodies.set(
          'target',
          JSON.stringify(detailPayload(TARGET_ID, '目标作品'))
        )
        self.debugger.emitDetail(DETAIL_URL, 'other')
        await new Promise((resolve) => {
          setTimeout(resolve, 0)
        })
        self.debugger.emitDetail(DETAIL_URL, 'target')
      }
    })

    const detail = await resolverWith(window, 5000).captureAwemeDetail({
      url: `https://www.douyin.com/video/${TARGET_ID}`,
      awemeId: TARGET_ID
    })

    expect(detail?.desc).toBe('目标作品')
    const bodyCalls = window.debugger.commands.filter(
      (entry) => entry.method === 'Network.getResponseBody'
    )
    expect(bodyCalls).toHaveLength(2)
    expect(window.destroyCount).toBe(1)
    expect(window.debugger.detachCount).toBe(1)
  })

  it('超时返回 null 并销毁窗口', async () => {
    const window = new FakeWindow()

    const detail = await resolverWith(window, 10).captureAwemeDetail({
      url: `https://www.douyin.com/video/${TARGET_ID}`,
      awemeId: TARGET_ID
    })

    expect(detail).toBeNull()
    expect(window.destroyCount).toBe(1)
    expect(window.debugger.detachCount).toBe(1)
  })

  it('页面加载失败返回 null 并销毁窗口', async () => {
    const window = new FakeWindow({ loadError: new Error('ERR_ABORTED') })

    const detail = await resolverWith(window).captureAwemeDetail({
      url: `https://www.douyin.com/video/${TARGET_ID}`,
      awemeId: TARGET_ID
    })

    expect(detail).toBeNull()
    expect(window.destroyCount).toBe(1)
    expect(window.debugger.detachCount).toBe(1)
  })

  it('非抖音地址直接返回 null 且不创建窗口', async () => {
    let created = 0
    const resolver = createDouyinBrowserResolver({
      createWindow: () => {
        created += 1
        return new FakeWindow()
      }
    })

    const detail = await resolver.captureAwemeDetail({
      url: 'https://example.com/video/1',
      awemeId: TARGET_ID
    })

    expect(detail).toBeNull()
    expect(created).toBe(0)
  })
})
