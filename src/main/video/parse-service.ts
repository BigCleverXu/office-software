// 短视频解析编排：链接识别、平台分发、总超时、错误归因与资源缓存
// 仅主进程使用；不向调用方抛出异常
import {
  PARSE_TIMEOUT_MS,
  RESOURCE_CACHE_TTL_MS,
  detectVideoPlatform,
  extractShareUrl,
  videoErrorMessage,
  type VideoErrorReason,
  type VideoParseResult,
  type VideoPlatform,
  type VideoResource
} from '../../shared/video'
import {
  createDouyinBrowserResolver,
  type DouyinBrowserBridge
} from './browser-resolver'
import { VideoHttpClient, VideoHttpError } from './http-client'
import { resolveShareLink } from './link'
import { SIGNER_REGISTRY, type PlatformSigner } from './signing'
import { bilibiliProvider } from './providers/bilibili'
import { douyinProvider } from './providers/douyin'
import { kuaishouProvider } from './providers/kuaishou'
import { xiaohongshuProvider } from './providers/xiaohongshu'
import type { ProviderContext, VideoProvider } from './providers/types'

/** 输入文本最大长度 */
const MAX_INPUT_LENGTH = 5000

/** 诊断详情最大长度 */
const MAX_DETAIL_LENGTH = 160

/** 各平台适配器 */
const PROVIDERS: Record<VideoPlatform, VideoProvider> = {
  bilibili: bilibiliProvider,
  douyin: douyinProvider,
  kuaishou: kuaishouProvider,
  xiaohongshu: xiaohongshuProvider
}

/** 缓存条目 */
interface CachedResource {
  resource: VideoResource
  expiresAt: number
}

/** 解析服务可注入依赖 */
export interface VideoParseServiceOptions {
  client?: VideoHttpClient
  signers?: Partial<Record<VideoPlatform, PlatformSigner>>
  now?: () => number
  cacheTtlMs?: number
  /** 单次解析总超时（毫秒），默认 PARSE_TIMEOUT_MS */
  timeoutMs?: number
  /**
   * 抖音浏览器降级桥接：缺省时使用真实 Electron 窗口；
   * 显式传 null 可关闭降级，测试可注入假实现。
   */
  browser?: DouyinBrowserBridge | null
}

/** 截断异常信息 */
function detailOf(error: unknown): string | undefined {
  const raw = error instanceof Error ? error.message : ''
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  return cleaned === '' ? undefined : cleaned.slice(0, MAX_DETAIL_LENGTH)
}

/** 把 HTTP 客户端错误映射为面向用户的原因 */
function mapHttpReason(error: VideoHttpError): VideoErrorReason {
  if (error.reason === 'rate-limited') {
    return 'rate-limited'
  }
  if (error.reason === 'timeout' || error.reason === 'network') {
    return 'network'
  }
  if (error.reason === 'http') {
    if (error.status === 404) {
      return 'expired'
    }
    if (error.status === 403) {
      return 'signature-failed'
    }
    return 'api-changed'
  }
  return 'unknown'
}

/** 按文本预估平台，仅用于错误结果标注 */
function platformOfInput(text: string): VideoPlatform | null {
  const url = extractShareUrl(text)
  return url === null ? null : detectVideoPlatform(url)
}

/**
 * 短视频解析服务：编排链接解析与平台适配器，
 * 总超时 30 秒，成功资源按 resourceId 缓存并支持过期清理。
 */
export class VideoParseService {
  private readonly client: VideoHttpClient
  private readonly signers: Partial<Record<VideoPlatform, PlatformSigner>>
  private readonly now: () => number
  private readonly cacheTtlMs: number
  private readonly timeoutMs: number
  private readonly browser: DouyinBrowserBridge | undefined
  private readonly cache = new Map<string, CachedResource>()

  constructor(options: VideoParseServiceOptions = {}) {
    this.client = options.client ?? new VideoHttpClient()
    this.signers = options.signers ?? SIGNER_REGISTRY
    this.now = options.now ?? Date.now
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? RESOURCE_CACHE_TTL_MS)
    this.timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : PARSE_TIMEOUT_MS
    this.browser =
      options.browser === undefined
        ? createDouyinBrowserResolver()
        : (options.browser ?? undefined)
  }

  /** 解析分享文本；任何失败都以分类结果返回 */
  async parse(input: unknown): Promise<VideoParseResult> {
    const text = typeof input === 'string' ? input.trim() : ''
    if (typeof input !== 'string') {
      return this.failure('invalid-link', null, '输入不是文本')
    }
    if (text === '') {
      return this.failure('invalid-link', null, '输入为空')
    }
    if (text.length > MAX_INPUT_LENGTH) {
      return this.failure(
        'invalid-link',
        null,
        `输入长度超过 ${MAX_INPUT_LENGTH} 字符`
      )
    }

    this.pruneCache()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new VideoHttpError('timeout', { detail: '解析超时' }))
      }, this.timeoutMs)
    })

    try {
      return await Promise.race([this.run(text), timeoutPromise])
    } catch (error) {
      return this.failureFromError(error, text)
    } finally {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }

  /** 读取缓存资源；不存在或已过期返回 null */
  getResource(resourceId: string): VideoResource | null {
    const entry = this.cache.get(resourceId)
    if (entry === undefined) {
      return null
    }
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(resourceId)
      return null
    }
    return entry.resource
  }

  /** 执行一次完整解析 */
  private async run(text: string): Promise<VideoParseResult> {
    const link = await resolveShareLink(this.client, text)
    if (!link.ok) {
      return this.failure(link.reason, link.platform, link.detail)
    }
    const provider = PROVIDERS[link.platform]
    const context: ProviderContext = {
      client: this.client,
      signer: this.signers[link.platform],
      now: this.now,
      browser: this.browser
    }
    const result = await provider.parse(
      { sourceUrl: link.sourceUrl, resolvedUrl: link.resolvedUrl },
      context
    )
    if (!result.ok) {
      return this.failure(result.reason, link.platform, result.detail)
    }
    this.cache.set(result.resource.id, {
      resource: result.resource,
      expiresAt: this.now() + this.cacheTtlMs
    })
    return { ok: true, resource: result.resource }
  }

  /** 错误归因：HTTP 错误细分，其他异常统一为 unknown */
  private failureFromError(error: unknown, text: string): VideoParseResult {
    const platform = platformOfInput(text)
    if (error instanceof VideoHttpError) {
      return this.failure(mapHttpReason(error), platform, error.detail)
    }
    return this.failure('unknown', platform, detailOf(error))
  }

  /** 构造失败结果，文案统一取自共享错误表 */
  private failure(
    reason: VideoErrorReason,
    platform: VideoPlatform | null,
    detail?: string
  ): VideoParseResult {
    const message = videoErrorMessage(reason)
    return detail === undefined
      ? { ok: false, reason, message, platform }
      : { ok: false, reason, message, platform, detail }
  }

  /** 清理已过期的缓存条目 */
  private pruneCache(): void {
    const nowMs = this.now()
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= nowMs) {
        this.cache.delete(key)
      }
    }
  }
}
