// 短视频平台签名适配：内置 B 站 WBI 签名，其他平台预留实现位
// 仅主进程使用；签名只处理公开接口参数，不涉及登录态窃取
import { createHash } from 'node:crypto'
import type { VideoPlatform } from '../../shared/video'
import { VideoHttpClient, VideoHttpError } from './http-client'

/** B 站 WBI 混合密钥表 */
const MIXIN_KEY_ENC_TAB: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52
]

/** WBI 密钥接口 */
const WBI_NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'

/** WBI 密钥缓存有效期（毫秒） */
const WBI_CACHE_TTL_MS = 10 * 60 * 1000

/** 签名器统一接口 */
export interface PlatformSigner {
  platform: VideoPlatform
  sign: (
    params: Record<string, string | number>,
    context?: { referer?: string }
  ) => Promise<Record<string, string>>
}

/**
 * 计算 WBI 混合密钥：按固定置换表重排后取前 32 位，
 * 返回各字符的字符码（便于调用方拼回字符串）。
 */
export function mixinKey(orig: string): number[] {
  const chars = Array.from(orig)
  const length = Math.min(32, MIXIN_KEY_ENC_TAB.length)
  const codes: number[] = []
  for (let index = 0; index < length; index += 1) {
    const position = MIXIN_KEY_ENC_TAB[index] ?? 0
    const char = chars[position]
    if (typeof char === 'string' && char.length > 0) {
      codes.push(char.charCodeAt(0))
    }
  }
  return codes
}

/** 拼接成可直接参与 md5 的混合密钥字符串 */
function mixinKeyString(orig: string): string {
  return mixinKey(orig)
    .map((code) => String.fromCharCode(code))
    .join('')
}

/**
 * 生成 B 站 WBI 签名参数：合并 wts，按键名字典序拼接 query，
 * 以 md5(query + imgKey + subKey 的混合密钥) 得到 32 位小写 w_rid。
 * 返回结果按键名字典序排列，含 wts 与 w_rid。
 */
export function signWbiParams(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string,
  wts: number
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (key === 'w_rid') {
      continue
    }
    merged[key] = String(value)
  }
  merged.wts = String(wts)
  const query = Object.keys(merged)
    .sort()
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(merged[key] ?? '')}`
    )
    .join('&')
  const mixin = mixinKeyString(`${imgKey}${subKey}`)
  const wRid = createHash('md5').update(`${query}${mixin}`).digest('hex')
  const all: Record<string, string> = { ...merged, w_rid: wRid }
  const signed: Record<string, string> = {}
  for (const key of Object.keys(all).sort()) {
    signed[key] = all[key] ?? ''
  }
  return signed
}

/** WBI 密钥对 */
interface WbiKeys {
  imgKey: string
  subKey: string
}

/** B 站签名器可注入依赖 */
export interface BilibiliWbiSignerOptions {
  http?: VideoHttpClient
  now?: () => number
  /** 密钥缓存有效期（毫秒），默认 10 分钟 */
  ttlMs?: number
}

/** 从普通对象读取子对象，不是对象时返回 null */
function pickRecord(
  value: unknown,
  key: string
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const child = (value as Record<string, unknown>)[key]
  if (child === null || typeof child !== 'object' || Array.isArray(child)) {
    return null
  }
  return child as Record<string, unknown>
}

/** 读取字符串字段并 trim，非字符串返回空字符串 */
function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** 从 wbi_img 的图片地址提取密钥（去目录与扩展名） */
function keyFromUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return ''
  }
  let path = trimmed
  try {
    path = new URL(trimmed).pathname
  } catch {
    // 已是裸密钥时直接按路径处理
  }
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return (dot >= 0 ? base.slice(0, dot) : base).trim()
}

/** 丢弃未读取的响应体，避免连接悬挂 */
async function discardQuietly(response: {
  body: ReadableStream<Uint8Array> | null
}): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // 忽略取消失败
  }
}

/**
 * B 站 WBI 签名器：从 nav 接口提取 imgKey / subKey 并缓存 10 分钟，
 * sign 返回合并 wts、w_rid 的完整参数。
 */
export class BilibiliWbiSigner implements PlatformSigner {
  readonly platform: VideoPlatform = 'bilibili'
  private readonly http: VideoHttpClient
  private readonly now: () => number
  private readonly ttlMs: number
  private cached: { keys: WbiKeys; fetchedAt: number } | null = null
  private pending: Promise<WbiKeys> | null = null

  constructor(options: BilibiliWbiSignerOptions = {}) {
    this.http = options.http ?? new VideoHttpClient()
    this.now = options.now ?? Date.now
    this.ttlMs = Math.max(0, options.ttlMs ?? WBI_CACHE_TTL_MS)
  }

  async sign(
    params: Record<string, string | number>,
    context?: { referer?: string }
  ): Promise<Record<string, string>> {
    const keys = await this.getKeys(context?.referer)
    const wts = Math.floor(this.now() / 1000)
    return signWbiParams(params, keys.imgKey, keys.subKey, wts)
  }

  /** 读取密钥：命中缓存直接返回，并发调用共享同一次请求 */
  private async getKeys(referer?: string): Promise<WbiKeys> {
    const cached = this.cached
    if (cached !== null && this.now() - cached.fetchedAt < this.ttlMs) {
      return cached.keys
    }
    if (this.pending !== null) {
      return this.pending
    }
    const task = this.fetchKeys(referer)
    this.pending = task
    try {
      return await task
    } finally {
      if (this.pending === task) {
        this.pending = null
      }
    }
  }

  /** 请求 nav 接口并解析 wbi_img，缺失密钥时抛错 */
  private async fetchKeys(referer?: string): Promise<WbiKeys> {
    const response = await this.http.request({
      url: WBI_NAV_URL,
      platform: 'bilibili',
      referer
    })
    if (!response.ok) {
      await discardQuietly(response)
      throw new VideoHttpError('http', {
        status: response.status,
        detail: `获取 WBI 密钥失败：HTTP ${response.status}`
      })
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new VideoHttpError('network', {
        detail: 'WBI 密钥响应不是合法 JSON'
      })
    }
    const data = pickRecord(payload, 'data')
    const wbi = data === null ? null : pickRecord(data, 'wbi_img')
    if (wbi === null) {
      throw new VideoHttpError('network', { detail: 'WBI 密钥字段缺失' })
    }
    const imgKey = keyFromUrl(readString(wbi, 'img_url'))
    const subKey = keyFromUrl(readString(wbi, 'sub_url'))
    if (imgKey === '' || subKey === '') {
      throw new VideoHttpError('network', { detail: 'WBI 密钥字段缺失' })
    }
    const keys: WbiKeys = { imgKey, subKey }
    this.cached = { keys, fetchedAt: this.now() }
    return keys
  }
}

/** 已内置的签名器；抖音 / 快手 / 小红书默认走无需签名的分享页链路 */
export const SIGNER_REGISTRY: Partial<Record<VideoPlatform, PlatformSigner>> = {
  bilibili: new BilibiliWbiSigner()
}
