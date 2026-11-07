// 抖音浏览器降级：隐藏窗口 + CDP 抓取页面内部 aweme/detail 响应
// 仅主进程使用；不注入脚本、不破解验证码，只读取公开作品的网络响应
import { asRecord, pickFirstString } from './providers/embedded'

/** 桌面浏览器 UA（Windows Chrome 稳定版），浏览器降级需要桌面态页面 */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 默认抓取超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 20 * 1000

/** CDP 协议版本 */
const PROTOCOL_VERSION = '1.3'

/** 命中作品详情的响应地址特征 */
const DETAIL_RESPONSE_PATH = '/aweme/detail'

/** 浏览器降级入参 */
export interface DouyinDetailCaptureInput {
  /** 需要渲染的作品页地址 */
  url: string
  /** 期望的作品 ID，用于精确匹配响应体 */
  awemeId: string
  /** 单次抓取超时（毫秒），默认 20000 */
  timeoutMs?: number
}

/** 抖音浏览器桥接：测试可注入假实现，生产使用 Electron 窗口 */
export interface DouyinBrowserBridge {
  captureAwemeDetail(
    input: DouyinDetailCaptureInput
  ): Promise<Record<string, unknown> | null>
}

/** CDP 消息监听器签名 */
export type DouyinDebuggerListener = (
  event: unknown,
  method: unknown,
  params: unknown,
  sessionId?: unknown
) => void

/** 供注入的 CDP 调试会话 */
export interface DouyinDebuggerSession {
  attach(protocolVersion: string): void
  detach(): void
  sendCommand(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown>
  on(event: string, listener: DouyinDebuggerListener): void
}

/** 导航事件：仅需阻止导航的能力 */
export interface DouyinNavigationEvent {
  preventDefault: () => void
}

/** 供注入的渲染进程 */
export interface DouyinWebContents {
  debugger: DouyinDebuggerSession
  setUserAgent(userAgent: string): void
  setWindowOpenHandler(handler: () => { action: 'deny' }): void
  on(
    event: 'will-navigate',
    listener: (event: DouyinNavigationEvent, url: string) => void
  ): void
  loadURL(url: string): Promise<void>
}

/** 供注入的浏览器窗口 */
export interface DouyinBrowserWindow {
  webContents: DouyinWebContents
  destroy(): void
  isDestroyed?(): boolean
}

/** 窗口工厂入参：partition 为一次性内存会话名 */
export interface DouyinBrowserWindowInit {
  partition: string
}

/** 解析器可注入依赖 */
export interface DouyinBrowserResolverOptions {
  /** 窗口工厂，默认创建隐藏 Electron BrowserWindow；测试可传假窗口 */
  createWindow?: (
    init: DouyinBrowserWindowInit
  ) => DouyinBrowserWindow | Promise<DouyinBrowserWindow>
  /** 默认抓取超时（毫秒） */
  timeoutMs?: number
  /** 随机源，用于生成一次性会话名 */
  random?: () => number
}

/** 判断域名是否允许导航 */
function isAllowedDouyinHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'douyin.com' ||
    host.endsWith('.douyin.com') ||
    host === 'iesdouyin.com' ||
    host.endsWith('.iesdouyin.com')
  )
}

/** 判断地址是否属于抖音且为 HTTPS */
function isAllowedDouyinUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return false
  }
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' && isAllowedDouyinHost(url.hostname)
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

/**
 * 从 aweme/detail 响应体中取目标作品：要求 aweme_detail.aweme_id 精确匹配，
 * 避免误取推荐流中的其他作品。不匹配或结构异常返回 null。
 */
export function extractAwemeDetail(
  payload: unknown,
  awemeId: string
): Record<string, unknown> | null {
  const target = typeof awemeId === 'string' ? awemeId.trim() : ''
  if (target === '') {
    return null
  }
  const root = asRecord(payload)
  if (root === null) {
    return null
  }
  const detail = asRecord(root.aweme_detail ?? root.awemeDetail)
  if (detail === null) {
    return null
  }
  const nativeId = pickFirstString(detail.aweme_id, detail.awemeId)
  return nativeId === target ? detail : null
}

/** 默认窗口工厂：创建隐藏窗口并绑定一次性内存会话 */
async function createElectronWindow(
  init: DouyinBrowserWindowInit
): Promise<DouyinBrowserWindow> {
  const { BrowserWindow, session } = await import('electron')
  const browserWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      session: session.fromPartition(init.partition),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  })
  return browserWindow as unknown as DouyinBrowserWindow
}

/**
 * 创建抖音浏览器解析器：加载作品页并抓取页面内部发起的 aweme/detail 响应。
 * 超时、加载失败、无匹配响应均返回 null；无论成败都会释放窗口与调试器。
 */
export function createDouyinBrowserResolver(
  options: DouyinBrowserResolverOptions = {}
): DouyinBrowserBridge {
  const createWindow = options.createWindow ?? createElectronWindow
  const defaultTimeoutMs = resolveTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const random = options.random ?? Math.random

  return {
    async captureAwemeDetail(input) {
      const awemeId = pickFirstString(input.awemeId)
      if (awemeId === '' || !isAllowedDouyinUrl(input.url)) {
        return null
      }
      const timeoutMs = resolveTimeout(input.timeoutMs, defaultTimeoutMs)
      const partition = `douyin-fallback-${Math.floor(random() * 1_000_000_000).toString(36)}`

      let browserWindow: DouyinBrowserWindow
      try {
        browserWindow = await Promise.resolve(createWindow({ partition }))
      } catch {
        return null
      }

      const webContents = browserWindow.webContents
      let debugSession: DouyinDebuggerSession | null = null
      let attached = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      let resolveCapture: (
        value: Record<string, unknown> | null
      ) => void = () => undefined
      const capture = new Promise<Record<string, unknown> | null>((resolve) => {
        resolveCapture = resolve
      })

      const cleanup = (): void => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        if (attached) {
          attached = false
          try {
            debugSession?.detach()
          } catch {
            // 忽略 detach 失败
          }
        }
        try {
          if (browserWindow.isDestroyed?.() !== true) {
            browserWindow.destroy()
          }
        } catch {
          // 忽略销毁失败
        }
      }

      const settle = (value: Record<string, unknown> | null): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolveCapture(value)
      }

      /** 读取匹配响应的响应体并按作品 ID 校验 */
      const readDetail = async (requestId: string): Promise<void> => {
        try {
          const bodyPayload = await debugSession?.sendCommand(
            'Network.getResponseBody',
            { requestId }
          )
          if (settled) {
            return
          }
          const body = asRecord(bodyPayload)
          const raw = typeof body?.body === 'string' ? body.body : ''
          if (raw === '') {
            return
          }
          const text =
            body?.base64Encoded === true
              ? Buffer.from(raw, 'base64').toString('utf8')
              : raw
          let payload: unknown
          try {
            payload = JSON.parse(text)
          } catch {
            return
          }
          const detail = extractAwemeDetail(payload, awemeId)
          if (detail !== null) {
            settle(detail)
          }
        } catch {
          // 读取失败则继续等待后续响应
        }
      }

      /** 监听 CDP 网络事件，命中详情接口后读取响应体 */
      const onDebuggerMessage: DouyinDebuggerListener = (
        _event,
        method,
        params
      ) => {
        if (settled || method !== 'Network.responseReceived') {
          return
        }
        const event = asRecord(params)
        const response = asRecord(event?.response)
        const url = pickFirstString(response?.url)
        if (!url.includes(DETAIL_RESPONSE_PATH)) {
          return
        }
        const requestId = pickFirstString(event?.requestId)
        if (requestId === '') {
          return
        }
        void readDetail(requestId)
      }

      // 超时从窗口创建完成后立即生效，覆盖 attach / Network.enable / 页面加载全过程
      timer = setTimeout(() => {
        settle(null)
      }, timeoutMs)

      try {
        debugSession = webContents.debugger
        webContents.setUserAgent(DESKTOP_USER_AGENT)
        webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        webContents.on('will-navigate', (event, url) => {
          if (!isAllowedDouyinUrl(url)) {
            event.preventDefault()
          }
        })
        debugSession.attach(PROTOCOL_VERSION)
        attached = true
        debugSession.on('message', onDebuggerMessage)
        // Electron 中 Network.enable 可能长时间不返回，但不影响后续网络事件上报，
        // 因此不阻塞等待，只忽略失败（超时仍由上面的 timer 兜底）
        void Promise.resolve(debugSession.sendCommand('Network.enable')).catch(
          () => undefined
        )
      } catch {
        settle(null)
        return capture
      }

      if (settled) {
        return capture
      }

      try {
        void Promise.resolve(webContents.loadURL(input.url)).catch(() => {
          settle(null)
        })
      } catch {
        settle(null)
      }

      return capture
    }
  }
}
