// 主进程热点新闻取数层：按平台请求 orz-ai/hot_news 公开接口并解析为共享 NewsSection
// 仅在 Electron 主进程使用；渲染层受 CSP 限制不直接发起外部请求
import type { NewsItem, NewsPlatformId, NewsSection } from '../shared/news'

/** 请求基础地址，platform 以 encodeURIComponent 拼接在末尾 */
export const NEWS_ENDPOINT = 'https://news.orz.ai/api/v1/dailynews/?platform='

/** 默认单平台请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 10000

/** 数据格式异常文案 */
const FORMAT_ERROR = '返回数据格式异常'
/** 请求超时文案 */
const TIMEOUT_ERROR = '请求超时'
/** 网络异常文案 */
const NETWORK_ERROR = '网络请求失败'

export interface NewsProviderOptions {
  /** 单平台请求超时（毫秒），默认 10000 */
  timeoutMs?: number
  /** 注入的 fetch 实现，便于测试；默认使用全局 fetch */
  fetchImpl?: typeof fetch
}

/** 把 unknown 收窄为普通对象（排除 null 与数组） */
function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/** 字符串则原样保留，其余一律回退空字符串 */
function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 构造失败分组：items 为空，携带错误文案 */
function failedSection(platform: NewsPlatformId, error: string): NewsSection {
  return { platform, items: [], error }
}

/** 解析单条新闻；缺少有效 title 或 url 时返回 null */
function parseNewsItem(value: unknown): NewsItem | null {
  const record = toRecord(value)
  if (!record) {
    return null
  }
  const title = readText(record.title).trim()
  const url = readText(record.url).trim()
  if (title === '' || url === '') {
    return null
  }
  return {
    title,
    url,
    content: readText(record.content),
    publishTime: readText(record.publish_time)
  }
}

/** 纯解析函数：把接口 JSON 解析为单个平台分组，绝不抛出 */
export function parsePlatformNews(
  platform: NewsPlatformId,
  payload: unknown
): NewsSection {
  const record = toRecord(payload)
  if (!record) {
    return failedSection(platform, FORMAT_ERROR)
  }
  // 接口状态字段可能是字符串 '200'，也兼容数字 200
  const statusOk = record.status === '200' || record.status === 200
  if (!statusOk || !Array.isArray(record.data)) {
    return failedSection(platform, FORMAT_ERROR)
  }
  const items: NewsItem[] = []
  for (const entry of record.data as unknown[]) {
    const item = parseNewsItem(entry)
    if (item) {
      items.push(item)
    }
  }
  // 空数组是合法结果
  return { platform, items, error: null }
}

/** 拉取单个平台；任何失败只落在该分组的 error，绝不抛出 */
async function fetchPlatformSection(
  platform: NewsPlatformId,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<NewsSection> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = `${NEWS_ENDPOINT}${encodeURIComponent(platform)}`
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) {
      return failedSection(platform, `请求失败（HTTP ${response.status}）`)
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      if (controller.signal.aborted) {
        return failedSection(platform, TIMEOUT_ERROR)
      }
      return failedSection(platform, FORMAT_ERROR)
    }
    return parsePlatformNews(platform, payload)
  } catch {
    if (controller.signal.aborted) {
      return failedSection(platform, TIMEOUT_ERROR)
    }
    return failedSection(platform, NETWORK_ERROR)
  } finally {
    // 避免定时器泄漏
    clearTimeout(timer)
  }
}

/** 并发拉取多个平台；单平台失败只体现在该分组的 error，不抛出 */
export async function fetchNewsSections(
  platforms: NewsPlatformId[],
  options: NewsProviderOptions = {}
): Promise<NewsSection[]> {
  if (platforms.length === 0) {
    return []
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  // Promise.all 结果顺序与入参顺序一致
  return Promise.all(
    platforms.map((platform) =>
      fetchPlatformSection(platform, timeoutMs, fetchImpl)
    )
  )
}
