// 小红书浏览器降级：隐藏窗口渲染笔记页并读取 window.__INITIAL_STATE__
// 仅主进程使用；不注入脚本、不破解验证码，只读取公开页面状态
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 默认读取超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 20 * 1000

/** 读取页面内嵌状态的表达式 */
const STATE_EXPRESSION = 'JSON.stringify(window.__INITIAL_STATE__ ?? null)'

/** 浏览器降级入参 */
export interface XiaohongshuLoadStateInput {
  /** 需要渲染的笔记页地址（应带 xsec_token / xsec_source） */
  url: string
  /** 单次读取超时（毫秒），默认 20000 */
  timeoutMs?: number
}

/** 小红书浏览器桥接：测试可注入假实现，生产使用 Electron 窗口 */
export interface XiaohongshuBrowserBridge {
  loadNoteState(input: XiaohongshuLoadStateInput): Promise<unknown | null>
}

/** 导航事件：仅需阻止导航的能力 */
export interface XiaohongshuNavigationEvent {
  preventDefault: () => void
}

/** 供注入的渲染进程 */
export interface XiaohongshuWebContents {
  setUserAgent(userAgent: string): void
  setWindowOpenHandler(handler: () => { action: 'deny' }): void
  on(
    event: 'will-navigate',
    listener: (event: XiaohongshuNavigationEvent, url: string) => void
  ): void
  loadURL(url: string): Promise<void>
  executeJavaScript(code: string): Promise<unknown>
}

/** 供注入的浏览器窗口 */
export interface XiaohongshuBrowserWindow {
  webContents: XiaohongshuWebContents
  destroy(): void
  isDestroyed?(): boolean
}

/** 窗口工厂入参：partition 为一次性内存会话名 */
export interface XiaohongshuBrowserWindowInit {
  partition: string
}

/** 解析器可注入依赖 */
export interface XiaohongshuBrowserResolverOptions {
  /** 窗口工厂，默认创建隐藏 Electron BrowserWindow；测试可传假窗口 */
  createWindow?: (
    init: XiaohongshuBrowserWindowInit
  ) => XiaohongshuBrowserWindow | Promise<XiaohongshuBrowserWindow>
  /** 默认读取超时（毫秒） */
  timeoutMs?: number
  /** 随机源，用于生成一次性会话名 */
  random?: () => number
}

/** 判断地址是否属于小红书且为 HTTPS */
function isAllowedXiaohongshuUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return false
  }
  try {
    const url = new URL(raw.trim())
    const host = url.hostname.toLowerCase()
    return (
      url.protocol === 'https:' &&
      (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com'))
    )
  } catch {
    return false
  }
}

/** 归一化超时：非法或非正数时回退默认值 */
function resolveTimeout(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  return fallback
}

/** 把 executeJavaScript 的字符串结果解析为状态对象；空值或非法 JSON 返回 null */
function parseStateText(value: unknown): unknown | null {
  if (typeof value !== 'string') {
    return null
  }
  const text = value.trim()
  if (text === '' || text === 'null') {
    return null
  }
  try {
    const parsed = JSON.parse(text)
    return parsed ?? null
  } catch {
    return null
  }
}

/** 默认窗口工厂：创建隐藏窗口并绑定一次性内存会话 */
async function createElectronWindow(
  init: XiaohongshuBrowserWindowInit
): Promise<XiaohongshuBrowserWindow> {
  const { BrowserWindow, session } = await import('electron')
  const browserWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      session: session.fromPartition(init.partition),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  return browserWindow as unknown as XiaohongshuBrowserWindow
}

/**
 * 创建小红书浏览器解析器：渲染笔记页并读取 window.__INITIAL_STATE__。
 * 超时、加载失败、读取失败或状态非法均返回 null；无论成败都会释放窗口。
 */
export function createXiaohongshuBrowserResolver(
  options: XiaohongshuBrowserResolverOptions = {}
): XiaohongshuBrowserBridge {
  const createWindow = options.createWindow ?? createElectronWindow
  const defaultTimeoutMs = resolveTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const random = options.random ?? Math.random

  return {
    async loadNoteState(input) {
      if (!isAllowedXiaohongshuUrl(input.url)) {
        return null
      }
      const timeoutMs = resolveTimeout(input.timeoutMs, defaultTimeoutMs)
      const partition = `xhs-fallback-${Math.floor(random() * 1_000_000_000).toString(36)}`

      let browserWindow: XiaohongshuBrowserWindow
      try {
        browserWindow = await Promise.resolve(createWindow({ partition }))
      } catch {
        return null
      }

      let timer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      let resolveState: (value: unknown | null) => void = () => undefined
      const pending = new Promise<unknown | null>((resolve) => {
        resolveState = resolve
      })

      /** 清理定时器并销毁窗口 */
      const cleanup = (): void => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        try {
          if (browserWindow.isDestroyed?.() !== true) {
            browserWindow.destroy()
          }
        } catch {
          // 忽略销毁失败
        }
      }

      /** 幂等收口：只结算一次并释放资源 */
      const settle = (value: unknown | null): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolveState(value)
      }

      // 超时从窗口创建完成后立即生效，覆盖 loadURL 与 executeJavaScript 全过程
      timer = setTimeout(() => {
        settle(null)
      }, timeoutMs)

      // 一次性加载并读取状态：任何异常都收敛为 null，由 settle 统一释放窗口
      void (async () => {
        try {
          const webContents = browserWindow.webContents
          webContents.setUserAgent(DESKTOP_USER_AGENT)
          webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
          webContents.on('will-navigate', (event, url) => {
            if (!isAllowedXiaohongshuUrl(url)) {
              event.preventDefault()
            }
          })
          await webContents.loadURL(input.url)
          if (settled) {
            return
          }
          const raw = await webContents.executeJavaScript(STATE_EXPRESSION)
          if (settled) {
            return
          }
          settle(parseStateText(raw))
        } catch {
          settle(null)
        }
      })()

      return pending
    }
  }
}
