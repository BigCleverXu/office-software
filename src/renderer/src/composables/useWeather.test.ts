import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeatherCity, WeatherViewState } from '../../../shared/weather'
import { useWeather } from './useWeather'

/** 用例中的城市，同时作为期望的纯对象基准 */
const CITY: WeatherCity = {
  id: '1808926',
  name: '杭州',
  admin1: '浙江',
  country: '中国',
  latitude: 30.29365,
  longitude: 120.16142
}

/** 添加城市后主进程返回的视图状态 */
const NEXT_STATE: WeatherViewState = {
  cities: [{ ...CITY }],
  currentCity: { ...CITY },
  snapshot: null,
  status: 'ok',
  error: null
}

/** 模拟的添加城市调用，用例内按需覆写返回值 */
const addCityApi = vi.fn<(city: WeatherCity) => Promise<WeatherViewState>>()

/** 模拟 preload 暴露的 weather API */
function stubWeatherApi(): void {
  vi.stubGlobal('window', {
    api: {
      weather: {
        addCity: addCityApi,
        getState: async () => NEXT_STATE,
        search: async () => ({ ok: true, cities: [] }),
        selectCity: async () => NEXT_STATE,
        removeCity: async () => NEXT_STATE,
        refresh: async () => NEXT_STATE,
        onStateChanged: () => () => undefined
      }
    }
  })
}

beforeEach(() => {
  addCityApi.mockReset()
  addCityApi.mockResolvedValue(NEXT_STATE)
  stubWeatherApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useWeather addCity IPC 参数', () => {
  it('响应式城市转为纯对象后再传给 IPC', async () => {
    const city = reactive({ ...CITY })
    const { addCity, state } = useWeather()

    await addCity(city)

    expect(addCityApi).toHaveBeenCalledTimes(1)
    const payload = addCityApi.mock.calls[0]?.[0]
    expect(payload).toEqual(CITY)
    // 回归本次根因：Proxy 不能被结构化克隆
    expect(() => structuredClone(payload)).not.toThrow()
    expect(state.value).toEqual(NEXT_STATE)
    expect(state.value?.currentCity.name).toBe('杭州')
  })
})
