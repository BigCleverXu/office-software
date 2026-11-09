// 小红书适配器：__INITIAL_STATE__ 解析，视频流与 imageList 提取
// 仅主进程使用；请求保留 xsec_token / xsec_source 公共分享参数
import type {
  VideoContainer,
  VideoImage,
  VideoResource,
  VideoVariant
} from '../../../shared/video'
import {
  absoluteUrl,
  asArray,
  asRecord,
  numberOrUndefined,
  pickFirstString,
  readEmbeddedJsonText,
  toIsoTime
} from './embedded'
import {
  readTextPayload,
  type ProviderContext,
  type VideoProvider
} from './types'
import { VideoHttpError } from '../http-client'

/** 小红书站点根地址 */
const SITE_ORIGIN = 'https://www.xiaohongshu.com'

/** 移动端 UA：匿名访问笔记页时服务端会返回带 __INITIAL_STATE__ 的移动版页面 */
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

/** 页面明确提示笔记不可见的文案 */
const NOT_FOUND_TEXTS: readonly string[] = [
  '当前笔记暂时无法浏览',
  '笔记不存在',
  '你访问的页面不见了',
  '页面不见了'
]

/** 视频流编码顺序 */
const CODECS = ['h264', 'h265', 'av1'] as const

/** 小红书目标 */
interface XiaohongshuTarget {
  id: string
  xsecToken: string
  xsecSource: string
}

/** 从单个地址提取笔记 ID 与安全参数 */
function extractFromUrl(raw: string): XiaohongshuTarget | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const explore = url.pathname.match(/\/explore\/([0-9a-fA-F]+)/)
  const discovery = url.pathname.match(/\/discovery\/item\/([0-9a-fA-F]+)/)
  const id = explore?.[1] ?? discovery?.[1]
  if (id === undefined || id === '') {
    return null
  }
  return {
    id,
    xsecToken: (url.searchParams.get('xsec_token') ?? '').trim(),
    xsecSource: (url.searchParams.get('xsec_source') ?? '').trim()
  }
}

/** 合并最终地址与原始地址中的安全参数 */
function extractTarget(input: {
  sourceUrl: string
  resolvedUrl: string
}): XiaohongshuTarget | null {
  const resolved = extractFromUrl(input.resolvedUrl)
  const source = extractFromUrl(input.sourceUrl)
  const base = resolved ?? source
  if (base === null) {
    return null
  }
  return {
    id: base.id,
    xsecToken: base.xsecToken || source?.xsecToken || '',
    xsecSource: base.xsecSource || source?.xsecSource || ''
  }
}

/** 把 JSON 文本中字符串之外的裸 undefined 替换为 null */
function replaceBareUndefined(text: string): string {
  let result = ''
  let inString = false
  let quote = ''
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      inString = true
      quote = char
      result += char
      continue
    }
    if (text.startsWith('undefined', index)) {
      const previous = index === 0 ? '' : (text[index - 1] ?? '')
      const next = text[index + 'undefined'.length] ?? ''
      const boundaryBefore = !/[A-Za-z0-9_$]/.test(previous)
      const boundaryAfter = !/[A-Za-z0-9_$]/.test(next)
      if (boundaryBefore && boundaryAfter) {
        result += 'null'
        index += 'undefined'.length - 1
        continue
      }
    }
    result += char
  }
  return result
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

/** 依据 format 字段判断容器格式 */
function containerOfFormat(format: string): VideoContainer {
  const normalized = format.toLowerCase()
  if (normalized.includes('flv')) {
    return 'flv'
  }
  if (normalized.includes('m4s')) {
    return 'm4s'
  }
  return 'mp4'
}

/** 判断对象是否像一条笔记 */
function looksLikeNote(record: Record<string, unknown>): boolean {
  if (pickFirstString(record.noteId, record.note_id) === '') {
    return false
  }
  return (
    typeof record.type === 'string' ||
    asArray(record.imageList ?? record.image_list).length > 0 ||
    asRecord(record.video) !== null
  )
}

/** 判断状态字段是否表示错误 */
function isErrorStatus(value: unknown): boolean {
  if (value === 'error' || value === 'failed') {
    return true
  }
  return typeof value === 'number' && value < 0
}

/** 递归查找带 noteId 的笔记对象 */
function findNoteObject(
  value: unknown,
  id: string
): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNoteObject(item, id)
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
  const noteId = pickFirstString(record.noteId, record.note_id)
  if (noteId === id && looksLikeNote(record)) {
    return record
  }
  for (const child of Object.values(record)) {
    const found = findNoteObject(child, id)
    if (found !== null) {
      return found
    }
  }
  return null
}

/** 按约定顺序查找笔记，并标记明确的失效状态 */
function findNote(
  state: unknown,
  id: string
): { note: Record<string, unknown> | null; notFound: boolean } {
  const root = asRecord(state)
  const noteState = asRecord(root?.note)
  let notFound = noteState?.notFound === true
  const detailMap = asRecord(noteState?.noteDetailMap)
  const entry = asRecord(detailMap?.[id])
  if (entry !== null) {
    if (entry.notFound === true || isErrorStatus(entry.status)) {
      notFound = true
    }
    const note = asRecord(entry.note)
    if (note !== null) {
      if (isErrorStatus(note.status)) {
        notFound = true
      }
      return { note, notFound }
    }
    if (looksLikeNote(entry)) {
      return { note: entry, notFound }
    }
  }
  const notes = asRecord(noteState?.notes)
  const direct = asRecord(notes?.[id])
  if (direct !== null && looksLikeNote(direct)) {
    return { note: direct, notFound }
  }
  const found = findNoteObject(state, id)
  return { note: found, notFound }
}

/** 从状态解析笔记：先按约定结构查找，状态本身是笔记时直接使用 */
function resolveNote(
  state: unknown,
  id: string
): { note: Record<string, unknown> | null; notFound: boolean } {
  const lookup = findNote(state, id)
  if (lookup.note !== null) {
    return lookup
  }
  const direct = asRecord(state)
  if (direct !== null && looksLikeNote(direct)) {
    return { note: direct, notFound: lookup.notFound }
  }
  return lookup
}

/** 通过浏览器渲染读取笔记状态；失败或未注入桥接时返回空结果 */
async function loadNoteByBrowser(
  pageUrl: string,
  target: XiaohongshuTarget,
  browser: ProviderContext['xiaohongshuBrowser']
): Promise<{ note: Record<string, unknown> | null; notFound: boolean }> {
  if (browser === undefined) {
    return { note: null, notFound: false }
  }
  try {
    const state = await browser.loadNoteState({ url: pageUrl })
    if (state === null) {
      return { note: null, notFound: false }
    }
    return resolveNote(state, target.id)
  } catch {
    return { note: null, notFound: false }
  }
}

/** 读取图文图片列表 */
function buildImages(note: Record<string, unknown>): VideoImage[] {
  const images: VideoImage[] = []
  for (const item of asArray(note.imageList ?? note.image_list)) {
    const record = asRecord(item)
    if (record === null) {
      continue
    }
    const infoList = asArray(record.infoList ?? record.info_list)
    const infoUrl = infoList
      .map((value) => asRecord(value))
      .map((value) => (value === null ? '' : pickFirstString(value.url)))
      .find((value) => value !== '')
    const url = absoluteUrl(
      SITE_ORIGIN,
      pickFirstString(record.urlDefault, record.urlPre, record.url) || infoUrl
    )
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

/** 读取视频流地址 */
function streamUrl(entry: Record<string, unknown>): string {
  const primary = pickFirstString(entry.masterUrl, entry.master_url, entry.url)
  if (primary !== '') {
    return primary
  }
  const backups = asArray(entry.backupUrls ?? entry.backup_urls)
  return (
    backups.find(
      (value): value is string =>
        typeof value === 'string' && value.trim() !== ''
    ) ?? ''
  )
}

/** 从 video.media.stream 生成清晰度档位 */
function buildVariants(note: Record<string, unknown>): VideoVariant[] {
  const video = asRecord(note.video)
  const media = asRecord(video?.media)
  const stream = asRecord(media?.stream)
  if (stream === null) {
    return []
  }
  const variants: VideoVariant[] = []
  for (const codec of CODECS) {
    for (const item of asArray(stream[codec])) {
      const entry = asRecord(item)
      if (entry === null) {
        continue
      }
      const url = absoluteUrl(SITE_ORIGIN, streamUrl(entry))
      if (url === undefined) {
        continue
      }
      const width = numberOrUndefined(entry.width)
      const height = numberOrUndefined(entry.height)
      const size = numberOrUndefined(entry.size)
      const format = pickFirstString(entry.format)
      const shortSide =
        width !== undefined && height !== undefined
          ? Math.min(width, height)
          : (height ?? width)
      const qualityRank =
        shortSide ?? numberOrUndefined(entry.avgBitrate) ?? size ?? 0
      const variant: VideoVariant = {
        id: `xiaohongshu-${codec}-${variants.length}`,
        label: labelFromDimensions(width, height) || '原始画质',
        qualityRank,
        container: containerOfFormat(format),
        url
      }
      if (width !== undefined) {
        variant.width = width
      }
      if (height !== undefined) {
        variant.height = height
      }
      if (size !== undefined) {
        variant.size = size
      }
      variants.push(variant)
    }
  }
  variants.sort((left, right) => right.qualityRank - left.qualityRank)
  return variants
}

/** 判断页面文本是否明确提示笔记不可见 */
function hasNotFoundText(html: string): boolean {
  return NOT_FOUND_TEXTS.some((text) => html.includes(text))
}

/** 由笔记对象构建统一资源 */
function buildResource(
  note: Record<string, unknown>,
  target: XiaohongshuTarget,
  input: { sourceUrl: string; resolvedUrl: string }
): VideoResource {
  const title = pickFirstString(note.title) || `小红书笔记 ${target.id}`
  const description = pickFirstString(note.desc)
  const authorRecord = asRecord(note.user)
  const images = buildImages(note)
  const variants = buildVariants(note)
  const type = pickFirstString(note.type)
  const isVideo = type === 'video' || (type === '' && variants.length > 0)
  const resource: VideoResource = {
    id: `xiaohongshu:${target.id}`,
    platform: 'xiaohongshu',
    nativeId: target.id,
    kind: isVideo ? 'video' : 'note',
    title,
    author:
      authorRecord === null
        ? ''
        : pickFirstString(authorRecord.nickname, authorRecord.nickName),
    sourceUrl: input.sourceUrl,
    resolvedUrl: input.resolvedUrl,
    shareUrl: buildShareUrl(target),
    variants: isVideo ? variants : [],
    images: isVideo ? [] : images
  }
  const coverImage = images[0]
  if (coverImage !== undefined) {
    resource.cover = { ...coverImage }
  }
  if (description !== '') {
    resource.description = description
  }
  const publishedAt = toIsoTime(note.time)
  if (publishedAt !== undefined) {
    resource.publishedAt = publishedAt
  }
  return resource
}

/** 生成带安全参数的资源页地址 */
function buildShareUrl(target: XiaohongshuTarget): string {
  const url = new URL(`${SITE_ORIGIN}/explore/${target.id}`)
  if (target.xsecToken !== '') {
    url.searchParams.set('xsec_token', target.xsecToken)
  }
  if (target.xsecSource !== '') {
    url.searchParams.set('xsec_source', target.xsecSource)
  }
  return url.toString()
}

/**
 * 浏览器降级优先使用原始分享地址：`/discovery/item/...` 自带的分享签名
 * 可以让页面匿名渲染，改写成合成 `/explore/...` 反而更容易被登录墙拦截。
 */
function browserUrlOf(
  input: { sourceUrl: string; resolvedUrl: string },
  fallback: URL
): string {
  for (const raw of [input.resolvedUrl, input.sourceUrl]) {
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:') {
        continue
      }
      const host = url.hostname.toLowerCase()
      if (host !== 'xiaohongshu.com' && !host.endsWith('.xiaohongshu.com')) {
        continue
      }
      if (!/\/explore\/|\/discovery\/item\//.test(url.pathname)) {
        continue
      }
      if ((url.searchParams.get('xsec_token') ?? '').trim() === '') {
        continue
      }
      return url.toString()
    } catch {
      // 忽略非法地址，继续尝试下一个
    }
  }
  return fallback.toString()
}

/** 小红书适配器 */
export const xiaohongshuProvider: VideoProvider = {
  platform: 'xiaohongshu',
  async parse(input, ctx) {
    const target = extractTarget(input)
    if (target === null) {
      return {
        ok: false,
        reason: 'api-changed',
        detail: '无法识别小红书笔记标识'
      }
    }
    const pageUrl = new URL(`${SITE_ORIGIN}/explore/${target.id}`)
    if (target.xsecToken !== '') {
      pageUrl.searchParams.set('xsec_token', target.xsecToken)
    }
    if (target.xsecSource !== '') {
      pageUrl.searchParams.set('xsec_source', target.xsecSource)
    }

    // 匿名 HTTP 请求可能被 302 到登录页或触发风控，此时不直接失败，
    // 记录空 HTML 后继续尝试浏览器降级（真实浏览器可拿到 SSR 状态）
    let html = ''
    try {
      const response = await ctx.client.request({
        // 原始分享地址（discovery/item 或 explore 带 xsec_token）配合移动端 UA
        // 才能匿名拿到带 __INITIAL_STATE__ 的页面；桌面 UA 常被 302 到登录页
        url: browserUrlOf(input, pageUrl),
        platform: 'xiaohongshu',
        referer: `${SITE_ORIGIN}/`,
        headers: { 'User-Agent': MOBILE_USER_AGENT }
      })
      if (response.status === 404) {
        return { ok: false, reason: 'expired', detail: '笔记页不存在' }
      }
      if (response.ok) {
        html = (await readTextPayload(response)) ?? ''
      }
    } catch (error) {
      if (error instanceof VideoHttpError && error.status === 404) {
        return { ok: false, reason: 'expired', detail: '笔记页不存在' }
      }
      // 其余 HTTP / 网络错误交给浏览器降级判定
    }

    // HTTP 链路：匿名请求可能被重定向到登录页，读不到笔记时继续尝试浏览器降级
    let note: Record<string, unknown> | null = null
    let notFound = hasNotFoundText(html)
    const rawText = readEmbeddedJsonText(html, 'window.__INITIAL_STATE__')
    if (rawText !== null) {
      let state: unknown = null
      try {
        state = JSON.parse(replaceBareUndefined(rawText))
      } catch {
        state = null
      }
      if (state !== null) {
        const lookup = resolveNote(state, target.id)
        note = lookup.note
        notFound = notFound || lookup.notFound
      }
    }

    // 浏览器降级：真实浏览器可渲染页面并带回 SSR 状态
    if (note === null && ctx.xiaohongshuBrowser !== undefined) {
      const fallback = await loadNoteByBrowser(
        browserUrlOf(input, pageUrl),
        target,
        ctx.xiaohongshuBrowser
      )
      note = fallback.note
      notFound = notFound || fallback.notFound
    }

    if (note === null) {
      if (notFound) {
        return { ok: false, reason: 'expired', detail: '未找到笔记数据' }
      }
      return {
        ok: false,
        reason: 'api-changed',
        detail: '小红书页面受限，未能获取笔记数据'
      }
    }
    return { ok: true, resource: buildResource(note, target, input) }
  }
}
