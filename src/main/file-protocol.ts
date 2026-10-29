// 只读本地文件协议 app-file:// 的实现细节：
// URL 编解码、MIME 判定、Range 解析与流式响应构造
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { fileExtensionOf } from '../shared/files'

/** 协议主机名：固定为 local，避免空 host 带来的路径歧义 */
const APP_FILE_HOST = 'local'

/** 协议前缀 */
const APP_FILE_PREFIX = `app-file://${APP_FILE_HOST}/`

/** 图片 MIME */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

/** 音频 MIME */
const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  wma: 'audio/x-ms-wma',
  opus: 'audio/ogg',
  mid: 'audio/midi',
  midi: 'audio/midi'
}

/** 视频 MIME */
const VIDEO_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  '3gp': 'video/3gpp'
}

/** 文本类扩展名统一按 utf-8 纯文本返回 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt',
  'md',
  'csv',
  'log',
  'ini',
  'conf',
  'env',
  'htm',
  'html',
  'xml',
  'json',
  'yml',
  'yaml'
])

/** 文本 MIME */
const TEXT_TYPE = 'text/plain; charset=utf-8'

/** 未知类型 MIME */
const BINARY_TYPE = 'application/octet-stream'

/** 只接受纯数字的 Range 片段 */
const DIGITS_PATTERN = /^\d+$/

/** 单段 Range 区间（闭区间） */
export interface ByteRange {
  start: number
  end: number
}

/**
 * 绝对路径转只读协议 URL。
 * 整段路径做百分号编码，规避空 host、#、?、空格、中文与 Windows 盘符问题。
 * 例：/home/a.png → app-file://local/%2Fhome%2Fa.png
 */
export function toAppFileUrl(absolutePath: string): string {
  return APP_FILE_PREFIX + encodeURIComponent(absolutePath)
}

/**
 * 从协议 URL 还原绝对路径，非法输入返回 null。
 * 不做 isAbsolute 校验：越界判定由调用方按搜索目录完成。
 */
export function parseAppFilePath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'app-file:' || parsed.host !== APP_FILE_HOST) {
    return null
  }
  // pathname 以 / 开头，去掉后再解码整段路径
  const encoded = parsed.pathname.replace(/^\//, '')
  if (encoded === '') {
    return null
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    return null
  }
  return decoded === '' ? null : decoded
}

/** 按扩展名给出响应 MIME，未知扩展名回退二进制 */
export function contentTypeOf(filePath: string): string {
  const extension = fileExtensionOf(filePath)
  const known =
    IMAGE_TYPES[extension] ?? AUDIO_TYPES[extension] ?? VIDEO_TYPES[extension]
  if (known !== undefined) {
    return known
  }
  return TEXT_EXTENSIONS.has(extension) ? TEXT_TYPE : BINARY_TYPE
}

/**
 * 解析单段 Range 请求头，非法或不支持的形式返回 null（按整文件处理）。
 * 支持 bytes=start-end / bytes=start- / bytes=-suffix，end 越界时夹取。
 */
export function parseRange(
  rangeHeader: string | null,
  size: number
): ByteRange | null {
  if (rangeHeader === null || size <= 0) {
    return null
  }
  const header = rangeHeader.trim()
  // 多段 Range 不处理，回退整文件
  if (header.includes(',') || !header.startsWith('bytes=')) {
    return null
  }
  const spec = header.slice('bytes='.length)
  const dash = spec.indexOf('-')
  if (dash < 0) {
    return null
  }
  const startText = spec.slice(0, dash).trim()
  const endText = spec.slice(dash + 1).trim()
  if (startText === '') {
    // bytes=-suffix：取末尾固定长度，suffix 大于文件时取整文件
    if (!DIGITS_PATTERN.test(endText)) {
      return null
    }
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return null
    }
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  if (!DIGITS_PATTERN.test(startText)) {
    return null
  }
  const start = Number(startText)
  if (!Number.isSafeInteger(start) || start >= size) {
    return null
  }
  if (endText === '') {
    return { start, end: size - 1 }
  }
  if (!DIGITS_PATTERN.test(endText)) {
    return null
  }
  const end = Number(endText)
  if (!Number.isSafeInteger(end) || end < start) {
    return null
  }
  return { start, end: Math.min(end, size - 1) }
}

/** 把文件字节流包成 Web 流，避免整文件读入内存 */
function streamBody(filePath: string, range?: ByteRange): BodyInit {
  const options =
    range === undefined ? undefined : { start: range.start, end: range.end }
  const stream = createReadStream(filePath, options)
  return Readable.toWeb(stream) as unknown as BodyInit
}

/**
 * 读取本地文件生成 HTTP 响应：支持 Range（206）与整文件（200）。
 * stat 失败或非普通文件返回 404，其余异常收敛为 500，不向协议层抛出。
 */
export async function createFileResponse(
  filePath: string,
  rangeHeader: string | null
): Promise<Response> {
  let size: number
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) {
      return new Response('Not Found', { status: 404 })
    }
    size = stats.size
  } catch {
    return new Response('Not Found', { status: 404 })
  }
  const headers: Record<string, string> = {
    'Content-Type': contentTypeOf(filePath),
    'Accept-Ranges': 'bytes'
  }
  const range = parseRange(rangeHeader, size)
  try {
    if (range !== null) {
      headers['Content-Length'] = String(range.end - range.start + 1)
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
      return new Response(streamBody(filePath, range), {
        status: 206,
        headers
      })
    }
    headers['Content-Length'] = String(size)
    return new Response(streamBody(filePath), { status: 200, headers })
  } catch {
    return new Response('Internal Error', { status: 500 })
  }
}
