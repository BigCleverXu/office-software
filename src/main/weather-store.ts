import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_CITY,
  normalizeWeatherCities,
  normalizeWeatherCityId,
  type WeatherCity
} from '../shared/weather'
import type { SettingRow } from './database'

/** settings 表中存放城市列表的键名 */
export const WEATHER_CITIES_KEY = 'weatherCities'

/** settings 表中存放当前城市 id 的键名 */
export const WEATHER_CURRENT_CITY_KEY = 'weatherCurrentCity'

/**
 * 天气模块的本地持久化存储：
 * 城市列表与当前城市以 settings 表存储，损坏数据回退默认值。
 *
 * 城市列表值为 `JSON.stringify(WeatherCity[])`，当前城市值为城市 id 原文。
 * 数据库由 `openDatabase` 统一创建与关闭。
 */
export class WeatherStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 读取 settings 中的原始值；不存在返回 null */
  private readValue(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as unknown as SettingRow | undefined
    return row?.value ?? null
  }

  /** 写入 settings 中的原始值 */
  private writeValue(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, value)
  }

  /**
   * 读取城市列表：无记录 / JSON 损坏时回退北京；
   * 合法数组按契约归一化（可能为空数组，表示用户已删光）。
   */
  getCities(): WeatherCity[] {
    const raw = this.readValue(WEATHER_CITIES_KEY)
    if (raw === null) {
      return [{ ...DEFAULT_CITY }]
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return [{ ...DEFAULT_CITY }]
    }
    return normalizeWeatherCities(parsed)
  }

  /** 归一化后写入并返回写入结果 */
  setCities(cities: unknown): WeatherCity[] {
    const normalized = normalizeWeatherCities(cities)
    this.writeValue(WEATHER_CITIES_KEY, JSON.stringify(normalized))
    return normalized
  }

  /**
   * 读取当前城市：优先取已保存且仍在列表中的 id；
   * 否则回退列表首项；列表为空时返回北京（不写库）。
   */
  getCurrentCity(): WeatherCity {
    const cities = this.getCities()
    const id = normalizeWeatherCityId(this.readValue(WEATHER_CURRENT_CITY_KEY))
    if (id !== null) {
      const found = cities.find((city) => city.id === id)
      if (found) {
        return found
      }
    }
    if (cities.length > 0) {
      return cities[0]
    }
    return { ...DEFAULT_CITY }
  }

  /**
   * 设置当前城市：id 非法或不在当前列表中返回 null 且不写库；
   * 成功写入并返回对应城市。
   */
  setCurrentCity(cityId: unknown): WeatherCity | null {
    const id = normalizeWeatherCityId(cityId)
    if (id === null) {
      return null
    }
    const city = this.getCities().find((entry) => entry.id === id)
    if (!city) {
      return null
    }
    this.writeValue(WEATHER_CURRENT_CITY_KEY, id)
    return city
  }
}
