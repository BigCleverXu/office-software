import { formatBytes as formatSharedBytes } from '@shared/update'

/** 文件名高亮分段：match 为真时按命中部分渲染 */
export interface HighlightSegment {
  text: string
  match: boolean
}

/** 千分位格式化器，复用实例避免重复创建 */
const COUNT_FORMATTER = new Intl.NumberFormat('zh-CN')

/**
 * 文件大小：B / KB / MB / GB，保留一位小数。
 * 空文件与非法值显示 0 B，单位换算复用更新模块的实现。
 */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B'
  }
  return formatSharedBytes(size)
}

/** 两位补零 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 本地时区 `YYYY-MM-DD HH:mm`。
 * 时间戳为 0 或非法值时返回占位符 `--`。
 */
export function formatModifiedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '--'
  }
  const date = new Date(timestamp)
  const datePart = [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join('-')
  const timePart = [pad2(date.getHours()), pad2(date.getMinutes())].join(':')
  return `${datePart} ${timePart}`
}

/**
 * 按关键词做不区分大小写的分段，供模板用 v-for 渲染高亮（禁止 v-html）。
 * 关键词为空时返回整段非命中。
 */
export function splitHighlight(
  name: string,
  keyword: string
): HighlightSegment[] {
  const query = keyword.trim().toLowerCase()
  if (!query) {
    return [{ text: name, match: false }]
  }

  const lowerName = name.toLowerCase()
  const segments: HighlightSegment[] = []
  let cursor = 0
  let index = lowerName.indexOf(query)

  while (index !== -1) {
    if (index > cursor) {
      segments.push({ text: name.slice(cursor, index), match: false })
    }
    segments.push({
      text: name.slice(index, index + query.length),
      match: true
    })
    cursor = index + query.length
    index = lowerName.indexOf(query, cursor)
  }

  if (cursor < name.length) {
    segments.push({ text: name.slice(cursor), match: false })
  }

  return segments.length > 0 ? segments : [{ text: name, match: false }]
}

/** 数值千分位，非法值按 0 处理 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return COUNT_FORMATTER.format(value)
}
