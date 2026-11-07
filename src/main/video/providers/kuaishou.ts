// 快手适配器：分享页 __APOLLO_STATE__ 解析，视频 manifest 与图文 atlas
// 仅主进程使用；只处理公开分享页内嵌状态
import type {
  VideoImage,
  VideoResource,
  VideoVariant
} from '../../../shared/video'
import {
  absoluteUrl,
  asArray,
  asRecord,
  numberOrUndefined,
  parseJsonValue,
  pickFirstString,
  readEmbeddedJson
} from './embedded'
import {
  assertOkResponse,
  readTextPayload,
  type ProviderParseResult,
  type VideoProvider
} from './types'

/** 快手站点根地址 */
const SITE_ORIGIN = 'https://www.kuaishou.com'

/** 页面明确提示资源不存在的文案 */
const NOT_FOUND_TEXTS: readonly string[] = [
  '作品不存在',
  '作品已删除',
  '内容不见了',
  '页面不存在'
]

/** 阿波罗状态中的作品实体前缀 */
const ENTITY_PREFIXES: readonly string[] = ['VisionVideoDetailPhoto:', 'Photo:']

/** 快手目标 */
interface KuaishouTarget {
  id: string
}

/** 从单个地址提取作品 ID */
function extractFromUrl(raw: string): KuaishouTarget | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const shortVideo = url.pathname.match(/\/short-video\/([A-Za-z0-9_-]+)/)
  if (shortVideo !== null) {
    return { id: shortVideo[1] ?? '' }
  }
  const photo = url.pathname.match(/\/photo\/([A-Za-z0-9_-]+)/)
  if (photo !== null) {
    return { id: photo[1] ?? '' }
  }
  return null
}

/** 依据宽高推断清晰度展示名 */
function labelFromDimensions(
  width: number | undefined,
  height: number | undefined
): string {
  const shortSide =
    width !== undefined && height !== undefined
      ? Math.min(width, height)
      : (width ?? height)
  if (shortSide === undefined || shortSide <= 0) {
    return ''
  }
  if (shortSide >= 2160) {
    return '4K'
  }
  if (shortSide >= 1440) {
    return '2K'
  }
  if (shortSide >= 1080) {
    return '1080P'
  }
  if (shortSide >= 720) {
    return '720P'
  }
  if (shortSide >= 540) {
    return '540P'
  }
  if (shortSide >= 360) {
    return '360P'
  }
  return `${Math.round(shortSide)}P`
}

/** 判断对象是否像作品实体 */
function looksLikePhoto(record: Record<string, unknown>): boolean {
  return (
    typeof record.photoUrl === 'string' ||
    typeof record.photoH265Url === 'string' ||
    typeof record.caption === 'string' ||
    typeof record.manifest === 'string' ||
    typeof record.coverUrl === 'string'
  )
}

/** 按实体键查找 Apollo 状态 */
function findEntityByKey(
  value: unknown,
  id: string
): Record<string, unknown> | null {
  const record = asRecord(value)
  if (record === null) {
    return null
  }
  for (const prefix of ENTITY_PREFIXES) {
    const entity = asRecord(record[`${prefix}${id}`])
    if (entity !== null && looksLikePhoto(entity)) {
      return entity
    }
  }
  for (const child of Object.values(record)) {
    const found = findEntityByKey(child, id)
    if (found !== null) {
      return found
    }
  }
  return null
}

/** 按实体字段查找 Apollo 状态 */
function findEntityByShape(
  value: unknown,
  id: string
): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEntityByShape(item, id)
      if (found !== null) {
        return found
      }
    }
    return null
  }
  const record = asRecord(value)
  if (record === null) {
    return null
  }
  const entityId = pickFirstString(record.id, record.photoId)
  if (entityId === id && looksLikePhoto(record)) {
    return record
  }
  for (const child of Object.values(record)) {
    const found = findEntityByShape(child, id)
    if (found !== null) {
      return found
    }
  }
  return null
}

/** 判断页面文本是否明确表示资源不存在 */
function hasNotFoundText(html: string): boolean {
  return NOT_FOUND_TEXTS.some((text) => html.includes(text))
}

/** 从 manifest 生成清晰度档位 */
function manifestVariants(manifest: unknown): VideoVariant[] {
  const root = asRecord(manifest)
  if (root === null) {
    return []
  }
  const adaptations = asArray(root.adaptationSet ?? root.adaptation_set)
  const variants: VideoVariant[] = []
  for (const item of adaptations) {
    const adaptation = asRecord(item)
    if (adaptation === null) {
      continue
    }
    const representations = asArray(
      adaptation.representation ?? adaptation.representations
    )
    for (const representation of representations) {
      const entry = asRecord(representation)
      if (entry === null) {
        continue
      }
      const rawUrl = pickFirstString(entry.url, entry.baseUrl, entry.base_url)
      const url = absoluteUrl(SITE_ORIGIN, rawUrl)
      if (url === undefined) {
        continue
      }
      const width = numberOrUndefined(entry.width)
      const height = numberOrUndefined(entry.height)
      const bitrate =
        numberOrUndefined(entry.avgBitrate) ??
        numberOrUndefined(entry.avg_bitrate)
      const qualityRank = bitrate ?? height ?? width ?? 0
      const label =
        pickFirstString(entry.qualityLabel, entry.quality_label) ||
        labelFromDimensions(width, height) ||
        '原始画质'
      const variant: VideoVariant = {
        id: `kuaishou-${variants.length}`,
        label,
        qualityRank,
        container: 'mp4',
        url
      }
      if (width !== undefined) {
        variant.width = width
      }
      if (height !== undefined) {
        variant.height = height
      }
      variants.push(variant)
    }
  }
  variants.sort((left, right) => right.qualityRank - left.qualityRank)
  return variants
}

/** 从 atlas 提取图文图片 */
function atlasImages(entity: Record<string, unknown>): VideoImage[] {
  const extParams = asRecord(parseJsonValue(entity.ext_params))
  const raw =
    parseJsonValue(entity.atlas) ??
    (extParams === null ? null : parseJsonValue(extParams.atlas))
  const root = asRecord(raw)
  const list = Array.isArray(raw) ? raw : asArray(root?.atlas)
  const images: VideoImage[] = []
  for (const item of list) {
    const record = asRecord(item)
    if (record === null) {
      continue
    }
    const cdnUrl = asArray(record.cdn).find(
      (value): value is string =>
        typeof value === 'string' && value.trim() !== ''
    )
    const url = absoluteUrl(SITE_ORIGIN, cdnUrl)
    if (url === undefined) {
      continue
    }
    const image: VideoImage = { url }
    const width = numberOrUndefined(record.width)
    const height = numberOrUndefined(record.height)
    if (width !== undefined) {
      image.width = width
    }
    if (height !== undefined) {
      image.height = height
    }
    images.push(image)
  }
  return images
}

/** 由作品实体构建统一资源 */
function buildResource(
  entity: Record<string, unknown>,
  id: string,
  input: { sourceUrl: string; resolvedUrl: string }
): ProviderParseResult {
  const caption = pickFirstString(entity.caption, entity.title)
  const title = caption === '' ? `快手作品 ${id}` : caption
  const author = pickFirstString(entity.userName, entity.nickname)
  const coverUrl = absoluteUrl(SITE_ORIGIN, entity.coverUrl)
  const images = atlasImages(entity)
  const kind = images.length > 0 ? 'note' : 'video'

  let variants: VideoVariant[] = []
  if (kind === 'video') {
    variants = manifestVariants(parseJsonValue(entity.manifest))
    if (variants.length === 0) {
      const rawUrl = pickFirstString(entity.photoUrl, entity.photoH265Url)
      const url = absoluteUrl(SITE_ORIGIN, rawUrl)
      if (url === undefined) {
        return { ok: false, reason: 'empty', detail: '未获取到播放地址' }
      }
      const width = numberOrUndefined(entity.width)
      const height = numberOrUndefined(entity.height)
      const variant: VideoVariant = {
        id: 'kuaishou-original',
        label: labelFromDimensions(width, height) || '原始画质',
        qualityRank: height ?? width ?? 0,
        container: 'mp4',
        url
      }
      if (width !== undefined) {
        variant.width = width
      }
      if (height !== undefined) {
        variant.height = height
      }
      variants = [variant]
    }
  }

  const resource: VideoResource = {
    id: `kuaishou:${id}`,
    platform: 'kuaishou',
    nativeId: id,
    kind,
    title,
    author,
    sourceUrl: input.sourceUrl,
    resolvedUrl: input.resolvedUrl,
    shareUrl: `${SITE_ORIGIN}/short-video/${id}`,
    variants,
    images
  }
  if (coverUrl !== undefined) {
    resource.cover = { url: coverUrl }
  }
  if (caption !== '') {
    resource.description = caption
  }
  const durationMs = numberOrUndefined(entity.duration)
  if (durationMs !== undefined && durationMs > 0) {
    resource.durationSec = Math.round(durationMs / 1000)
  }
  return { ok: true, resource }
}

/** 快手适配器 */
export const kuaishouProvider: VideoProvider = {
  platform: 'kuaishou',
  async parse(input, ctx) {
    const target =
      extractFromUrl(input.resolvedUrl) ?? extractFromUrl(input.sourceUrl)
    if (target === null) {
      return {
        ok: false,
        reason: 'api-changed',
        detail: '无法识别快手作品标识'
      }
    }
    const resolvedTarget = extractFromUrl(input.resolvedUrl)
    const pageUrl =
      resolvedTarget !== null && resolvedTarget.id === target.id
        ? input.resolvedUrl
        : `${SITE_ORIGIN}/short-video/${target.id}`

    const response = await ctx.client.request({
      url: pageUrl,
      platform: 'kuaishou'
    })
    if (response.status === 404) {
      return { ok: false, reason: 'expired', detail: '分享页不存在' }
    }
    assertOkResponse(response)
    const html = (await readTextPayload(response)) ?? ''
    if (html.trim() === '') {
      return { ok: false, reason: 'api-changed', detail: '分享页内容为空' }
    }
    const state = readEmbeddedJson(html, 'window.__APOLLO_STATE__')
    const entity =
      findEntityByKey(state, target.id) ?? findEntityByShape(state, target.id)
    if (entity === null) {
      return {
        ok: false,
        reason: hasNotFoundText(html) ? 'expired' : 'api-changed',
        detail: '未找到作品实体'
      }
    }
    return buildResource(entity, target.id, input)
  }
}
