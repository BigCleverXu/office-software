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

/** 第二个城市及切换后返回的状态 */
const OTHER_CITY: WeatherCity = {
  id: '330602',
  name: '越城',
  admin1: '浙江省',
  country: '中国',
  city: '绍兴市',
  district: '越城',
  latitude: 29.996992,
  longitude: 120.585312
}

/** 添加城市后主进程返回的视图状态 */
const NEXT_STATE: WeatherViewState = {
  cities: [{ ...CITY }],
  currentCity: { ...CITY },
  snapshot: null,
  status: 'ok',
  error: null
}

/** 切换到第二个城市后主进程返回的视图状态 */
const OTHER_STATE: WeatherViewState = {
  cities: [{ ...CITY }, { ...OTHER_CITY }],
  currentCity: { ...OTHER_CITY },
  snapshot: null,
  status: 'ok',
  error: null
}

/** 可手动控制完成时机的 Promise */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** 模拟的添加城市调用，用例内按需覆写返回值 */
const addCityApi = vi.fn<(city: WeatherCity) => Promise<WeatherViewState>>()

/** 模拟的切换城市调用，用例内按需覆写返回值 */
const selectCityApi = vi.fn<(cityId: string) => Promise<WeatherViewState>>()

/** 模拟 preload 暴露的 weather API */
function stubWeatherApi(): void {
  vi.stubGlobal('window', {
    api: {
      weather: {
        addCity: addCityApi,
        getState: async () => NEXT_STATE,
        search: async () => ({ ok: true, cities: [] }),
        selectCity: selectCityApi,
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
  selectCityApi.mockReset()
  selectCityApi.mockResolvedValue(NEXT_STATE)
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

describe('useWeather 切换态', () => {
  // state 是模块级共享，其他用例可能留下当前城市；
  // 置空可避免命中 selectCity 的「同城直接返回」分支
  beforeEach(() => {
    const { state } = useWeather()
    state.value = null
  })

  it('selectCity 立即标记目标城市并在完成后清理', async () => {
    const request = deferred<WeatherViewState>()
    selectCityApi.mockImplementationOnce(() => request.promise)
    const { selectCity, switchingCityId, switching, activeCityId, state } =
      useWeather()

    const task = selectCity('330602')

    expect(switchingCityId.value).toBe('330602')
    expect(switching.value).toBe(true)
    expect(activeCityId.value).toBe('330602')

    request.resolve(OTHER_STATE)
    await task

    expect(switchingCityId.value).toBeNull()
    expect(switching.value).toBe(false)
    expect(activeCityId.value).toBe('330602')
    expect(state.value).toEqual(OTHER_STATE)
  })

  it('selectCity 失败后清理并提示', async () => {
    selectCityApi.mockRejectedValueOnce(new Error('boom'))
    const { selectCity, switchingCityId, switching, error } = useWeather()

    await selectCity('330602')

    expect(switchingCityId.value).toBeNull()
    expect(switching.value).toBe(false)
    expect(error.value).toBe('切换城市失败，请稍后重试')
  })

  it('addCity 切换中同样有标记', async () => {
    const request = deferred<WeatherViewState>()
    addCityApi.mockImplementationOnce(() => request.promise)
    const { addCity, switchingCityId } = useWeather()

    const task = addCity(OTHER_CITY)

    expect(switchingCityId.value).toBe('330602')

    request.resolve(NEXT_STATE)
    await task

    expect(switchingCityId.value).toBeNull()
  })

  it('快速连续切换只保留最后一次', async () => {
    const first = deferred<WeatherViewState>()
    const second = deferred<WeatherViewState>()
    selectCityApi
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { selectCity, switchingCityId, state } = useWeather()

    const taskA = selectCity('330602')
    const taskB = selectCity('110105')

    expect(switchingCityId.value).toBe('110105')

    // 先返回的旧结果不得覆盖状态，也不能清掉最新的切换标记
    first.resolve(OTHER_STATE)
    await taskA
    expect(switchingCityId.value).toBe('110105')
    expect(state.value).toBeNull()

    second.resolve(NEXT_STATE)
    await taskB
    expect(switchingCityId.value).toBeNull()
    expect(state.value).toEqual(NEXT_STATE)
  })
})
