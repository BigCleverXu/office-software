// 分享链接解析：提取链接、识别平台并跟随短链重定向
// 仅主进程使用；无效文本与不支持平台不发起任何网络请求
import {
  MAX_SHORT_LINK_HOPS,
  detectVideoPlatform,
  extractShareUrl,
  isShortLinkUrl,
  type VideoErrorReason,
  type VideoPlatform
} from '../../shared/video'
import { VideoHttpClient, VideoHttpError } from './http-client'

/** 链接解析成功结果 */
export interface ShareLinkSuccess {
  ok: true
  platform: VideoPlatform
  sourceUrl: string
  resolvedUrl: string
}

/** 链接解析失败结果 */
export interface ShareLinkFailure {
  ok: false
  reason: VideoErrorReason
  platform: VideoPlatform | null
  detail?: string
}

/** 链接解析结果 */
export type ShareLinkResult = ShareLinkSuccess | ShareLinkFailure

/** 诊断详情最大长度 */
const MAX_DETAIL_LENGTH = 160

/** 截断错误信息，避免异常刷屏 */
function detailOf(error: unknown): string | undefined {
  const raw = error instanceof Error ? error.message : ''
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  return cleaned === '' ? undefined : cleaned.slice(0, MAX_DETAIL_LENGTH)
}

/**
 * 把短链解析错误归因为面向用户的原因：
 * 限流与网络类保持原义，跳转超限 / 非法跳转视为短链失效。
 */
function mapShortLinkError(error: VideoHttpError): {
  reason: VideoErrorReason
  detail?: string
} {
  if (error.reason === 'rate-limited') {
    return { reason: 'rate-limited', detail: error.detail }
  }
  if (error.reason === 'timeout') {
    return { reason: 'network', detail: error.detail }
  }
  if (error.reason === 'http') {
    const status = error.status
    if (status === 404 || status === 410) {
      return { reason: 'short-link-failed', detail: error.detail }
    }
    return { reason: 'network', detail: error.detail }
  }
  const detail = error.detail ?? ''
  if (
    detail.includes('重定向') ||
    detail.includes('非平台域名') ||
    detail.includes('短链地址') ||
    detail.includes('跳转后平台')
  ) {
    return { reason: 'short-link-failed', detail: error.detail }
  }
  return { reason: 'network', detail: error.detail }
}

/** 构造失败结果 */
function failure(
  reason: VideoErrorReason,
  platform: VideoPlatform | null,
  detail?: string
): ShareLinkFailure {
  return detail === undefined
    ? { ok: false, reason, platform }
    : { ok: false, reason, platform, detail }
}

/**
 * 解析分享链接：从文本提取首个链接、识别平台，
 * 短链最多跟随 5 跳并校验跳转后仍属于同一平台。
 */
export async function resolveShareLink(
  client: VideoHttpClient,
  input: string
): Promise<ShareLinkResult> {
  const sourceUrl = extractShareUrl(input)
  if (sourceUrl === null) {
    return failure('invalid-link', null)
  }
  const platform = detectVideoPlatform(sourceUrl)
  if (platform === null) {
    return failure('unsupported-platform', null)
  }
  if (!isShortLinkUrl(sourceUrl)) {
    return { ok: true, platform, sourceUrl, resolvedUrl: sourceUrl }
  }

  let resolvedUrl: string
  try {
    const redirect = await client.resolveRedirect(sourceUrl, {
      platform,
      maxHops: MAX_SHORT_LINK_HOPS
    })
    resolvedUrl = redirect.url
  } catch (error) {
    if (error instanceof VideoHttpError) {
      const mapped = mapShortLinkError(error)
      return failure(mapped.reason, platform, mapped.detail)
    }
    return failure('network', platform, detailOf(error))
  }

  const resolvedPlatform = detectVideoPlatform(resolvedUrl)
  if (resolvedPlatform !== platform) {
    return failure('short-link-failed', platform, '跳转后平台与原始链接不一致')
  }
  return { ok: true, platform, sourceUrl, resolvedUrl }
}
