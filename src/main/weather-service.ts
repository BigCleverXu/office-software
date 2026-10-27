// 主进程天气服务：管理城市列表 / 当前城市并加载天气快照
// 状态变化通过 onChanged 推送，IPC 层负责序列化广播
import {
  DEFAULT_CITY,
  MAX_CITIES,
  normalizeWeatherCity,
  normalizeWeatherCityId,
  type WeatherCity,
  type WeatherSearchResult,
  type WeatherSnapshot,
  type WeatherStatus,
  type WeatherViewState
} from '../shared/weather'
import type { WeatherStore } from './weather-store'
import {
  fetchWeather as fetchWeatherFromApi,
  searchCities as searchCitiesFromApi
} from './weather-provider'

export interface WeatherServiceDeps {
  store: WeatherStore
  /** 状态变化回调，默认空实现 */
  onChanged?: (state: WeatherViewState) => void
  /** 注入便于测试；默认 searchCities */
  searchCities?: (keyword: string) => Promise<WeatherCity[]>
  /** 注入便于测试；默认 fetchWeather */
  fetchWeather?: (city: WeatherCity) => Promise<WeatherSnapshot>
}

/**
 * 天气模块的状态管理器。
 *
 * 城市列表与当前城市持久化在 WeatherStore，快照只保存在内存；
 * 每次加载使用自增 requestId 丢弃过期响应，避免城市切换时旧数据回写。
 */
export class WeatherService {
  private readonly store: WeatherStore
  private readonly onChanged: (state: WeatherViewState) => void
  private readonly searchCities: (keyword: string) => Promise<WeatherCity[]>
  private readonly fetchWeather: (city: WeatherCity) => Promise<WeatherSnapshot>
  private cities: WeatherCity[]
  private currentCity: WeatherCity
  private snapshot: WeatherSnapshot | null = null
  private status: WeatherStatus = 'loading'
  private error: string | null = null
  /** 请求序号：只有最后一次加载允许写回状态 */
  private requestId = 0

  constructor(deps: WeatherServiceDeps) {
    this.store = deps.store
    this.onChanged = deps.onChanged ?? (() => {})
    this.searchCities =
      deps.searchCities ?? ((keyword) => searchCitiesFromApi(keyword))
    this.fetchWeather =
      deps.fetchWeather ?? ((city) => fetchWeatherFromApi(city))
    this.cities = this.store.getCities()
    this.currentCity = this.store.getCurrentCity()
  }

  /** 每次返回全新对象，避免渲染层持有可变引用 */
  private buildState(): WeatherViewState {
    return {
      cities: this.cities.map((city) => ({ ...city })),
      currentCity: { ...this.currentCity },
      snapshot: this.snapshot,
      status: this.status,
      error: this.error
    }
  }

  /** 读取当前状态副本 */
  getState(): WeatherViewState {
    return this.buildState()
  }

  /** 启动时调用：读取持久化城市并触发首次加载 */
  async initialize(): Promise<void> {
    if (this.cities.length === 0) {
      // 用户已删光城市：无可用城市，直接进入就绪态且不发请求
      this.status = 'ok'
      this.onChanged(this.buildState())
      return
    }
    await this.load()
  }

  /** 按关键词搜索城市，非法关键词与失败均返回可展示的错误 */
  async search(keyword: unknown): Promise<WeatherSearchResult> {
    if (typeof keyword !== 'string') {
      return { ok: false, error: '请输入要搜索的地区' }
    }
    const trimmed = keyword.trim()
    if (trimmed.length === 0) {
      return { ok: false, error: '请输入要搜索的地区' }
    }
    try {
      const cities = await this.searchCities(trimmed)
      return { ok: true, cities }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '城市搜索失败'
      }
    }
  }

  /** 切换当前城市并重新加载；id 不在列表中时只记录错误 */
  async selectCity(cityId: unknown): Promise<WeatherViewState> {
    const id = normalizeWeatherCityId(cityId)
    const city =
      id === null
        ? null
        : (this.cities.find((entry) => entry.id === id) ?? null)
    if (city === null) {
      this.error = '城市不存在'
      const state = this.buildState()
      this.onChanged(state)
      return state
    }
    const selected = this.store.setCurrentCity(city.id)
    this.currentCity = selected ?? city
    await this.load()
    return this.buildState()
  }

  /** 新增城市并设为当前城市：已存在则直接切换，超出上限则拒绝 */
  async addCity(city: unknown): Promise<WeatherViewState> {
    const normalized = normalizeWeatherCity(city)
    if (normalized === null) {
      this.error = '城市信息不合法'
      const state = this.buildState()
      this.onChanged(state)
      return state
    }
    const existing = this.cities.find((entry) => entry.id === normalized.id)
    if (existing) {
      return this.selectCity(existing.id)
    }
    if (this.cities.length >= MAX_CITIES) {
      this.error = '最多固定 12 个城市'
      const state = this.buildState()
      this.onChanged(state)
      return state
    }
    this.cities = this.store.setCities([...this.cities, normalized])
    const selected = this.store.setCurrentCity(normalized.id)
    this.currentCity = selected ?? normalized
    await this.load()
    return this.buildState()
  }

  /**
   * 删除城市。删除当前城市时切换到原索引位置的继任者（越界取最后一项）
   * 并重新加载；删光后回到北京占位状态，不发起请求。
   */
  async removeCity(cityId: unknown): Promise<WeatherViewState> {
    const id = normalizeWeatherCityId(cityId)
    if (id === null) {
      return this.buildState()
    }
    const index = this.cities.findIndex((city) => city.id === id)
    if (index < 0) {
      return this.buildState()
    }
    const removingCurrent = this.currentCity.id === id
    this.cities = this.store.setCities(
      this.cities.filter((_city, cityIndex) => cityIndex !== index)
    )
    if (this.cities.length === 0) {
      this.currentCity = { ...DEFAULT_CITY }
      this.snapshot = null
      this.status = 'ok'
      this.error = null
      // 作废针对已删除城市仍在进行的请求
      this.requestId += 1
      this.onChanged(this.buildState())
      return this.buildState()
    }
    if (!removingCurrent) {
      this.onChanged(this.buildState())
      return this.buildState()
    }
    const successor = this.cities[index] ?? this.cities[this.cities.length - 1]
    const selected = this.store.setCurrentCity(successor.id)
    this.currentCity = selected ?? successor
    await this.load()
    return this.buildState()
  }

  /** 用当前城市重新加载 */
  async refresh(): Promise<WeatherViewState> {
    await this.load()
    return this.buildState()
  }

  /**
   * 加载当前城市天气。
   * 先推送 loading / refreshing，await 后按 token 判断是否已过期；
   * 过期请求直接丢弃，不更新状态也不回调。
   */
  private async load(): Promise<void> {
    const token = ++this.requestId
    const city = this.currentCity
    this.status = this.snapshot === null ? 'loading' : 'refreshing'
    this.onChanged(this.buildState())
    try {
      const snapshot = await this.fetchWeather(city)
      if (token !== this.requestId) {
        return
      }
      this.snapshot = snapshot
      this.status = 'ok'
      this.error = null
    } catch (error) {
      if (token !== this.requestId) {
        return
      }
      // 失败保留旧快照，仅标记状态与错误
      this.status = 'failed'
      this.error = error instanceof Error ? error.message : '天气数据获取失败'
    }
    this.onChanged(this.buildState())
  }
}
