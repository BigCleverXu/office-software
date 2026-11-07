// 抖音适配器：分享页 _ROUTER_DATA 解析，兼容旧版 iteminfo 接口
// 仅主进程使用；去水印仅替换公开播放地址路径，不涉及登录态
import type {
  VideoImage,
  VideoResource,
  VideoStats,
  VideoVariant
} from '../../../shared/video'
import {
  absoluteUrl,
  asArray,
  asRecord,
  numberOrUndefined,
  pickFirstString,
  readEmbeddedJson
} from './embedded'
import {
  assertOkResponse,
  readJsonPayload,
  readTextPayload,
  type ProviderContext,
  type ProviderParseResult,
  type VideoProvider
} from './types'

/** 分享页地址模板 */
const SHARE_PAGE_URL = 'https://www.iesdouyin.com/share'

/** 旧版作品信息接口 */
const ITEMINFO_URL = 'https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/'

/** 抖音站点根地址 */
const SITE_ORIGIN = 'https://www.douyin.com'

/** 分享页需要的移动端 UA（iOS Safari），桌面 UA 拿不到内嵌数据 */
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 ' +
  'Mobile/15E148 Safari/604.1'

/** 页面明确提示资源不存在的文案 */
const NOT_FOUND_TEXTS: readonly string[] = [
  '作品不存在',
  '作品已删除',
  '视频不存在',
  '内容不见了',
  '当前内容无法查看'
]

/** 抖音目标 */
interface DouyinTarget {
  id: string
  kindHint: 'video' | 'note'
}

/** 从单个地址提取作品 ID 与类型提示 */
function extractFromUrl(raw: string): DouyinTarget | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const videoMatch = url.pathname.match(/\/video\/(\d+)/)
  if (videoMatch !== null) {
    return { id: videoMatch[1] ?? '', kindHint: 'video' }
  }
  const noteMatch = url.pathname.match(/\/note\/(\d+)/)
  if (noteMatch !== null) {
    return { id: noteMatch[1] ?? '', kindHint: 'note' }
  }
  const modalId = url.searchParams.get('modal_id')
  if (modalId !== null && /^\d+$/.test(modalId.trim())) {
    return { id: modalId.trim(), kindHint: 'video' }
  }
  const awemeId = url.searchParams.get('aweme_id')
  if (awemeId !== null && /^\d+$/.test(awemeId.trim())) {
    return { id: awemeId.trim(), kindHint: 'video' }
  }
  return null
}

/** 从原始分享地址与最终地址提取目标 */
function extractTarget(input: {
  sourceUrl: string
  resolvedUrl: string
}): DouyinTarget | null {
  return (
    extractFromUrl(input.resolvedUrl) ?? extractFromUrl(input.sourceUrl) ?? null
  )
}

/** 读取 url_list / urlList 中的字符串地址 */
function urlListOf(value: unknown): string[] {
  const record = asRecord(value)
  if (record === null) {
    return []
  }
  const list = asArray(record.url_list ?? record.urlList)
  return list.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== ''
  )
}

/** 去水印：把公开播放地址中的 playwm 替换为 play */
function dewatermark(url: string): string {
  return url.replace(/playwm/g, 'play')
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

/** 判断对象是否像一条作品数据 */
function looksLikeItem(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value)
  if (record === null) {
    return false
  }
  if (pickFirstString(record.aweme_id, record.awemeId) !== '') {
    return true
  }
  const hasVideo = asRecord(record.video) !== null
  const hasImages = asArray(record.images).length > 0
  return (hasVideo || hasImages) && typeof record.desc === 'string'
}

/** 递归查找首个带作品条目的 item_list */
function findAweme(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (looksLikeItem(item)) {
        return item
      }
      const nested = findAweme(item)
      if (nested !== null) {
        return nested
      }
    }
    return null
  }
  const record = asRecord(value)
  if (record === null) {
    return null
  }
  const list = record.item_list
  if (Array.isArray(list)) {
    for (const item of list) {
      if (looksLikeItem(item)) {
        return item
      }
    }
  }
  for (const child of Object.values(record)) {
    const found = findAweme(child)
    if (found !== null) {
      return found
    }
  }
  return null
}

/** 从 item_list 中取首个有效作品 */
function findItemInList(list: unknown[]): Record<string, unknown> | null {
  for (const item of list) {
    if (looksLikeItem(item)) {
      return item
    }
  }
  return null
}

/** 判断页面文本是否明确表示资源不存在 */
function hasNotFoundText(html: string): boolean {
  return NOT_FOUND_TEXTS.some((text) => html.includes(text))
}

/** 播放地址里的 ratio 档位（如 720p）：返回展示名与排序值 */
function ratioOfUrl(raw: string): { label: string; rank: number } | null {
  let ratio: string | null = null
  try {
    ratio = new URL(raw).searchParams.get('ratio')
  } catch {
    return null
  }
  if (ratio === null) {
    return null
  }
  const match = ratio.trim().toLowerCase().match(/^(\d+)p$/)
  if (match === null) {
    return null
  }
  const px = Number.parseInt(match[1] ?? '', 10)
  if (!Number.isFinite(px) || px <= 0) {
    return null
  }
  const labels: Record<number, string> = {
    2160: '4K',
    1440: '2K',
    1080: '1080P',
    720: '720P',
    540: '540P',
    480: '480P',
    360: '360P'
  }
  return { label: labels[px] ?? `${px}P`, rank: px }
}

/** 生成视频清晰度档位 */
function buildVariants(video: Record<string, unknown>): VideoVariant[] {
  const defaultPlay = asRecord(video.play_addr ?? video.playAddr)
  const defaultUrls = urlListOf(defaultPlay).map(dewatermark)
  const bitRates = asArray(video.bit_rate ?? video.bitRate)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
  if (bitRates.length > 0) {
    const variants: VideoVariant[] = []
    for (const [index, entry] of bitRates.entries()) {
      const play = asRecord(entry.play_addr ?? entry.playAddr)
      const url = urlListOf(play).map(dewatermark)[0] ?? defaultUrls[0]
      if (url === undefined) {
        continue
      }
      const width =
        numberOrUndefined(play?.width) ?? numberOrUndefined(entry.width)
      const height =
        numberOrUndefined(play?.height) ?? numberOrUndefined(entry.height)
      const qualityRank =
        numberOrUndefined(entry.bit_rate) ??
        numberOrUndefined(entry.bitRate) ??
        height ??
        width ??
        0
      const label =
        pickFirstString(entry.gear_name, entry.gearName) ||
        labelFromDimensions(width, height) ||
        '原始画质'
      const variant: VideoVariant = {
        id: `douyin-${qualityRank}-${index}`,
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
    if (variants.length > 0) {
      variants.sort((left, right) => right.qualityRank - left.qualityRank)
      return variants
    }
  }

  const h264 = asRecord(video.play_addr_h264 ?? video.playAddrH264)
  const url = defaultUrls[0] ?? urlListOf(h264).map(dewatermark)[0]
  if (url === undefined) {
    return []
  }
  // 分享页只返回单一播放地址，真实档位由地址里的 ratio 参数决定，
  // 此时不能再拿作品原始宽高来标注，否则会出现 720P 地址被标成 4K。
  const ratio = ratioOfUrl(url)
  if (ratio !== null) {
    return [
      {
        id: 'douyin-ratio',
        label: ratio.label,
        qualityRank: ratio.rank,
        container: 'mp4',
        url
      }
    ]
  }
  const width =
    numberOrUndefined(video.width) ?? numberOrUndefined(defaultPlay?.width)
  const height =
    numberOrUndefined(video.height) ?? numberOrUndefined(defaultPlay?.height)
  const label = labelFromDimensions(width, height) || '原始画质'
  const variant: VideoVariant = {
    id: 'douyin-original',
    label,
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
  return [variant]
}

/** 读取图文图片列表 */
function buildImages(item: Record<string, unknown>): VideoImage[] {
  const images: VideoImage[] = []
  for (const entry of asArray(item.images)) {
    const record = asRecord(entry)
    const url = urlListOf(record).map(dewatermark)[0]
    if (url === undefined) {
      continue
    }
    const image: VideoImage = { url }
    const width = record === null ? undefined : numberOrUndefined(record.width)
    const height =
      record === null ? undefined : numberOrUndefined(record.height)
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

/** 读取互动数据 */
function readStats(item: Record<string, unknown>): VideoStats | undefined {
  const record = asRecord(item.statistics)
  if (record === null) {
    return undefined
  }
  const stats: VideoStats = {}
  const likes = numberOrUndefined(record.digg_count)
  const comments = numberOrUndefined(record.comment_count)
  const collects = numberOrUndefined(record.collect_count)
  if (likes !== undefined) {
    stats.likes = likes
  }
  if (comments !== undefined) {
    stats.comments = comments
  }
  if (collects !== undefined) {
    stats.collects = collects
  }
  return Object.keys(stats).length > 0 ? stats : undefined
}

/** 由作品数据构建统一资源 */
function buildResource(
  item: Record<string, unknown>,
  target: DouyinTarget,
  input: { sourceUrl: string; resolvedUrl: string }
): ProviderParseResult {
  const nativeId = pickFirstString(item.aweme_id, item.awemeId) || target.id
  const images = buildImages(item)
  const kind = images.length > 0 ? 'note' : 'video'
  const author = asRecord(item.author)
  const video = asRecord(item.video)
  const coverUrl =
    video === null ? '' : (urlListOf(asRecord(video.cover))[0] ?? '')
  const coverAbsolute = absoluteUrl('https://www.douyin.com', coverUrl)
  const description = pickFirstString(item.desc)
  const title =
    description === ''
      ? `抖音${kind === 'note' ? '图文' : '视频'} ${nativeId}`
      : description

  let variants: VideoVariant[] = []
  if (kind === 'video') {
    if (video === null) {
      return { ok: false, reason: 'empty', detail: '作品未包含视频信息' }
    }
    variants = buildVariants(video)
    if (variants.length === 0) {
      return { ok: false, reason: 'empty', detail: '未获取到播放地址' }
    }
  }

  const resource: VideoResource = {
    id: `douyin:${nativeId}`,
    platform: 'douyin',
    nativeId,
    kind,
    title,
    author: author === null ? '' : pickFirstString(author.nickname),
    sourceUrl: input.sourceUrl,
    resolvedUrl: input.resolvedUrl,
    shareUrl: `https://www.douyin.com/${kind === 'note' ? 'note' : 'video'}/${nativeId}`,
    variants,
    images
  }
  if (coverAbsolute !== undefined) {
    resource.cover = { url: coverAbsolute }
  }
  if (description !== '') {
    resource.description = description
  }
  const durationMs =
    video === null ? undefined : numberOrUndefined(video.duration)
  if (durationMs !== undefined && durationMs > 0) {
    resource.durationSec = Math.round(durationMs / 1000)
  }
  const stats = readStats(item)
  if (stats !== undefined) {
    resource.stats = stats
  }
  return { ok: true, resource }
}

/** 请求分享页并提取作品数据 */
async function parseSharePage(
  target: DouyinTarget,
  ctx: ProviderContext
): Promise<{
  item: Record<string, unknown> | null
  expiredHint: boolean
}> {
  const url = `${SHARE_PAGE_URL}/${target.kindHint}/${target.id}/`
  const response = await ctx.client.request({
    url,
    platform: 'douyin',
    headers: { 'User-Agent': MOBILE_USER_AGENT }
  })
  if (response.status === 404) {
    return { item: null, expiredHint: true }
  }
  assertOkResponse(response)
  const html = (await readTextPayload(response)) ?? ''
  if (html.trim() === '') {
    return { item: null, expiredHint: false }
  }
  if (hasNotFoundText(html)) {
    return { item: null, expiredHint: true }
  }
  const state = readEmbeddedJson(html, 'window._ROUTER_DATA')
  return { item: findAweme(state), expiredHint: false }
}

/** 请求旧版 iteminfo 接口并提取作品数据 */
async function parseItemInfo(
  id: string,
  ctx: ProviderContext
): Promise<{
  item: Record<string, unknown> | null
  expiredHint: boolean
}> {
  const response = await ctx.client.request({
    url: `${ITEMINFO_URL}?item_ids=${encodeURIComponent(id)}`,
    platform: 'douyin'
  })
  if (response.status === 404) {
    return { item: null, expiredHint: true }
  }
  assertOkResponse(response)
  const payload = await readJsonPayload(response)
  const root = asRecord(payload)
  if (root === null) {
    return { item: null, expiredHint: false }
  }
  const list = asArray(root.item_list ?? root.itemList)
  const item = findItemInList(list)
  if (item === null) {
    // 200 但无条目属于接口失效，不能判定作品过期
    return { item: null, expiredHint: false }
  }
  return { item, expiredHint: false }
}

/** 浏览器降级使用的作品页地址：优先最终地址，否则按类型拼接 */
function browserUrlFor(target: DouyinTarget, resolvedUrl: string): string {
  try {
    const url = new URL(resolvedUrl)
    const host = url.hostname.toLowerCase()
    if (
      host === 'douyin.com' ||
      host === 'www.douyin.com' ||
      host === 'm.douyin.com'
    ) {
      return url.toString()
    }
  } catch {
    // 忽略非法地址，回退到标准作品页
  }
  return `${SITE_ORIGIN}/${target.kindHint}/${target.id}`
}

/** 通过浏览器渲染抓取作品详情；失败一律返回 null */
async function captureByBrowser(
  target: DouyinTarget,
  input: { sourceUrl: string; resolvedUrl: string },
  browser: ProviderContext['browser']
): Promise<Record<string, unknown> | null> {
  if (browser === undefined) {
    return null
  }
  try {
    return await browser.captureAwemeDetail({
      url: browserUrlFor(target, input.resolvedUrl),
      awemeId: target.id
    })
  } catch {
    return null
  }
}

/** 抖音适配器 */
export const douyinProvider: VideoProvider = {
  platform: 'douyin',
  async parse(input, ctx) {
    const target = extractTarget(input)
    if (target === null) {
      return {
        ok: false,
        reason: 'api-changed',
        detail: '无法识别抖音作品标识'
      }
    }

    const share = await parseSharePage(target, ctx)
    let item = share.item
    let expiredHint = share.expiredHint

    if (item === null) {
      const info = await parseItemInfo(target.id, ctx)
      item = info.item
      expiredHint = expiredHint || info.expiredHint
    }

    if (item === null && !expiredHint) {
      item = await captureByBrowser(target, input, ctx.browser)
    }

    if (item === null) {
      if (expiredHint) {
        return { ok: false, reason: 'expired', detail: '未找到作品数据' }
      }
      if (ctx.browser !== undefined) {
        return {
          ok: false,
          reason: 'api-changed',
          detail: '抖音需要浏览器渲染，未能获取作品数据'
        }
      }
      return { ok: false, reason: 'api-changed', detail: '未找到作品数据' }
    }
    if (!looksLikeItem(item)) {
      return { ok: false, reason: 'api-changed', detail: '作品结构异常' }
    }
    return buildResource(item, target, input)
  }
}
