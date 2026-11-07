// 短视频模块主进程 HTTP 基础设施：浏览器请求头、按域名限流、Cookie Jar、重试与重定向
// 仅主进程使用；不实现验证码破解、DRM 规避或登录态窃取
import {
  MAX_SHORT_LINK_HOPS,
  detectVideoPlatform,
  type VideoPlatform
} from '../../shared/video'

/** 桌面浏览器 UA（Windows Chrome 稳定版） */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 默认语言偏好，贴近中文用户浏览器 */
const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9'

/** 默认单次请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 10 * 1000

/** 默认重试次数（不含首次请求） */
const DEFAULT_MAX_RETRIES = 3

/** 默认每主机最大并发 */
const DEFAULT_MAX_CONCURRENCY_PER_HOST = 1

/** 默认令牌桶容量 */
const DEFAULT_TOKEN_CAPACITY = 4

/** 默认每秒补充令牌数 */
const DEFAULT_TOKENS_PER_SECOND = 1

/** 请求间抖动下限（毫秒） */
const JITTER_MIN_MS = 100

/** 请求间抖动上限（毫秒，不含） */
const JITTER_MAX_MS = 600

/** 指数退避基数（毫秒） */
const RETRY_BACKOFF_BASE_MS = 500

/** Retry-After 上限，避免异常值导致长时间挂起 */
const RETRY_AFTER_MAX_MS = 10 * 1000

/** 诊断详情最大长度，避免异常信息刷屏 */
const MAX_DETAIL_LENGTH = 160

/** 需要跟随的重定向状态码 */
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308]

/** 各平台默认 Referer */
const DEFAULT_REFERER: Record<VideoPlatform, string> = {
  douyin: 'https://www.douyin.com/',
  kuaishou: 'https://www.kuaishou.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  bilibili: 'https://www.bilibili.com/'
}

/** 请求失败原因 */
export type VideoHttpErrorReason =
  'network' | 'timeout' | 'rate-limited' | 'http'

/** 截断并清洗诊断文本：压缩空白、遮蔽疑似密钥类参数、限长 */
function safeDetail(value: unknown): string | undefined {
  const raw =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : ''
  const cleaned = raw
    .replace(
      /(cookie|authorization|token|signature|w_rid)=([^\s;&]+)/gi,
      '$1=***'
    )
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? undefined : cleaned.slice(0, MAX_DETAIL_LENGTH)
}

/** 短视频请求错误：携带失败原因、HTTP 状态与可展示的诊断详情 */
export class VideoHttpError extends Error {
  readonly reason: VideoHttpErrorReason
  readonly status: number | undefined
  readonly detail: string | undefined

  constructor(
    reason: VideoHttpErrorReason,
    options: { status?: number; detail?: string } = {}
  ) {
    const detail = safeDetail(options.detail)
    super(detail ?? reason)
    this.name = 'VideoHttpError'
    this.reason = reason
    this.status = options.status
    this.detail = detail
  }
}

/** 响应结构，兼容全局 Response */
export interface VideoHttpResponse {
  status: number
  ok: boolean
  headers: Headers
  text: () => Promise<string>
  json: () => Promise<unknown>
  body: ReadableStream<Uint8Array> | null
}

/** 单次请求入参 */
export interface VideoHttpRequestInput {
  url: string
  method?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 单次请求超时（毫秒），默认 10000 */
  timeoutMs?: number
  /** 用于补充默认 Referer 与限流分域 */
  platform?: VideoPlatform
  /** 显式 Referer，优先于平台默认值 */
  referer?: string
  /** 为 false 时只尝试一次，不做重试 */
  retry?: boolean
}

/** 客户端可注入依赖与限流参数 */
export interface VideoHttpClientOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  maxRetries?: number
  maxConcurrencyPerHost?: number
  tokensPerSecond?: number
  tokenCapacity?: number
}

/** 重定向解析入参 */
export interface VideoRedirectOptions {
  /** 最多跟随跳数，默认 5，且不超过 MAX_SHORT_LINK_HOPS */
  maxHops?: number
  /** 目标平台；缺省时按原始地址识别 */
  platform?: VideoPlatform
}

/** 重定向解析结果：hops 按访问顺序包含起始地址与每一跳 */
export interface VideoRedirectResult {
  url: string
  hops: string[]
}

/** 单主机令牌桶与并发状态 */
interface HostState {
  tokens: number
  lastRefilledAt: number
  active: number
  waiters: Array<() => void>
}

/** 判断是否为重定向状态码 */
function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.includes(status)
}

/** 判断是否值得重试：408 / 429 / 5xx */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

/** 解析 Retry-After：支持秒数与 HTTP 日期，非法返回 null */
function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (value === null) {
    return null
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isFinite(seconds)
      ? Math.max(0, Math.round(seconds * 1000))
      : null
  }
  const timestamp = Date.parse(trimmed)
  if (Number.isNaN(timestamp)) {
    return null
  }
  return Math.max(0, timestamp - nowMs)
}

/** 把主机名 / 地址归一化为小写 hostname */
function hostnameOf(value: string): string {
  const trimmed = value.trim()
  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`
  try {
    return new URL(candidate).hostname.toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

/** 从 Set-Cookie 文本中只取 name=value，忽略属性 */
function parseCookiePair(raw: string): [string, string] | null {
  const first = raw.split(';')[0]?.trim() ?? ''
  const index = first.indexOf('=')
  if (index <= 0) {
    return null
  }
  const name = first.slice(0, index).trim()
  const value = first.slice(index + 1).trim()
  return name === '' ? null : [name, value]
}

/** 读取多值 Set-Cookie，优先使用 Headers.getSetCookie */
function readSetCookies(headers: Headers): string[] {
  const holder = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof holder.getSetCookie === 'function') {
    try {
      return holder.getSetCookie()
    } catch {
      // 回退到单值解析
    }
  }
  const single = headers.get('set-cookie')
  if (single === null || single.trim() === '') {
    return []
  }
  // 逗号仅作为 Cookie 分隔符，Expires 属性中的逗号后紧跟日期而非 name=
  return single.split(/,(?=\s*[^;,=\s]+=)/)
}

/** 丢弃未读取的响应体，避免连接悬挂 */
async function discardBody(response: VideoHttpResponse): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // 忽略取消失败
  }
}

/** 按大小写不敏感读取请求头 */
function readHeader(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (headers === undefined) {
    return undefined
  }
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value
    }
  }
  return undefined
}

/**
 * 短视频 HTTP 客户端：按主机维护令牌桶与并发闸门，
 * 自动携带浏览器请求头与 Cookie，并在限流 / 网络异常时退避重试。
 */
export class VideoHttpClient {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly maxRetries: number
  private readonly maxConcurrencyPerHost: number
  private readonly tokensPerSecond: number
  private readonly tokenCapacity: number
  private readonly hosts = new Map<string, HostState>()
  private readonly cookieJar = new Map<string, Map<string, string>>()

  constructor(options: VideoHttpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.sleep =
      options.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms)
        }))
    this.random = options.random ?? Math.random
    this.maxRetries = Math.max(
      0,
      Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES)
    )
    this.maxConcurrencyPerHost = Math.max(
      1,
      Math.floor(
        options.maxConcurrencyPerHost ?? DEFAULT_MAX_CONCURRENCY_PER_HOST
      )
    )
    this.tokensPerSecond = Math.max(
      0.001,
      options.tokensPerSecond ?? DEFAULT_TOKENS_PER_SECOND
    )
    this.tokenCapacity = Math.max(
      1,
      options.tokenCapacity ?? DEFAULT_TOKEN_CAPACITY
    )
  }

  /** 手动补种 Cookie（可传 host 或完整地址），仅保存 name=value */
  setCookie(host: string, cookie: string): void {
    const pair = parseCookiePair(cookie)
    if (pair === null) {
      return
    }
    const [name, value] = pair
    const jar = this.jarOf(hostnameOf(host))
    jar.set(name, value)
  }

  /** 读取某主机的 Cookie 请求头值；无 Cookie 时返回空字符串 */
  getCookies(host: string): string {
    const jar = this.cookieJar.get(hostnameOf(host))
    if (jar === undefined) {
      return ''
    }
    return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ')
  }

  /**
   * 发起请求。内部不自动跟随重定向（redirect: manual），3xx 原样返回；
   * 429 / 408 / 5xx 与网络异常按策略重试，超时不重试。
   */
  async request(input: VideoHttpRequestInput): Promise<VideoHttpResponse> {
    let target: URL
    try {
      target = new URL(input.url)
    } catch {
      throw new VideoHttpError('network', { detail: '请求地址格式非法' })
    }
    const host = target.hostname.toLowerCase()
    const state = this.hostState(host)
    const headers = this.buildHeaders(host, input)
    const timeoutMs =
      typeof input.timeoutMs === 'number' &&
      Number.isFinite(input.timeoutMs) &&
      input.timeoutMs > 0
        ? input.timeoutMs
        : DEFAULT_TIMEOUT_MS
    const retryLimit = input.retry === false ? 0 : this.maxRetries

    for (let attempt = 0; ; attempt += 1) {
      let response: VideoHttpResponse
      try {
        response = await this.runAttempt(
          state,
          target.toString(),
          input,
          headers,
          timeoutMs
        )
      } catch (error) {
        if (!(error instanceof VideoHttpError)) {
          throw error
        }
        // 超时、取消与非法地址不重试
        if (
          error.reason !== 'network' ||
          attempt >= retryLimit ||
          input.signal?.aborted === true
        ) {
          throw error
        }
        await this.sleep(this.retryDelayMs(attempt, null))
        continue
      }

      this.captureCookies(host, response)
      const status = response.status
      if (isRedirectStatus(status) || response.ok) {
        return response
      }
      const retryable = isRetryableStatus(status)
      if (!retryable || attempt >= retryLimit) {
        await discardBody(response)
        if (status === 429) {
          throw new VideoHttpError('rate-limited', {
            status,
            detail: `HTTP ${status}（重试 ${attempt} 次后仍被限流）`
          })
        }
        throw new VideoHttpError('http', {
          status,
          detail: `HTTP ${status}`
        })
      }
      const delayMs = this.retryDelayMs(
        attempt,
        response.headers.get('retry-after')
      )
      await discardBody(response)
      await this.sleep(delayMs)
    }
  }

  /**
   * 解析短链重定向：最多跟随 maxHops 跳，且只接受 HTTPS
   * 与仍属于该平台（含短链域名）的地址。
   */
  async resolveRedirect(
    url: string,
    options: VideoRedirectOptions = {}
  ): Promise<VideoRedirectResult> {
    let current: URL
    try {
      current = new URL(url)
    } catch {
      throw new VideoHttpError('network', { detail: '短链地址格式非法' })
    }
    const platform = options.platform ?? detectVideoPlatform(current.toString())
    if (platform === null) {
      throw new VideoHttpError('network', { detail: '未识别短链所属平台' })
    }
    const requestedHops =
      typeof options.maxHops === 'number' && Number.isFinite(options.maxHops)
        ? Math.floor(options.maxHops)
        : MAX_SHORT_LINK_HOPS
    // 规范要求最多 5 跳，显式参数也不放宽该上限
    const maxHops = Math.min(MAX_SHORT_LINK_HOPS, Math.max(0, requestedHops))
    const hops: string[] = [current.toString()]

    for (let hop = 0; ; hop += 1) {
      const response = await this.request({
        url: current.toString(),
        platform
      })
      if (!isRedirectStatus(response.status)) {
        await discardBody(response)
        return { url: current.toString(), hops }
      }
      const location = response.headers.get('location')
      await discardBody(response)
      if (location === null || location.trim() === '') {
        throw new VideoHttpError('network', {
          detail: '重定向响应缺少 Location'
        })
      }
      let next: URL
      try {
        next = new URL(location, current)
      } catch {
        throw new VideoHttpError('network', { detail: '重定向地址格式非法' })
      }
      if (next.protocol !== 'https:') {
        throw new VideoHttpError('network', {
          detail: '重定向地址必须为 HTTPS'
        })
      }
      if (detectVideoPlatform(next.toString()) !== platform) {
        throw new VideoHttpError('network', {
          detail: '重定向到非平台域名，已中止'
        })
      }
      if (hop >= maxHops) {
        throw new VideoHttpError('network', {
          detail: `重定向次数超过 ${maxHops} 次`
        })
      }
      hops.push(next.toString())
      current = next
    }
  }

  /** 组装请求头：浏览器 UA、语言、Referer 与 Cookie Jar 回填 */
  private buildHeaders(host: string, input: VideoHttpRequestInput): Headers {
    const headers = new Headers()
    headers.set('User-Agent', DESKTOP_USER_AGENT)
    headers.set('Accept-Language', DEFAULT_ACCEPT_LANGUAGE)
    const referer =
      input.referer ??
      (input.platform === undefined
        ? undefined
        : DEFAULT_REFERER[input.platform])
    if (referer !== undefined && referer.trim() !== '') {
      headers.set('Referer', referer)
    }
    const cookie = this.cookieHeader(host, readHeader(input.headers, 'cookie'))
    if (cookie !== '') {
      headers.set('Cookie', cookie)
    }
    if (input.headers !== undefined) {
      for (const [key, value] of Object.entries(input.headers)) {
        if (key.toLowerCase() === 'cookie') {
          continue
        }
        headers.set(key, value)
      }
    }
    return headers
  }

  /** 合并 Cookie Jar 与显式 Cookie */
  private cookieHeader(host: string, explicit?: string): string {
    const stored = this.getCookies(host)
    const extra = typeof explicit === 'string' ? explicit.trim() : ''
    if (stored === '') {
      return extra
    }
    if (extra === '') {
      return stored
    }
    return `${stored}; ${extra}`
  }

  /** 保存响应中的 Set-Cookie，供后续同主机请求回填 */
  private captureCookies(host: string, response: VideoHttpResponse): void {
    for (const raw of readSetCookies(response.headers)) {
      const pair = parseCookiePair(raw)
      if (pair === null) {
        continue
      }
      const [name, value] = pair
      this.jarOf(host).set(name, value)
    }
  }

  /** 取得（必要时创建）主机的 Cookie 容器 */
  private jarOf(host: string): Map<string, string> {
    let jar = this.cookieJar.get(host)
    if (jar === undefined) {
      jar = new Map<string, string>()
      this.cookieJar.set(host, jar)
    }
    return jar
  }

  /** 取得（必要时创建）主机的限流状态 */
  private hostState(host: string): HostState {
    let state = this.hosts.get(host)
    if (state === undefined) {
      state = {
        tokens: this.tokenCapacity,
        lastRefilledAt: this.now(),
        active: 0,
        waiters: []
      }
      this.hosts.set(host, state)
    }
    return state
  }

  /** 单次尝试：排队获取并发槽位与令牌，抖动后发起请求 */
  private async runAttempt(
    state: HostState,
    url: string,
    input: VideoHttpRequestInput,
    headers: Headers,
    timeoutMs: number
  ): Promise<VideoHttpResponse> {
    await this.acquireSlot(state)
    try {
      await this.acquireToken(state)
      await this.sleep(this.jitterDelayMs())
      return await this.fetchOnce(
        url,
        {
          method: input.method ?? 'GET',
          headers,
          signal: input.signal
        },
        timeoutMs
      )
    } finally {
      this.releaseSlot(state)
    }
  }

  /** 获取并发槽位：超出上限时按 FIFO 排队 */
  private acquireSlot(state: HostState): Promise<void> {
    if (state.active < this.maxConcurrencyPerHost) {
      state.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      state.waiters.push(resolve)
    })
  }

  /** 释放并发槽位：优先把槽位直接转交给排队者，保持 active 计数 */
  private releaseSlot(state: HostState): void {
    const next = state.waiters.shift()
    if (next !== undefined) {
      next()
      return
    }
    state.active = Math.max(0, state.active - 1)
  }

  /** 获取令牌：不足时按缺口等待，并用注入时钟补偿，避免假时钟死循环 */
  private async acquireToken(state: HostState): Promise<void> {
    const ratePerMs = this.tokensPerSecond / 1000
    while (true) {
      const nowMs = this.now()
      const elapsed = Math.max(0, nowMs - state.lastRefilledAt)
      if (elapsed > 0) {
        state.tokens = Math.min(
          this.tokenCapacity,
          state.tokens + elapsed * ratePerMs
        )
        state.lastRefilledAt = nowMs
      }
      if (state.tokens >= 1) {
        state.tokens -= 1
        return
      }
      const waitMs = Math.max(1, Math.ceil((1 - state.tokens) / ratePerMs))
      await this.sleep(waitMs)
      // 注入的 now 可能不随 sleep 推进，按等待时长补记令牌
      state.tokens = Math.min(
        this.tokenCapacity,
        state.tokens + waitMs * ratePerMs
      )
      state.lastRefilledAt = this.now()
    }
  }

  /** 请求间随机抖动：100-600ms */
  private jitterDelayMs(): number {
    const span = JITTER_MAX_MS - JITTER_MIN_MS
    return JITTER_MIN_MS + Math.floor(this.random() * span)
  }

  /** 重试等待：优先 Retry-After，否则指数退避加抖动 */
  private retryDelayMs(attempt: number, retryAfter: string | null): number {
    const parsed = parseRetryAfterMs(retryAfter, this.now())
    if (parsed !== null) {
      return Math.min(parsed, RETRY_AFTER_MAX_MS)
    }
    const backoff = RETRY_BACKOFF_BASE_MS * 2 ** attempt
    const jitter = Math.floor(this.random() * RETRY_BACKOFF_BASE_MS)
    return backoff + jitter
  }

  /**
   * 执行一次 fetch：外部取消与超时都通过竞速拒绝，
   * 即使注入的 fetch 不响应 abort 也不会悬挂。
   */
  private async fetchOnce(
    url: string,
    init: { method: string; headers: Headers; signal?: AbortSignal },
    timeoutMs: number
  ): Promise<VideoHttpResponse> {
    const controller = new AbortController()
    const externalSignal = init.signal
    let externalListener: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(
          new VideoHttpError('timeout', {
            detail: `请求超时（${timeoutMs} 毫秒）`
          })
        )
      }, timeoutMs)
    })

    const abortPromise = new Promise<never>((_resolve, reject) => {
      if (externalSignal === undefined) {
        return
      }
      const fail = (): void => {
        controller.abort()
        reject(new VideoHttpError('network', { detail: '请求已取消' }))
      }
      if (externalSignal.aborted) {
        fail()
        return
      }
      externalListener = fail
      externalSignal.addEventListener('abort', fail, { once: true })
    })

    const fetchPromise = Promise.resolve().then(() =>
      this.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        redirect: 'manual',
        signal: controller.signal
      })
    )

    try {
      return await Promise.race([fetchPromise, timeoutPromise, abortPromise])
    } catch (error) {
      if (error instanceof VideoHttpError) {
        throw error
      }
      throw new VideoHttpError('network', { detail: safeDetail(error) })
    } finally {
      if (timer !== null) {
        clearTimeout(timer)
      }
      if (externalSignal !== undefined && externalListener !== null) {
        externalSignal.removeEventListener('abort', externalListener)
      }
    }
  }
}
