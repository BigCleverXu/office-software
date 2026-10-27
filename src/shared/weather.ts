// 天气模块共享契约：类型 + 常量 + 纯函数
// 仅依赖语言内置能力，主进程 / preload / 渲染层共用

/** 城市条目 */
export interface WeatherCity {
  /** 唯一标识：行政区划代码，缺失时用纬度,经度 生成 */
  id: string
  /** 地区展示名：优先区县名，如「越城」；无区县时为市名，如「杭州」 */
  name: string
  /** 一级行政区（省 / 直辖市），如「浙江省」，可为空字符串 */
  admin1: string
  /** 国家，如「中国」，可为空字符串 */
  country: string
  /** 地级市名，如「绍兴市」；旧数据可能没有，可选 */
  city?: string
  /** 区县名，如「越城」；旧数据可能没有，可选 */
  district?: string
  latitude: number
  longitude: number
}

/** 当前天气 */
export interface CurrentWeather {
  temperature: number
  apparentTemperature: number
  /** 相对湿度，百分数 */
  humidity: number
  /** 当前小时降水量 mm */
  precipitation: number
  /** WMO 天气码 */
  weatherCode: number
  /** 风速 km/h */
  windSpeed: number
  /** 风向角度 0-360 */
  windDirection: number
  /** 地面气压 hPa */
  pressure: number
  /** 白天 / 夜间 */
  isDay: boolean
  /** 日出 'HH:mm' */
  sunrise: string
  /** 日落 'HH:mm' */
  sunset: string
  /** 观测时间，ISO 本地时间字符串 */
  time: string
}

/** 逐时点 */
export interface HourlyPoint {
  /** 'HH:mm' */
  time: string
  temperature: number
  /** 降水概率 0-100 */
  precipitationProbability: number
  weatherCode: number
}

/** 每日预报 */
export interface DailyPoint {
  /** 'YYYY-MM-DD' */
  date: string
  /** '周一' */
  weekday: string
  weatherCode: number
  temperatureMax: number
  temperatureMin: number
  precipitationProbability: number
  precipitationSum: number
  sunrise: string
  sunset: string
}

/** 一份完整天气快照 */
export interface WeatherSnapshot {
  city: WeatherCity
  current: CurrentWeather
  /** 未来 24 小时 */
  hourly: HourlyPoint[]
  /** 7 天预报 */
  daily: DailyPoint[]
  /** 最近成功刷新时间戳（毫秒） */
  updatedAt: number
  /** 时区名，如 'Asia/Shanghai' */
  timezone: string
}

export type WeatherStatus = 'loading' | 'refreshing' | 'ok' | 'failed'

/** 推送给渲染层的完整状态 */
export interface WeatherViewState {
  cities: WeatherCity[]
  currentCity: WeatherCity
  snapshot: WeatherSnapshot | null
  status: WeatherStatus
  error: string | null
}

/** 城市搜索结果 */
export type WeatherSearchResult =
  { ok: true; cities: WeatherCity[] } | { ok: false; error: string }

/** IPC 通道 */
export const WEATHER_CHANNELS = {
  getState: 'weather:get-state',
  search: 'weather:search',
  selectCity: 'weather:select-city',
  addCity: 'weather:add-city',
  removeCity: 'weather:remove-city',
  refresh: 'weather:refresh',
  stateChanged: 'weather:state-changed'
} as const

/** 默认城市：北京（首次启动 / 城市列表损坏时的兜底值） */
export const DEFAULT_CITY: WeatherCity = {
  id: 'beijing',
  name: '北京',
  admin1: '北京市',
  country: '中国',
  latitude: 39.9075,
  longitude: 116.39723
}

/** 城市列表容量上限 */
export const MAX_CITIES = 12

/** 渲染进程可用的天气 API（由 preload 暴露） */
export interface WeatherApi {
  getState: () => Promise<WeatherViewState>
  search: (keyword: string) => Promise<WeatherSearchResult>
  selectCity: (cityId: string) => Promise<WeatherViewState>
  addCity: (city: WeatherCity) => Promise<WeatherViewState>
  removeCity: (cityId: string) => Promise<WeatherViewState>
  refresh: () => Promise<WeatherViewState>
  onStateChanged: (callback: (state: WeatherViewState) => void) => () => void
}

/** 判断坐标是否为有限数字且落在合法区间 */
function isValidCoordinate(value: unknown, limit: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -limit &&
    value <= limit
  )
}

/**
 * 归一化单个城市：校验名称与经纬度，其余字段做宽松处理。
 * 任一硬性校验失败返回 null。
 */
export function normalizeWeatherCity(value: unknown): WeatherCity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (name.length === 0) {
    return null
  }
  const { latitude, longitude } = record
  if (!isValidCoordinate(latitude, 90)) {
    return null
  }
  if (!isValidCoordinate(longitude, 180)) {
    return null
  }
  const rawId = record.id
  const trimmedId = typeof rawId === 'string' ? rawId.trim() : ''
  const city = typeof record.city === 'string' ? record.city.trim() : ''
  const district =
    typeof record.district === 'string' ? record.district.trim() : ''
  return {
    id:
      trimmedId.length > 0
        ? trimmedId
        : `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
    name,
    admin1: typeof record.admin1 === 'string' ? record.admin1 : '',
    country: typeof record.country === 'string' ? record.country : '',
    latitude,
    longitude,
    ...(city.length > 0 ? { city } : {}),
    ...(district.length > 0 ? { district } : {})
  }
}

/**
 * 归一化城市列表：非数组（缺失 / 损坏）回退北京；
 * 数组则过滤非法项、按 id 去重（保留首次出现）并截断到 MAX_CITIES。
 * 数组归一化后为空时返回空数组，不回退北京（用户可能主动删光）。
 */
export function normalizeWeatherCities(value: unknown): WeatherCity[] {
  if (!Array.isArray(value)) {
    return [{ ...DEFAULT_CITY }]
  }
  const cities: WeatherCity[] = []
  const seen = new Set<string>()
  for (const item of value as unknown[]) {
    const city = normalizeWeatherCity(item)
    if (city === null || seen.has(city.id)) {
      continue
    }
    seen.add(city.id)
    cities.push(city)
    if (cities.length >= MAX_CITIES) {
      break
    }
  }
  return cities
}

/** 归一化城市 id：非空字符串 trim 后返回，否则 null */
export function normalizeWeatherCityId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const id = value.trim()
  return id.length > 0 ? id : null
}
