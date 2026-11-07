// 哔哩哔哩适配器：view / WBI 签名 playurl / 专栏图文
// 仅主进程使用；只请求公开 Web API
import type {
  VideoContainer,
  VideoImage,
  VideoResource,
  VideoStats,
  VideoVariant
} from '../../../shared/video'
import { isAllowedMediaUrl } from '../../../shared/video'
import {
  absoluteUrl,
  asArray,
  asRecord,
  numberOrUndefined,
  pickFirstString,
  stripHtml,
  toIsoTime
} from './embedded'
import {
  assertOkResponse,
  readJsonPayload,
  type ProviderContext,
  type ProviderParseResult,
  type VideoProvider
} from './types'

/** 视频信息接口 */
const VIEW_URL = 'https://api.bilibili.com/x/web-interface/view'

/** 播放地址接口 */
const PLAYURL_URL = 'https://api.bilibili.com/x/player/playurl'

/** 专栏文章接口 */
const ARTICLE_URL = 'https://api.bilibili.com/x/article/view'

/** B 站站点根地址，用于补全封面等相对地址 */
const SITE_ORIGIN = 'https://www.bilibili.com'

/** 清晰度 ID 到展示名 */
const QUALITY_LABELS: Record<number, string> = {
  127: '8K',
  126: '杜比视界',
  125: 'HDR',
  120: '4K',
  116: '1080P60',
  80: '1080P',
  74: '720P60',
  64: '720P',
  32: '480P',
  16: '360P'
}

/** 明确表示资源不存在或已删除的接口码 */
const EXPIRED_CODES: readonly number[] = [-404, 62002, 62004]

/** 视频目标 */
interface VideoTarget {
  kind: 'video'
  bvid?: string
  aid?: number
  page: number
}

/** 专栏目标 */
interface ArticleTarget {
  kind: 'article'
  id: number
}

type BilibiliTarget = VideoTarget | ArticleTarget

/** 读取分 P 序号：缺省或非法为 1 */
function readPage(raw: string | null): number {
  const value = numberOrUndefined(raw)
  return value !== undefined && value > 0 ? Math.floor(value) : 1
}

/** 识别地址中的视频 / 专栏目标 */
function parseTarget(raw: string): BilibiliTarget | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null
  }
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const path = url.pathname
  const bvidMatch = path.match(/\/video\/(BV[0-9A-Za-z]+)/)
  if (bvidMatch !== null) {
    const bvid = bvidMatch[1] ?? ''
    return { kind: 'video', bvid, page: readPage(url.searchParams.get('p')) }
  }
  const aidMatch = path.match(/\/video\/av(\d+)/i)
  if (aidMatch !== null) {
    const aid = numberOrUndefined(aidMatch[1] ?? '')
    if (aid !== undefined) {
      return { kind: 'video', aid, page: readPage(url.searchParams.get('p')) }
    }
  }
  const cvMatch = path.match(/\/read\/cv(\d+)/i)
  if (cvMatch !== null) {
    const id = numberOrUndefined(cvMatch[1] ?? '')
    if (id !== undefined) {
      return { kind: 'article', id }
    }
  }
  return null
}

/** 拼接带查询参数的地址 */
function urlWithParams(
  base: string,
  params: Record<string, string | number>
): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** 清晰度展示名 */
function qualityLabel(id: number | undefined): string {
  if (id === undefined) {
    return '原始画质'
  }
  return QUALITY_LABELS[id] ?? `清晰度 ${id}`
}

/** 按地址后缀判断容器格式 */
function containerOfUrl(raw: string): VideoContainer {
  let path = raw.toLowerCase()
  try {
    path = new URL(raw).pathname.toLowerCase()
  } catch {
    // 保持原字符串判断
  }
  if (path.endsWith('.flv')) {
    return 'flv'
  }
  if (path.endsWith('.m4s')) {
    return 'm4s'
  }
  if (path.endsWith('.mp4')) {
    return 'mp4'
  }
  return 'unknown'
}

/** 读取统计字段，全部缺失时返回 undefined */
function readStats(value: unknown): VideoStats | undefined {
  const record = asRecord(value)
  if (record === null) {
    return undefined
  }
  const stats: VideoStats = {}
  const likes = numberOrUndefined(record.like)
  const comments = numberOrUndefined(record.reply)
  const collects = numberOrUndefined(record.favorite)
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

/** 封面地址补全为 HTTPS */
function makeCover(raw: unknown): VideoImage | undefined {
  const url = absoluteUrl(SITE_ORIGIN, raw)
  return url === undefined ? undefined : { url }
}

/** 从 DASH 音轨中选择带宽最高的地址；同带宽优先 30280 */
function pickAudioUrl(
  audios: Array<Record<string, unknown>>
): string | undefined {
  let best:
    { url: string; bandwidth: number; id: number | undefined } | undefined
  for (const audio of audios) {
    const url = pickPlayableUrl(audio)
    if (url === '') {
      continue
    }
    const bandwidth = numberOrUndefined(audio.bandwidth) ?? 0
    const id = numberOrUndefined(audio.id)
    const isPreferred30280 = id === 30280
    if (
      best === undefined ||
      bandwidth > best.bandwidth ||
      (bandwidth === best.bandwidth && isPreferred30280 && best.id !== 30280)
    ) {
      best = { url, bandwidth, id }
    }
  }
  return best?.url
}

/** 收集候选播放地址（含备份），优先返回白名单内的 CDN 地址，避免 PCDN 动态域名 */
function pickPlayableUrl(source: Record<string, unknown>): string {
  const raw: unknown[] = [source.baseUrl, source.base_url, source.url]
  for (const key of ['backupUrl', 'backup_url', 'backupUrls', 'backup_urls']) {
    const value = source[key]
    if (Array.isArray(value)) {
      raw.push(...value)
    } else {
      raw.push(value)
    }
  }
  const urls: string[] = []
  for (const value of raw) {
    const resolved = absoluteUrl(null, value)
    if (resolved !== undefined) {
      urls.push(resolved)
    }
  }
  const allowed = urls.find((url) => isAllowedMediaUrl('bilibili', url))
  return allowed ?? urls[0] ?? ''
}

/** 生成 DASH 清晰度档位 */
function buildDashVariants(dash: Record<string, unknown>): VideoVariant[] {
  const audios = asArray(dash.audio)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
  const audioUrl = pickAudioUrl(audios)
  const variants: VideoVariant[] = []
  const videos = asArray(dash.video)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
  for (const [index, video] of videos.entries()) {
    const url = pickPlayableUrl(video)
    if (url === '') {
      continue
    }
    const qualityId = numberOrUndefined(video.id)
    const variant: VideoVariant = {
      id: `dash-${qualityId ?? 0}-${index}`,
      label: qualityLabel(qualityId),
      qualityRank: qualityId ?? 0,
      container: 'm4s',
      url
    }
    const width = numberOrUndefined(video.width)
    const height = numberOrUndefined(video.height)
    if (width !== undefined) {
      variant.width = width
    }
    if (height !== undefined) {
      variant.height = height
    }
    if (audioUrl !== undefined) {
      variant.audioUrl = audioUrl
    }
    variants.push(variant)
  }
  return variants
}

/** 生成合流（durl）清晰度档位 */
function buildDurlVariants(data: Record<string, unknown>): VideoVariant[] {
  const first = asRecord(asArray(data.durl)[0])
  if (first === null) {
    return []
  }
  const url = pickPlayableUrl(first)
  if (url === '') {
    return []
  }
  const qualityId = numberOrUndefined(data.quality)
  const size = numberOrUndefined(first.size)
  const variant: VideoVariant = {
    id: `durl-${qualityId ?? 0}`,
    label: `${qualityLabel(qualityId)}合流`,
    qualityRank: qualityId ?? 0,
    container: containerOfUrl(url),
    url
  }
  if (size !== undefined) {
    variant.size = size
  }
  return [variant]
}

/** 解析普通视频 */
async function parseVideo(
  target: VideoTarget,
  input: { sourceUrl: string; resolvedUrl: string },
  ctx: ProviderContext
): Promise<ProviderParseResult> {
  const viewParams: Record<string, string | number> =
    target.bvid !== undefined && target.bvid !== ''
      ? { bvid: target.bvid }
      : { aid: target.aid ?? '' }
  const viewResponse = await ctx.client.request({
    url: urlWithParams(VIEW_URL, viewParams),
    platform: 'bilibili'
  })
  assertOkResponse(viewResponse)
  const viewPayload = await readJsonPayload(viewResponse)
  const viewRoot = asRecord(viewPayload)
  const viewCode =
    viewRoot === null ? undefined : numberOrUndefined(viewRoot.code)
  if (viewRoot === null || viewCode === undefined) {
    return { ok: false, reason: 'api-changed', detail: 'view 响应结构异常' }
  }
  if (viewCode !== 0) {
    return {
      ok: false,
      reason: EXPIRED_CODES.includes(viewCode) ? 'expired' : 'api-changed',
      detail: `view code=${viewCode}`
    }
  }
  const data = asRecord(viewRoot.data)
  if (data === null) {
    return { ok: false, reason: 'api-changed', detail: 'view 数据缺失' }
  }

  const bvid = pickFirstString(data.bvid, target.bvid)
  const aid = numberOrUndefined(data.aid) ?? target.aid
  const viewTitle = pickFirstString(data.title)
  if (viewTitle === '') {
    return { ok: false, reason: 'api-changed', detail: 'view 标题缺失' }
  }
  const pages = asArray(data.pages)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
  const selected =
    pages.find((page) => numberOrUndefined(page.page) === target.page) ??
    pages[target.page - 1] ??
    pages[0]
  const cid =
    (selected === undefined ? undefined : numberOrUndefined(selected.cid)) ??
    numberOrUndefined(data.cid)
  if (cid === undefined) {
    return { ok: false, reason: 'api-changed', detail: 'view cid 缺失' }
  }

  const part = selected === undefined ? '' : pickFirstString(selected.part)
  const title =
    pages.length > 1 && part !== '' && !viewTitle.includes(part)
      ? `${viewTitle} - ${part}`
      : viewTitle

  const playParams: Record<string, string | number> = {
    cid,
    qn: 127,
    fnval: 4048,
    fourk: 1
  }
  if (bvid !== '') {
    playParams.bvid = bvid
  } else {
    playParams.avid = aid ?? ''
  }
  const signed =
    ctx.signer !== undefined && ctx.signer.platform === 'bilibili'
      ? await ctx.signer.sign(playParams)
      : playParams
  const playResponse = await ctx.client.request({
    url: urlWithParams(PLAYURL_URL, signed),
    platform: 'bilibili'
  })
  assertOkResponse(playResponse)
  const playPayload = await readJsonPayload(playResponse)
  const playRoot = asRecord(playPayload)
  const playCode =
    playRoot === null ? undefined : numberOrUndefined(playRoot.code)
  if (playRoot === null || playCode === undefined) {
    return { ok: false, reason: 'api-changed', detail: 'playurl 响应结构异常' }
  }
  if (playCode !== 0) {
    return {
      ok: false,
      reason: EXPIRED_CODES.includes(playCode) ? 'expired' : 'api-changed',
      detail: `playurl code=${playCode}`
    }
  }
  const playData = asRecord(playRoot.data)
  if (playData === null) {
    return { ok: false, reason: 'api-changed', detail: 'playurl 数据缺失' }
  }

  const dash = asRecord(playData.dash)
  const variants = dash === null ? [] : buildDashVariants(dash)
  const merged = variants.length > 0 ? variants : buildDurlVariants(playData)
  if (merged.length === 0) {
    return {
      ok: false,
      reason: 'api-changed',
      detail: 'playurl 未返回可用清晰度'
    }
  }
  merged.sort((left, right) => right.qualityRank - left.qualityRank)

  const nativeId = bvid !== '' ? bvid : aid === undefined ? '' : `av${aid}`
  if (nativeId === '') {
    return { ok: false, reason: 'api-changed', detail: 'view 缺少视频标识' }
  }
  const owner = asRecord(data.owner)
  const author = owner === null ? '' : pickFirstString(owner.name)
  const cover = makeCover(data.pic)
  const description = pickFirstString(data.desc)
  const durationSec = numberOrUndefined(data.duration)
  const stats = readStats(data.stat)
  const pageQuery = target.page > 1 ? `?p=${target.page}` : ''

  const resource: VideoResource = {
    id: `bilibili:${nativeId}`,
    platform: 'bilibili',
    nativeId,
    kind: 'video',
    title,
    author,
    sourceUrl: input.sourceUrl,
    resolvedUrl: input.resolvedUrl,
    shareUrl: `${SITE_ORIGIN}/video/${nativeId}${pageQuery}`,
    variants: merged,
    images: []
  }
  if (cover !== undefined) {
    resource.cover = cover
  }
  if (description !== '') {
    resource.description = description
  }
  if (durationSec !== undefined && durationSec > 0) {
    resource.durationSec = durationSec
  }
  const publishedAt = toIsoTime(data.pubdate)
  if (publishedAt !== undefined) {
    resource.publishedAt = publishedAt
  }
  if (stats !== undefined) {
    resource.stats = stats
  }
  return { ok: true, resource }
}

/** 读取专栏图片列表 */
function articleImages(data: Record<string, unknown>): VideoImage[] {
  const raw =
    asArray(data.image_urls).length > 0 ? data.image_urls : data.images
  const images: VideoImage[] = []
  for (const item of asArray(raw)) {
    const record = asRecord(item)
    const value =
      typeof item === 'string'
        ? item
        : pickFirstString(record?.url, record?.image_url, record?.img_url)
    const url = absoluteUrl(SITE_ORIGIN, value)
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

/** 解析专栏图文 */
async function parseArticle(
  target: ArticleTarget,
  input: { sourceUrl: string; resolvedUrl: string },
  ctx: ProviderContext
): Promise<ProviderParseResult> {
  const response = await ctx.client.request({
    url: urlWithParams(ARTICLE_URL, { id: target.id }),
    platform: 'bilibili'
  })
  assertOkResponse(response)
  const payload = await readJsonPayload(response)
  const root = asRecord(payload)
  const code = root === null ? undefined : numberOrUndefined(root.code)
  if (root === null || code === undefined) {
    return { ok: false, reason: 'api-changed', detail: 'article 响应结构异常' }
  }
  if (code !== 0) {
    return {
      ok: false,
      reason: EXPIRED_CODES.includes(code) ? 'expired' : 'api-changed',
      detail: `article code=${code}`
    }
  }
  const data = asRecord(root.data)
  if (data === null) {
    return { ok: false, reason: 'api-changed', detail: 'article 数据缺失' }
  }
  const title = pickFirstString(data.title)
  if (title === '') {
    return { ok: false, reason: 'api-changed', detail: 'article 标题缺失' }
  }
  const nativeId = `cv${target.id}`
  const images = articleImages(data)
  const cover = makeCover(data.banner_url)
  const description = stripHtml(pickFirstString(data.content))
  const stats = readStats(data.stats)
  const resource: VideoResource = {
    id: `bilibili:${nativeId}`,
    platform: 'bilibili',
    nativeId,
    kind: 'note',
    title,
    author: pickFirstString(data.author_name),
    sourceUrl: input.sourceUrl,
    resolvedUrl: input.resolvedUrl,
    shareUrl: `${SITE_ORIGIN}/read/${nativeId}`,
    variants: [],
    images
  }
  if (cover !== undefined) {
    resource.cover = cover
  }
  if (description !== '') {
    resource.description = description
  }
  const publishedAt = toIsoTime(data.publish_time)
  if (publishedAt !== undefined) {
    resource.publishedAt = publishedAt
  }
  if (stats !== undefined) {
    resource.stats = stats
  }
  return { ok: true, resource }
}

/** 哔哩哔哩适配器 */
export const bilibiliProvider: VideoProvider = {
  platform: 'bilibili',
  async parse(input, ctx) {
    const target =
      parseTarget(input.resolvedUrl) ?? parseTarget(input.sourceUrl)
    if (target === null) {
      return {
        ok: false,
        reason: 'api-changed',
        detail: '无法识别 B 站资源标识'
      }
    }
    return target.kind === 'article'
      ? parseArticle(target, input, ctx)
      : parseVideo(target, input, ctx)
  }
}
