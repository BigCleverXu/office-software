// 主进程节假日取数层：请求 timor.tech 年度节假日接口并解析为 HolidayEntry[]
// 仅在 Electron 主进程使用；渲染层受 CSP 限制不直接发起外部请求
import { isDateOnly, type HolidayEntry } from '../shared/calendar'

/** 节假日接口基础地址，年份拼接在末尾 */
export const HOLIDAY_API_BASE = 'https://timor.tech/api/holiday/year'

/** 默认请求超时（毫秒） */
export const HOLIDAY_FETCH_TIMEOUT_MS = 5000

/** 接口要求携带 User-Agent，缺失时返回 403 */
const USER_AGENT = 'reminder-app'

/** 最早允许查询的年份 */
const MIN_YEAR = 1900

/** 最晚允许查询的年份 */
const MAX_YEAR = 2100

/** 失败原因 */
export type HolidayFetchFailure = 'network' | 'timeout' | 'http' | 'invalid'

/** 取数结果 */
export type HolidayFetchResult =
  | { ok: true; entries: HolidayEntry[] }
  | { ok: false; reason: HolidayFetchFailure }

/** 判断是否为普通对象（排除 null 与数组） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 判断年份是否为 1900–2100 的整数 */
function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR
}

/** 判断异常是否为 AbortError */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * 解析响应 JSON 为节假日条目。
 * 顶层 code 必须为 0，holiday 必须为普通对象；单条非法直接跳过。
 * 按日期升序排序，同日期保留最后一条。
 */
function parseHolidayPayload(payload: unknown): HolidayEntry[] | null {
  if (!isRecord(payload) || payload.code !== 0) {
    return null
  }
  const holiday = payload.holiday
  if (!isRecord(holiday)) {
    return null
  }
  // 以日期为键，同日期后出现的条目覆盖先出现的
  const byDate = new Map<string, HolidayEntry>()
  for (const value of Object.values(holiday)) {
    if (!isRecord(value)) {
      continue
    }
    const date = value.date
    const name = value.name
    const flag = value.holiday
    if (!isDateOnly(date)) {
      continue
    }
    if (typeof name !== 'string' || name === '') {
      continue
    }
    if (typeof flag !== 'boolean') {
      continue
    }
    byDate.set(date, {
      date,
      name,
      type: flag ? 'holiday' : 'workday'
    })
  }
  return Array.from(byDate.values()).sort((left, right) =>
    left.date < right.date ? -1 : left.date > right.date ? 1 : 0
  )
}

/**
 * 获取指定年份的节假日与调休补班。
 *
 * 始终返回判别联合，绝不向调用方抛出异常：
 * - 年份非法 → invalid
 * - 非 2xx → http
 * - AbortError / 超时 → timeout；其余 fetch 异常 → network
 * - JSON 解析失败或结构不符 → invalid
 */
export async function fetchHolidayYear(
  year: number,
  options: {
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {}
): Promise<HolidayFetchResult> {
  if (!isValidYear(year)) {
    return { ok: false, reason: 'invalid' }
  }
  const timeoutMs = options.timeoutMs ?? HOLIDAY_FETCH_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  // 超时既中断请求，也让不响应该 signal 的 fetch 实现能立即收敛
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('节假日请求超时'))
    }, timeoutMs)
  })
  try {
    const response = await Promise.race([
      fetchImpl(`${HOLIDAY_API_BASE}/${year}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal
      }),
      timeout
    ])
    if (!response.ok) {
      return { ok: false, reason: 'http' }
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, reason: 'invalid' }
    }
    const entries = parseHolidayPayload(payload)
    if (entries === null) {
      return { ok: false, reason: 'invalid' }
    }
    return { ok: true, entries }
  } catch (error) {
    if (timedOut || controller.signal.aborted || isAbortError(error)) {
      return { ok: false, reason: 'timeout' }
    }
    return { ok: false, reason: 'network' }
  } finally {
    // 避免定时器泄漏
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
}
