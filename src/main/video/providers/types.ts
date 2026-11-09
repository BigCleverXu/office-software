// 短视频平台适配器公共契约：上下文、解析结果与响应读取工具
// 仅主进程使用；适配器只处理公开可访问内容
import type {
  VideoErrorReason,
  VideoPlatform,
  VideoResource
} from '../../../shared/video'
import type { DouyinBrowserBridge } from '../browser-resolver'
import {
  VideoHttpError,
  type VideoHttpClient,
  type VideoHttpResponse
} from '../http-client'
import type { PlatformSigner } from '../signing'
import type { XiaohongshuBrowserBridge } from '../xiaohongshu-browser'

/** 适配器运行上下文：注入客户端、可选签名器、时钟与浏览器降级桥接 */
export interface ProviderContext {
  client: VideoHttpClient
  signer?: PlatformSigner
  now?: () => number
  /** 抖音 HTTP 链路失效时使用的浏览器降级；未注入则不启用 */
  browser?: DouyinBrowserBridge
  /** 小红书 HTTP 链路失效时使用的浏览器降级；未注入则不启用 */
  xiaohongshuBrowser?: XiaohongshuBrowserBridge
}

/** 适配器解析结果：成功返回资源，失败返回分类原因 */
export type ProviderParseResult =
  | { ok: true; resource: VideoResource }
  | { ok: false; reason: VideoErrorReason; detail?: string }

/** 平台适配器接口 */
export interface VideoProvider {
  platform: VideoPlatform
  parse(
    input: { sourceUrl: string; resolvedUrl: string },
    ctx: ProviderContext
  ): Promise<ProviderParseResult>
}

/**
 * 断言响应为 2xx；否则抛出携带状态码的 VideoHttpError，
 * 由解析编排层统一映射为资源失效 / 签名失败 / 接口变更。
 */
export function assertOkResponse(response: VideoHttpResponse): void {
  if (!response.ok) {
    throw new VideoHttpError('http', {
      status: response.status,
      detail: `HTTP ${response.status}`
    })
  }
}

/** 读取 JSON 响应；解析失败返回 null，便于按「接口变更」归因 */
export async function readJsonPayload(
  response: VideoHttpResponse
): Promise<unknown | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/** 读取文本响应；读取失败返回 null */
export async function readTextPayload(
  response: VideoHttpResponse
): Promise<string | null> {
  try {
    return await response.text()
  } catch {
    return null
  }
}
