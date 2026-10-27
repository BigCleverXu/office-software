import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CITY, type WeatherCity } from '../shared/weather'
import { closeDatabase, openDatabase } from './database'
import {
  WEATHER_CITIES_KEY,
  WEATHER_CURRENT_CITY_KEY,
  WeatherStore
} from './weather-store'

let db: DatabaseSync
let store: WeatherStore

const HANGZHOU: WeatherCity = {
  id: '1795855',
  name: '杭州',
  admin1: '浙江',
  country: '中国',
  latitude: 30.29365,
  longitude: 120.16142
}

const SHANGHAI: WeatherCity = {
  id: '1796236',
  name: '上海',
  admin1: '上海',
  country: '中国',
  latitude: 31.22222,
  longitude: 121.45806
}

beforeEach(() => {
  db = openDatabase({ path: ':memory:' })
  store = new WeatherStore(db)
})

afterEach(() => {
  closeDatabase(db)
})

/** 统计 settings 表中指定键的记录数 */
function countRows(key: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?')
    .get(key) as unknown as { n: number }
  return row.n
}

/** 直接写入 settings 原始值，模拟历史数据或损坏数据 */
function writeRaw(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    key,
    value
  )
}

describe('WeatherStore 空库', () => {
  it('getCities 返回北京副本', () => {
    const cities = store.getCities()

    expect(cities).toEqual([DEFAULT_CITY])
    expect(cities[0]).not.toBe(DEFAULT_CITY)
  })

  it('getCurrentCity 返回北京', () => {
    expect(store.getCurrentCity()).toEqual(DEFAULT_CITY)
  })
})

describe('WeatherStore.setCities', () => {
  it('写入合法城市后可跨实例读取', () => {
    expect(store.setCities([HANGZHOU, SHANGHAI])).toEqual([HANGZHOU, SHANGHAI])
    expect(store.getCities()).toEqual([HANGZHOU, SHANGHAI])
    expect(new WeatherStore(db).getCities()).toEqual([HANGZHOU, SHANGHAI])
  })

  it('写入空数组后读取为空数组', () => {
    expect(store.setCities([])).toEqual([])
    expect(store.getCities()).toEqual([])
  })

  it('过滤非法项并去重', () => {
    expect(
      store.setCities([
        HANGZHOU,
        { name: '缺坐标' },
        { id: 'x', name: '非法纬度', latitude: 200, longitude: 1 },
        { ...HANGZHOU, name: '重复杭州' }
      ])
    ).toEqual([HANGZHOU])
  })
})

describe('WeatherStore.getCities 损坏数据', () => {
  it('非法 JSON 回退北京且不抛错', () => {
    writeRaw(WEATHER_CITIES_KEY, 'not-json')

    expect(() => store.getCities()).not.toThrow()
    expect(store.getCities()).toEqual([DEFAULT_CITY])
  })

  it('非数组值回退北京', () => {
    writeRaw(WEATHER_CITIES_KEY, '{"name":"杭州"}')

    expect(store.getCities()).toEqual([DEFAULT_CITY])
  })
})

describe('WeatherStore.getCurrentCity', () => {
  it('已保存 id 不在列表时回退首项', () => {
    store.setCities([HANGZHOU, SHANGHAI])
    writeRaw(WEATHER_CURRENT_CITY_KEY, 'missing')

    expect(store.getCurrentCity()).toEqual(HANGZHOU)
  })

  it('列表为空时返回北京且不写库', () => {
    store.setCities([])

    expect(store.getCurrentCity()).toEqual(DEFAULT_CITY)
    expect(countRows(WEATHER_CURRENT_CITY_KEY)).toBe(0)
  })
})

describe('WeatherStore.setCurrentCity', () => {
  it('合法 id 写入并可跨实例读取', () => {
    store.setCities([HANGZHOU, SHANGHAI])

    expect(store.setCurrentCity(SHANGHAI.id)).toEqual(SHANGHAI)
    expect(store.getCurrentCity()).toEqual(SHANGHAI)
    expect(new WeatherStore(db).getCurrentCity()).toEqual(SHANGHAI)
  })

  it('不存在 id 返回 null 且不写库', () => {
    store.setCities([HANGZHOU])

    expect(store.setCurrentCity('missing')).toBeNull()
    expect(countRows(WEATHER_CURRENT_CITY_KEY)).toBe(0)
    expect(store.getCurrentCity()).toEqual(HANGZHOU)
  })

  it('非法类型返回 null 且不写库', () => {
    store.setCities([HANGZHOU])

    expect(store.setCurrentCity(null)).toBeNull()
    expect(store.setCurrentCity(123)).toBeNull()
    expect(countRows(WEATHER_CURRENT_CITY_KEY)).toBe(0)
  })
})
