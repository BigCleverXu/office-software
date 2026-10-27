// 主进程天气取数层：城市联想走 songzixian 国内行政区划接口，
// 天气预报走 open-meteo forecast，并解析为共享 WeatherCity / WeatherSnapshot
// 仅在 Electron 主进程使用；渲染层受 CSP 限制不直接发起外部请求
import {
  normalizeWeatherCity,
  type CurrentWeather,
  type DailyPoint,
  type HourlyPoint,
  type WeatherCity,
  type WeatherSnapshot
} from '../shared/weather'

/** 城市联想接口地址（国内行政区划数据） */
export const CHINA_CITY_ENDPOINT = 'https://api.songzixian.com/api/china-city'

/** 天气预报接口地址 */
export const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 10000

/** 城市搜索失败文案 */
const SEARCH_ERROR = '城市搜索失败，请检查网络'
/** 天气数据获取失败文案 */
const FETCH_ERROR = '天气数据获取失败，请检查网络'
/** 天气数据解析失败文案 */
const PARSE_ERROR = '天气数据解析失败'
/** 请求超时文案 */
const TIMEOUT_ERROR = '请求超时，请稍后重试'

/** 一周中文名称，索引与 Date.getDay() 对齐 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export interface WeatherProviderOptions {
  /** 注入 fetch 便于测试；默认全局 fetch */
  fetchImpl?: typeof fetch
  /** 超时毫秒，默认 10000 */
  timeoutMs?: number
}

/** 把 unknown 收窄为普通对象（排除 null 与数组） */
function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/** 有限数字则返回，否则 null */
function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 接口坐标是字符串，转为有限数字；非法返回 null */
function toCoordinate(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** 读取必需数字字段；缺失或类型不符时抛解析失败 */
function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = toNumber(record[key])
  if (value === null) {
    throw new Error(PARSE_ERROR)
  }
  return value
}

/** 读取必需数组字段；非数组时抛解析失败 */
function requireArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  if (!Array.isArray(value)) {
    throw new Error(PARSE_ERROR)
  }
  return value as unknown[]
}

/** 读取数组中指定下标的数字；缺失或类型不符时抛解析失败 */
function numberAt(values: unknown[], index: number): number {
  const value = toNumber(values[index])
  if (value === null) {
    throw new Error(PARSE_ERROR)
  }
  return value
}

/** 读取数组中指定下标的字符串；类型不符时抛解析失败 */
function stringAt(values: unknown[], index: number): string {
  const value = values[index]
  if (typeof value !== 'string') {
    throw new Error(PARSE_ERROR)
  }
  return value
}

/** 从 ISO 时间中截取 `HH:mm`，如 '2026-10-27T06:31' → '06:31' */
function clockFromIso(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = value.match(/(?:T|\s)(\d{2}:\d{2})/)
  return match ? match[1] : null
}

/** 由 'YYYY-MM-DD' 推导中文星期；非法日期返回 null */
function weekdayOf(date: string): string | null {
  const day = new Date(`${date}T00:00:00`).getDay()
  if (!Number.isInteger(day)) {
    return null
  }
  return WEEKDAYS[day] ?? null
}

/**
 * 把当前观测时间截断到整点（`YYYY-MM-DDTHH:00`），
 * 用于在 hourly.time 中定位「当前小时」。
 */
function currentHourKey(time: string): string | null {
  const match = time.match(/^(\d{4}-\d{2}-\d{2}T\d{2})/)
  return match ? `${match[1]}:00` : null
}

/**
 * 请求 JSON：统一处理超时、非 2xx 与网络异常。
 * 超时统一抛「请求超时，请稍后重试」，其余失败抛出调用方指定文案。
 */
async function requestJson(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  networkError: string,
  parseError: string
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(networkError)
    }
    try {
      return await response.json()
    } catch {
      throw new Error(parseError)
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(TIMEOUT_ERROR)
    }
    if (
      error instanceof Error &&
      (error.message === networkError || error.message === parseError)
    ) {
      throw error
    }
    throw new Error(networkError)
  } finally {
    // 避免定时器泄漏
    clearTimeout(timer)
  }
}

/**
 * 按关键词搜索城市（国内行政区划数据）。
 * 空 / 纯空白关键词直接返回空数组，不发起请求；
 * 响应结构不符或没有结果时返回空数组；网络类失败抛出。
 */
export async function searchCities(
  keyword: string,
  options: WeatherProviderOptions = {}
): Promise<WeatherCity[]> {
  const trimmed = keyword.trim()
  if (trimmed.length === 0) {
    return []
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const url =
    `${CHINA_CITY_ENDPOINT}?dataSource=LOCAL_CHINA_CITY` +
    `&district=${encodeURIComponent(trimmed)}`
  const payload = await requestJson(
    url,
    timeoutMs,
    fetchImpl,
    SEARCH_ERROR,
    SEARCH_ERROR
  )
  const record = toRecord(payload)
  const entries = record && Array.isArray(record.data) ? record.data : null
  if (!entries || entries.length === 0) {
    return []
  }
  const cities: WeatherCity[] = []
  const seen = new Set<string>()
  for (const item of entries as unknown[]) {
    const entry = toRecord(item)
    if (!entry) {
      continue
    }
    const province =
      typeof entry.province === 'string' ? entry.province.trim() : ''
    const cityName = typeof entry.name === 'string' ? entry.name.trim() : ''
    const district =
      typeof entry.district === 'string' ? entry.district.trim() : ''
    const code = typeof entry.code === 'string' ? entry.code.trim() : ''
    const rawId =
      entry.id === undefined || entry.id === null ? '' : String(entry.id).trim()
    const id = code.length > 0 ? code : rawId
    // 展示名优先区县，回退地级市
    const label = district.length > 0 ? district : cityName
    const latitude = toCoordinate(entry.latitude)
    const longitude = toCoordinate(entry.longitude)
    if (latitude === null || longitude === null) {
      continue
    }
    const city = normalizeWeatherCity({
      id,
      name: label,
      admin1: province,
      country: '中国',
      city: cityName,
      district,
      latitude,
      longitude
    })
    if (city === null || seen.has(city.id)) {
      continue
    }
    seen.add(city.id)
    cities.push(city)
  }
  return cities
}

/** 解析当前天气；任一必需字段缺失 / 类型不符时抛解析失败 */
function parseCurrent(
  record: Record<string, unknown>,
  sunrise: string,
  sunset: string
): CurrentWeather {
  const time = record.time
  if (typeof time !== 'string' || time.length === 0) {
    throw new Error(PARSE_ERROR)
  }
  return {
    temperature: requireNumber(record, 'temperature_2m'),
    apparentTemperature: requireNumber(record, 'apparent_temperature'),
    humidity: requireNumber(record, 'relative_humidity_2m'),
    precipitation: requireNumber(record, 'precipitation'),
    weatherCode: requireNumber(record, 'weather_code'),
    windSpeed: requireNumber(record, 'wind_speed_10m'),
    windDirection: requireNumber(record, 'wind_direction_10m'),
    pressure: requireNumber(record, 'surface_pressure'),
    isDay: requireNumber(record, 'is_day') === 1,
    sunrise,
    sunset,
    time
  }
}

/** 解析逐日预报（最多 7 项） */
function parseDaily(record: Record<string, unknown>): DailyPoint[] {
  const times = requireArray(record, 'time')
  const codes = requireArray(record, 'weather_code')
  const maxes = requireArray(record, 'temperature_2m_max')
  const mins = requireArray(record, 'temperature_2m_min')
  // 降水概率字段名以接口实际返回为准
  const probabilities = requireArray(record, 'precipitation_probability_max')
  const sums = requireArray(record, 'precipitation_sum')
  const sunrises = requireArray(record, 'sunrise')
  const sunsets = requireArray(record, 'sunset')
  const count = Math.min(times.length, 7)
  if (count === 0) {
    throw new Error(PARSE_ERROR)
  }
  const daily: DailyPoint[] = []
  for (let i = 0; i < count; i += 1) {
    const date = stringAt(times, i)
    const weekday = weekdayOf(date)
    if (weekday === null) {
      throw new Error(PARSE_ERROR)
    }
    const sunrise = clockFromIso(sunrises[i])
    const sunset = clockFromIso(sunsets[i])
    if (sunrise === null || sunset === null) {
      throw new Error(PARSE_ERROR)
    }
    daily.push({
      date,
      weekday,
      weatherCode: numberAt(codes, i),
      temperatureMax: numberAt(maxes, i),
      temperatureMin: numberAt(mins, i),
      precipitationProbability: numberAt(probabilities, i),
      precipitationSum: numberAt(sums, i),
      sunrise,
      sunset
    })
  }
  return daily
}

/** 解析从当前小时起的 24 小时逐时数据；不足 24 个按实际长度返回 */
function parseHourly(
  record: Record<string, unknown>,
  currentTime: string
): HourlyPoint[] {
  const times = requireArray(record, 'time')
  const temperatures = requireArray(record, 'temperature_2m')
  const probabilities = requireArray(record, 'precipitation_probability')
  const codes = requireArray(record, 'weather_code')
  const hourKey = currentHourKey(currentTime)
  let start = 0
  if (hourKey !== null) {
    const found = times.findIndex(
      (item) => typeof item === 'string' && item >= hourKey
    )
    if (found >= 0) {
      start = found
    }
  }
  const hourly: HourlyPoint[] = []
  const end = Math.min(start + 24, times.length)
  for (let i = start; i < end; i += 1) {
    const clock = clockFromIso(times[i])
    if (clock === null) {
      throw new Error(PARSE_ERROR)
    }
    hourly.push({
      time: clock,
      temperature: numberAt(temperatures, i),
      precipitationProbability: numberAt(probabilities, i),
      weatherCode: numberAt(codes, i)
    })
  }
  return hourly
}

/**
 * 获取指定城市的完整天气快照。
 * 必需字段缺失 / 类型非数字时抛「天气数据解析失败」；
 * HTTP 非 2xx 抛「天气数据获取失败，请检查网络」。
 */
export async function fetchWeather(
  city: WeatherCity,
  options: WeatherProviderOptions = {}
): Promise<WeatherSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const params = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,' +
      'precipitation,weather_code,wind_speed_10m,wind_direction_10m,' +
      'surface_pressure,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,' +
      'precipitation_probability_max,precipitation_sum,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '7'
  })
  const payload = await requestJson(
    `${FORECAST_ENDPOINT}?${params.toString()}`,
    timeoutMs,
    fetchImpl,
    FETCH_ERROR,
    PARSE_ERROR
  )
  const root = toRecord(payload)
  const currentRecord = root ? toRecord(root.current) : null
  const dailyRecord = root ? toRecord(root.daily) : null
  const hourlyRecord = root ? toRecord(root.hourly) : null
  if (!root || !currentRecord || !dailyRecord || !hourlyRecord) {
    throw new Error(PARSE_ERROR)
  }
  const daily = parseDaily(dailyRecord)
  const currentTime = currentRecord.time
  if (typeof currentTime !== 'string' || currentTime.length === 0) {
    throw new Error(PARSE_ERROR)
  }
  const today = daily[0]
  const current = parseCurrent(currentRecord, today.sunrise, today.sunset)
  const hourly = parseHourly(hourlyRecord, currentTime)
  return {
    city,
    current,
    hourly,
    daily,
    updatedAt: Date.now(),
    timezone:
      typeof root.timezone === 'string' && root.timezone.length > 0
        ? root.timezone
        : 'auto'
  }
}
