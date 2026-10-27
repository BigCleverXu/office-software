import { describe, expect, it, vi } from 'vitest'
import type { WeatherCity } from '../shared/weather'
import {
  CHINA_CITY_ENDPOINT,
  FORECAST_ENDPOINT,
  fetchWeather,
  searchCities
} from './weather-provider'

/** 构造一个最小可用的 Response 桩，仅提供取数层用到的字段 */
function makeResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as unknown as Response
}

const HANGZHOU: WeatherCity = {
  id: '1795855',
  name: '杭州',
  admin1: '浙江',
  country: '中国',
  latitude: 30.29365,
  longitude: 120.16142
}

/** 从 2026-10-27 00:00 起的 48 个整点 */
const HOURS: string[] = Array.from({ length: 48 }, (_value, index) => {
  const day = index < 24 ? '2026-10-27' : '2026-10-28'
  const hour = String(index % 24).padStart(2, '0')
  return `${day}T${hour}:00`
})

const DAILY_DATES = [
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
  '2026-11-01',
  '2026-11-02'
]

/** 构造一份完整的预报响应体 */
function makeForecastPayload(): Record<string, unknown> {
  return {
    timezone: 'Asia/Shanghai',
    current: {
      time: '2026-10-27T14:35',
      temperature_2m: 21.5,
      relative_humidity_2m: 55,
      apparent_temperature: 20.8,
      precipitation: 0.2,
      weather_code: 3,
      wind_speed_10m: 12.4,
      wind_direction_10m: 180,
      surface_pressure: 1012.5,
      is_day: 1
    },
    hourly: {
      time: HOURS,
      temperature_2m: HOURS.map((_value, index) => 10 + index),
      precipitation_probability: HOURS.map((_value, index) => index % 100),
      weather_code: HOURS.map(() => 1)
    },
    daily: {
      time: DAILY_DATES,
      weather_code: [3, 3, 61, 61, 2, 0, 1],
      temperature_2m_max: [24, 25, 22, 21, 23, 26, 27],
      temperature_2m_min: [15, 16, 14, 13, 12, 15, 16],
      precipitation_probability_max: [10, 20, 80, 70, 30, 0, 5],
      precipitation_sum: [0, 0, 5.2, 3.1, 0, 0, 0],
      sunrise: DAILY_DATES.map((date) => `${date}T06:31`),
      sunset: DAILY_DATES.map((date) => `${date}T17:24`)
    }
  }
}

describe('searchCities', () => {
  it('空关键词不发请求且返回空数组', async () => {
    const fetchImpl = vi.fn()

    const result = await searchCities('   ', {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('映射国内行政区划字段并按 id 去重', async () => {
    const requestedUrls: string[] = []
    const payload = {
      code: 200,
      data: [
        {
          id: '101210501',
          code: '330602',
          province: '浙江省',
          name: '绍兴市',
          district: '越城',
          longitude: '120.585312',
          latitude: '29.996992'
        },
        {
          id: 'dup',
          code: '330602',
          province: '浙江省',
          name: '绍兴市',
          district: '越城副本',
          longitude: '120.58',
          latitude: '29.99'
        },
        {
          id: 'bad',
          code: '999999',
          province: '浙江省',
          name: '缺坐标',
          district: '缺坐标',
          longitude: '',
          latitude: ''
        },
        {
          id: 'nocoord',
          code: '888888',
          province: '浙江省',
          name: '无坐标',
          district: '无坐标'
        }
      ]
    }
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      return makeResponse(payload)
    })

    const result = await searchCities('越城', {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(requestedUrls).toEqual([
      `${CHINA_CITY_ENDPOINT}?dataSource=LOCAL_CHINA_CITY` +
        '&district=%E8%B6%8A%E5%9F%8E'
    ])
    expect(result).toEqual([
      {
        id: '330602',
        name: '越城',
        admin1: '浙江省',
        country: '中国',
        city: '绍兴市',
        district: '越城',
        latitude: 29.996992,
        longitude: 120.585312
      }
    ])
  })

  it('同名区县返回多条并保留各自省市', async () => {
    const payload = {
      code: 200,
      data: [
        {
          code: '110105',
          province: '北京市',
          name: '北京市',
          district: '朝阳',
          longitude: '116.486412',
          latitude: '39.92149'
        },
        {
          code: '220104',
          province: '吉林省',
          name: '长春市',
          district: '朝阳',
          longitude: '125.318039',
          latitude: '43.8649'
        }
      ]
    }
    const fetchImpl = vi.fn(async () => makeResponse(payload))

    const result = await searchCities('朝阳', {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result).toHaveLength(2)
    expect(result.map((city) => city.name)).toEqual(['朝阳', '朝阳'])
    expect(result.map((city) => city.admin1)).toEqual(['北京市', '吉林省'])
    expect(result.map((city) => city.city)).toEqual(['北京市', '长春市'])
    expect(result.map((city) => city.id)).toEqual(['110105', '220104'])
  })

  it('data 缺失或为空返回空数组', async () => {
    const emptyFetch = vi.fn(async () => makeResponse({ code: 200, data: [] }))
    const missingFetch = vi.fn(async () => makeResponse({}))
    const invalidFetch = vi.fn(async () => makeResponse({ data: 'x' }))

    await expect(
      searchCities('越城', {
        fetchImpl: emptyFetch as unknown as typeof fetch
      })
    ).resolves.toEqual([])
    await expect(
      searchCities('越城', {
        fetchImpl: missingFetch as unknown as typeof fetch
      })
    ).resolves.toEqual([])
    await expect(
      searchCities('越城', {
        fetchImpl: invalidFetch as unknown as typeof fetch
      })
    ).resolves.toEqual([])
  })

  it('字段缺失时用 id 兜底并跳过无名称项', async () => {
    const payload = {
      code: 200,
      data: [
        {
          id: '101010100',
          province: '北京市',
          name: '北京市',
          district: '',
          longitude: '116.405289',
          latitude: '39.904987'
        },
        {
          id: 'x',
          code: '1',
          province: 'x',
          name: '',
          district: '',
          longitude: '1',
          latitude: '1'
        }
      ]
    }
    const fetchImpl = vi.fn(async () => makeResponse(payload))

    const result = await searchCities('北京', {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result).toEqual([
      {
        id: '101010100',
        name: '北京市',
        admin1: '北京市',
        country: '中国',
        city: '北京市',
        latitude: 39.904987,
        longitude: 116.405289
      }
    ])
  })

  it('HTTP 500 抛出网络错误', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({}, 500))

    await expect(
      searchCities('越城', {
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow('城市搜索失败，请检查网络')
  })
})

describe('fetchWeather', () => {
  it('解析 current / hourly / daily', async () => {
    const requestedUrls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      return makeResponse(makeForecastPayload())
    })

    const snapshot = await fetchWeather(HANGZHOU, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(requestedUrls[0].startsWith(`${FORECAST_ENDPOINT}?`)).toBe(true)
    expect(snapshot.city).toEqual(HANGZHOU)
    expect(snapshot.timezone).toBe('Asia/Shanghai')
    expect(typeof snapshot.updatedAt).toBe('number')
    expect(snapshot.current).toEqual({
      temperature: 21.5,
      apparentTemperature: 20.8,
      humidity: 55,
      precipitation: 0.2,
      weatherCode: 3,
      windSpeed: 12.4,
      windDirection: 180,
      pressure: 1012.5,
      isDay: true,
      sunrise: '06:31',
      sunset: '17:24',
      time: '2026-10-27T14:35'
    })
    // 从当前小时（14:00）起取 24 个点
    expect(snapshot.hourly).toHaveLength(24)
    expect(snapshot.hourly[0]).toEqual({
      time: '14:00',
      temperature: 24,
      precipitationProbability: 14,
      weatherCode: 1
    })
    expect(snapshot.hourly[23].time).toBe('13:00')
    expect(snapshot.daily).toHaveLength(7)
    expect(snapshot.daily[0]).toEqual({
      date: '2026-10-27',
      weekday: '周二',
      weatherCode: 3,
      temperatureMax: 24,
      temperatureMin: 15,
      precipitationProbability: 10,
      precipitationSum: 0,
      sunrise: '06:31',
      sunset: '17:24'
    })
    expect(snapshot.daily[6].weekday).toBe('周一')
  })

  it('HTTP 500 抛天气获取失败', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({}, 500))

    await expect(
      fetchWeather(HANGZHOU, {
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow('天气数据获取失败，请检查网络')
  })

  it('必需字段缺失时抛解析失败', async () => {
    const payload = makeForecastPayload()
    const current = payload.current as Record<string, unknown>
    delete current.temperature_2m
    const fetchImpl = vi.fn(async () => makeResponse(payload))

    await expect(
      fetchWeather(HANGZHOU, {
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow('天气数据解析失败')
  })
})
