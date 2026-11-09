import { describe, expect, it } from 'vitest'
import {
  createXiaohongshuBrowserResolver,
  type XiaohongshuBrowserBridge,
  type XiaohongshuBrowserWindow,
  type XiaohongshuNavigationEvent,
  type XiaohongshuWebContents
} from '../../src/main/video/xiaohongshu-browser'

/** 目标笔记 ID */
const NOTE_ID = '64a1b2c3d4e5f6a7b8c9d0e1'

/** 带安全参数的笔记页地址 */
const NOTE_URL =
  `https://www.xiaohongshu.com/explore/${NOTE_ID}` +
  '?xsec_token=TOKEN123&xsec_source=pc_share'

/** 构造含目标笔记的状态 */
function noteState(id: string): Record<string, unknown> {
  return {
    note: {
      noteDetailMap: {
        [id]: {
          note: {
            noteId: id,
            type: 'normal',
            title: '浏览器渲染标题',
            imageList: [
              {
                urlDefault: 'https://sns-img-qc.xhscdn.com/browser.jpg',
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

/** 假窗口行为 */
interface FakeWindowOptions {
  /** 自定义 loadURL 行为；缺省立即成功 */
  loadURL?: (url: string) => Promise<void>
  /** executeJavaScript 的返回值 */
  scriptResult?: unknown
  /** executeJavaScript 抛出异常 */
  scriptError?: Error
}

/** 假浏览器窗口：不发起任何真实网络请求 */
class FakeWindow implements XiaohongshuBrowserWindow {
  readonly userAgents: string[] = []
  readonly loadedUrls: string[] = []
  readonly navListeners: Array<
    (event: XiaohongshuNavigationEvent, url: string) => void
  > = []
  readonly webContents: XiaohongshuWebContents
  windowOpenHandler: (() => { action: 'deny' }) | null = null
  destroyCount = 0
  private readonly options: FakeWindowOptions
  private destroyed = false

  constructor(options: FakeWindowOptions = {}) {
    this.options = options
    this.webContents = {
      setUserAgent: (userAgent) => {
        this.userAgents.push(userAgent)
      },
      setWindowOpenHandler: (handler) => {
        this.windowOpenHandler = handler
      },
      on: (_event, listener) => {
        this.navListeners.push(listener)
      },
      loadURL: (url) => {
        this.loadedUrls.push(url)
        return this.options.loadURL === undefined
          ? Promise.resolve()
          : this.options.loadURL(url)
      },
      executeJavaScript: async () => {
        if (this.options.scriptError !== undefined) {
          throw this.options.scriptError
        }
        return this.options.scriptResult
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
    const event: XiaohongshuNavigationEvent = {
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
): XiaohongshuBrowserBridge {
  return createXiaohongshuBrowserResolver({
    createWindow: () => window,
    random: () => 0.5,
    timeoutMs
  })
}

describe('createXiaohongshuBrowserResolver', () => {
  it('正常返回页面状态', async () => {
    const state = noteState(NOTE_ID)
    const window = new FakeWindow({ scriptResult: JSON.stringify(state) })

    const value = await resolverWith(window).loadNoteState({ url: NOTE_URL })

    expect(value).toEqual(state)
    expect(window.loadedUrls).toEqual([NOTE_URL])
    expect(window.userAgents[0]).toContain('Chrome')
    expect(window.windowOpenHandler?.()).toEqual({ action: 'deny' })
    expect(window.emitNavigate('https://evil.example/explore/1')).toBe(true)
    expect(window.emitNavigate(NOTE_URL)).toBe(false)
  })

  it('loadURL 永不结束时按 timeoutMs 返回 null', async () => {
    const window = new FakeWindow({
      loadURL: () => new Promise<void>(() => undefined)
    })

    const value = await resolverWith(window, 10).loadNoteState({
      url: NOTE_URL
    })

    expect(value).toBeNull()
  })

  it('状态不是合法 JSON 时返回 null', async () => {
    const window = new FakeWindow({ scriptResult: 'not-json' })

    const value = await resolverWith(window).loadNoteState({ url: NOTE_URL })

    expect(value).toBeNull()
    expect(window.loadedUrls).toEqual([NOTE_URL])
  })

  it('结束后销毁窗口', async () => {
    const okWindow = new FakeWindow({
      scriptResult: JSON.stringify(noteState(NOTE_ID))
    })
    await resolverWith(okWindow).loadNoteState({ url: NOTE_URL })
    expect(okWindow.destroyCount).toBe(1)
    expect(okWindow.isDestroyed()).toBe(true)

    const failedWindow = new FakeWindow({
      scriptError: new Error('renderer crashed')
    })
    const value = await resolverWith(failedWindow).loadNoteState({
      url: NOTE_URL
    })
    expect(value).toBeNull()
    expect(failedWindow.destroyCount).toBe(1)
    expect(failedWindow.isDestroyed()).toBe(true)
  })
})
