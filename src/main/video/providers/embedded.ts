// 分享页内嵌状态读取与 HTML 清洗：用于平台降级解析
// 仅主进程使用；任何解析失败都返回 null，不抛出异常

/** 常见 HTML 命名实体 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  copy: '©',
  reg: '®'
}

/** 命名或数字实体的匹配模式 */
const ENTITY_PATTERN = /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g

/** 脚本与样式块 */
const SCRIPT_STYLE_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi

/** HTML 注释 */
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g

/** 普通标签 */
const TAG_PATTERN = /<[^>]+>/g

/** 连续空白 */
const WHITESPACE_PATTERN = /\s+/g

/** 含大括号的字符串引号 */
const QUOTE_CHARS = new Set(['"', "'", '`'])

/** 解码常见 HTML 实体；无法识别的实体原样保留 */
export function decodeHtmlEntities(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return ''
  }
  return text.replace(ENTITY_PATTERN, (match: string, body: string) => {
    const code =
      body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : body.startsWith('#')
          ? Number.parseInt(body.slice(1), 10)
          : Number.NaN
    if (body.startsWith('#')) {
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : match
      } catch {
        return match
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/**
 * 清洗 HTML：去掉脚本、样式、注释与标签，解码常见实体并压缩空白。
 * 输入非法时返回空字符串。
 */
export function stripHtml(html: string): string {
  if (typeof html !== 'string' || html.length === 0) {
    return ''
  }
  return decodeHtmlEntities(
    html
      .replace(COMMENT_PATTERN, ' ')
      .replace(SCRIPT_STYLE_PATTERN, ' ')
      .replace(TAG_PATTERN, ' ')
  )
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
}

/**
 * 从赋值语句中定位首个左大括号：跳过分号前的空白与等号。
 * 找不到时返回 -1。
 */
function findAssignmentBrace(html: string, from: number): number {
  let cursor = from
  while (cursor < html.length) {
    const char = html[cursor]
    if (char === undefined) {
      return -1
    }
    if (char === '=') {
      cursor += 1
      break
    }
    if (/\s/.test(char)) {
      cursor += 1
      continue
    }
    return -1
  }
  while (cursor < html.length && /\s/.test(html[cursor] ?? '')) {
    cursor += 1
  }
  return html[cursor] === '{' ? cursor : -1
}

/**
 * 从起始大括号处按配对扫描，正确跳过字符串与转义字符。
 * 括号未闭合时返回 null。
 */
function scanBalancedObject(html: string, start: number): string | null {
  let depth = 0
  let inString = false
  let quote = ''
  let escaped = false
  for (let index = start; index < html.length; index += 1) {
    const char = html[index]
    if (char === undefined) {
      break
    }
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }
    if (QUOTE_CHARS.has(char)) {
      inString = true
      quote = char
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return html.slice(start, index + 1)
      }
    }
  }
  return null
}

/**
 * 读取内嵌状态的原始 JSON 文本（如 `window.__INITIAL_STATE__ = {...}`）。
 * 按大括号配对扫描，正确处理字符串中的括号与转义；找不到返回 null。
 */
export function readEmbeddedJsonText(
  html: string,
  marker: string
): string | null {
  if (typeof html !== 'string' || html.length === 0) {
    return null
  }
  const name = typeof marker === 'string' ? marker.replace(/[=\s]+$/g, '') : ''
  if (name === '') {
    return null
  }
  let searchFrom = 0
  while (searchFrom < html.length) {
    const markerIndex = html.indexOf(name, searchFrom)
    if (markerIndex < 0) {
      return null
    }
    const braceIndex = findAssignmentBrace(html, markerIndex + name.length)
    if (braceIndex < 0) {
      searchFrom = markerIndex + name.length
      continue
    }
    return scanBalancedObject(html, braceIndex)
  }
  return null
}

/**
 * 读取并解析内嵌 JSON；支持 `window.__INITIAL_STATE__`、
 * `window._ROUTER_DATA`、`window.__APOLLO_STATE__` 等赋值形式。
 * 解析失败返回 null。
 */
export function readEmbeddedJson(html: string, marker: string): unknown | null {
  const text = readEmbeddedJsonText(html, marker)
  if (text === null) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 取第一个非空字符串并 trim；都不满足时返回空字符串 */
export function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
  }
  return ''
}

/**
 * 转为绝对 HTTPS 地址：支持相对路径与协议相对地址，
 * 并把 http 升级为 https；无法解析时返回 undefined。
 */
export function absoluteUrl(
  base: string | null | undefined,
  value: unknown
): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }
  const raw = value.trim()
  const candidate = raw.startsWith('//') ? `https:${raw}` : raw
  try {
    const parsed = new URL(candidate, base ?? undefined)
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:'
    }
    return parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

/** 收窄为普通对象；数组、null 与其他类型返回 null */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/** 收窄为数组；其他类型返回空数组 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 读取有限数字；支持数字字符串，其余返回 undefined */
export function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return undefined
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** 时间戳转 ISO：兼容秒与毫秒，非法或非正数返回 undefined */
export function toIsoTime(value: unknown): string | undefined {
  const numeric = numberOrUndefined(value)
  if (numeric === undefined || numeric <= 0) {
    return undefined
  }
  const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** 把未知值按「对象 / JSON 字符串」两种形式解析，失败返回 null */
export function parseJsonValue(value: unknown): unknown | null {
  if (typeof value !== 'string') {
    return value ?? null
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}
