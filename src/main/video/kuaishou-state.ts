// 快手移动页 window.INIT_STATE 解码：ASCII 位移还原与作品实体定位
// 纯函数，无 IO；任何异常都回退原值或 null，不抛出
import { asRecord } from './providers/embedded'

/** 已知字段字典：按对象键名与该字典的匹配度选择位移方向 */
const KNOWN_FIELDS: readonly string[] = [
  'result',
  'photoId',
  'caption',
  'manifest',
  'photoUrl',
  'photoH265Url',
  'atlas',
  'userName',
  'coverUrl',
  'coverUrls',
  'duration',
  'width',
  'height',
  'mainMvUrls',
  'ext_params',
  'photoType',
  'type',
  'userId',
  'likeCount',
  'viewCount'
]

/** 字典集合，避免逐项比较 */
const KNOWN_FIELD_SET = new Set(KNOWN_FIELDS)

/** 非零位移候选：0 先参与评分，只有匹配度更高才切换 */
const SHIFT_CANDIDATES: readonly number[] = [-1, 1]

/** 递归深度上限，防止异常或循环结构导致无限递归 */
const MAX_DEPTH = 8

/** 可位移的 ASCII 区间：控制字符与多字节字符保持原样 */
const ASCII_MIN = 1
const ASCII_MAX = 126
const ASCII_SPAN = ASCII_MAX - ASCII_MIN + 1

/** 对可打印 ASCII 做位移，越界时在区间内环绕 */
function shiftAscii(text: string, delta: number): string {
  if (delta === 0) {
    return text
  }
  let result = ''
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < ASCII_MIN || code > ASCII_MAX) {
      result += text[index] ?? ''
      continue
    }
    const shifted = code + delta
    const normalized =
      shifted < ASCII_MIN
        ? shifted + ASCII_SPAN
        : shifted > ASCII_MAX
          ? shifted - ASCII_SPAN
          : shifted
    result += String.fromCharCode(normalized)
  }
  return result
}

/** 按位移还原键名后命中的字典条目数 */
function scoreShift(record: Record<string, unknown>, delta: number): number {
  let score = 0
  for (const key of Object.keys(record)) {
    if (KNOWN_FIELD_SET.has(shiftAscii(key, delta))) {
      score += 1
    }
  }
  return score
}

/** 为对象选择位移：优先保持 0，命中字典更多时才取 -1 / +1 */
function pickShift(record: Record<string, unknown>): number {
  let best = 0
  let bestScore = scoreShift(record, 0)
  for (const delta of SHIFT_CANDIDATES) {
    const score = scoreShift(record, delta)
    if (score > bestScore) {
      best = delta
      bestScore = score
    }
  }
  return best
}

/** 解码字符串：先位移，若还原后是 JSON 对象 / 数组则继续递归 */
function decodeString(text: string, delta: number, depth: number): unknown {
  const decoded = shiftAscii(text, delta)
  const trimmed = decoded.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return decoded
  }
  try {
    const parsed: unknown = JSON.parse(decoded)
    if (parsed !== null && typeof parsed === 'object') {
      return decodeValue(parsed, 0, depth + 1)
    }
  } catch {
    // 不是合法 JSON，按普通文本处理
  }
  return decoded
}

/** 递归解码任意状态值 */
function decodeValue(value: unknown, delta: number, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return value
  }
  if (typeof value === 'string') {
    return decodeString(value, delta, depth)
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeValue(item, delta, depth + 1))
  }
  const record = asRecord(value)
  if (record === null) {
    return value
  }
  const objectDelta = pickShift(record)
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    result[shiftAscii(key, objectDelta)] = decodeValue(
      item,
      objectDelta,
      depth + 1
    )
  }
  return result
}

/** 判断值是否为有内容的字段 */
function hasMarker(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (value === null || value === undefined) {
    return false
  }
  if (typeof value === 'string') {
    return value.trim() !== ''
  }
  return true
}

/** 递归查找作品实体 */
function searchPhoto(
  value: unknown,
  id: string,
  depth: number
): Record<string, unknown> | null {
  if (depth > MAX_DEPTH) {
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchPhoto(item, id, depth + 1)
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
  const photoId =
    typeof record.photoId === 'string' ? record.photoId.trim() : ''
  if (photoId === id) {
    return record
  }
  const markers =
    (hasMarker(record, 'photoId') ? 1 : 0) +
    (hasMarker(record, 'caption') ? 1 : 0) +
    (hasMarker(record, 'manifest') ? 1 : 0) +
    (hasMarker(record, 'atlas') ? 1 : 0)
  if (markers >= 2) {
    return record
  }
  for (const child of Object.values(record)) {
    const found = searchPhoto(child, id, depth + 1)
    if (found !== null) {
      return found
    }
  }
  return null
}

/**
 * 解码快手 INIT_STATE 结构：对象层按键名匹配度自动选择位移（0 / -1 / +1），
 * 字符串先位移再尝试 JSON 解析并递归；数组逐项处理。深度超限或异常时回退原值。
 */
export function decodeKuaishouState(value: unknown): unknown {
  try {
    return decodeValue(value, 0, 0)
  } catch {
    return value
  }
}

/**
 * 在已解码状态中查找作品实体：
 * 满足 photoId 与 id 一致，或 photoId / caption / manifest / atlas 至少两项有值。
 * 找不到返回 null。
 */
export function findKuaishouPhoto(
  state: unknown,
  id: string
): Record<string, unknown> | null {
  try {
    return searchPhoto(state, id, 0)
  } catch {
    return null
  }
}

/**
 * 解析页面中的 INIT_STATE 文本并解码；文本非法或 JSON 解析失败返回 null。
 */
export function decodeKuaishouInitState(jsonText: string): unknown | null {
  if (typeof jsonText !== 'string' || jsonText.trim() === '') {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(jsonText)
    return decodeKuaishouState(parsed)
  } catch {
    return null
  }
}
