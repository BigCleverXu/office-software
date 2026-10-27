import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { WeatherCity, WeatherViewState } from '@shared/weather'

interface UseWeather {
  state: Ref<WeatherViewState | null>
  loading: ComputedRef<boolean>
  error: ComputedRef<string | null>
  keyword: Ref<string>
  results: Ref<WeatherCity[]>
  searching: Ref<boolean>
  searchError: Ref<string | null>
  load: () => Promise<void>
  refresh: () => Promise<void>
  selectCity: (cityId: string) => Promise<void>
  addCity: (city: WeatherCity) => Promise<void>
  removeCity: (cityId: string) => Promise<void>
  search: (value: string) => Promise<void>
  clearSearch: () => void
  subscribe: () => () => void
  /** 正在切换的目标城市 id，null 表示当前无切换 */
  switchingCityId: Ref<string | null>
  /** 是否正在切换城市 */
  switching: ComputedRef<boolean>
  /** 选中态城市 id：切换中取目标城市，避免点击后高亮滞后 */
  activeCityId: ComputedRef<string>
}

/** 城市搜索防抖间隔 */
const SEARCH_DELAY = 300

/**
 * 模块级共享状态：多个页面实例共享同一份天气数据，
 * 状态与函数统一在模块顶层声明。
 */
const state = ref<WeatherViewState | null>(null)
const keyword = ref('')
const results = ref<WeatherCity[]>([])
const searching = ref(false)
const searchError = ref<string | null>(null)

/** 本地 IPC 异常信息，优先于主进程返回的 state.error */
const localError = ref<string | null>(null)

/** 正在进行的 IPC 请求标记 */
const pending = ref(false)

/** 正在切换的目标城市 id，用于乐观高亮与加载反馈 */
const switchingCityId = ref<string | null>(null)

/** 切换序号：只有最后一次切换允许清理标记 */
let switchToken = 0

const switching = computed(() => switchingCityId.value !== null)

const activeCityId = computed(
  () => switchingCityId.value ?? state.value?.currentCity.id ?? ''
)

/** 标记切换开始，返回本次切换的序号 */
function beginSwitch(cityId: string): number {
  switchToken += 1
  switchingCityId.value = cityId
  return switchToken
}

/** 结束切换：仅当序号仍是最新时才清理，避免旧请求清掉新标记 */
function endSwitch(token: number): void {
  if (token === switchToken) {
    switchingCityId.value = null
  }
}

const loading = computed(
  () =>
    pending.value ||
    state.value?.status === 'loading' ||
    state.value?.status === 'refreshing'
)

const error = computed<string | null>(
  () => localError.value ?? state.value?.error ?? null
)

/** 首次进入时加载；已有数据或正在加载则直接返回 */
const load = async (): Promise<void> => {
  if (pending.value || state.value !== null) return
  pending.value = true
  localError.value = null
  try {
    state.value = await window.api.weather.getState()
  } catch {
    localError.value = '天气加载失败，请稍后重试'
  } finally {
    pending.value = false
  }
}

/** 强制刷新，用返回值覆盖状态 */
const refresh = async (): Promise<void> => {
  if (pending.value) return
  pending.value = true
  localError.value = null
  try {
    state.value = await window.api.weather.refresh()
  } catch {
    localError.value = '刷新失败，请稍后重试'
  } finally {
    pending.value = false
  }
}

/** 切换当前城市 */
const selectCity = async (cityId: string): Promise<void> => {
  if (cityId === state.value?.currentCity.id) return
  localError.value = null
  const token = beginSwitch(cityId)
  try {
    const next = await window.api.weather.selectCity(cityId)
    // 过期响应不覆盖状态，保证只展示最后一次选择
    if (token === switchToken) {
      state.value = next
    }
  } catch {
    if (token === switchToken) {
      localError.value = '切换城市失败，请稍后重试'
    }
  } finally {
    endSwitch(token)
  }
}

/** Vue 响应式对象无法通过 IPC 结构化克隆，先转为纯对象 */
function toPlainCity(city: WeatherCity): WeatherCity {
  return {
    id: city.id,
    name: city.name,
    admin1: city.admin1,
    country: city.country,
    latitude: city.latitude,
    longitude: city.longitude
  }
}

/** 添加城市并切换过去 */
const addCity = async (city: WeatherCity): Promise<void> => {
  localError.value = null
  const token = beginSwitch(city.id)
  try {
    const next = await window.api.weather.addCity(toPlainCity(city))
    // 过期响应不覆盖状态，保证只展示最后一次选择
    if (token === switchToken) {
      state.value = next
    }
  } catch {
    if (token === switchToken) {
      localError.value = '添加城市失败，请稍后重试'
    }
  } finally {
    endSwitch(token)
  }
}

/** 从城市列表移除 */
const removeCity = async (cityId: string): Promise<void> => {
  localError.value = null
  try {
    state.value = await window.api.weather.removeCity(cityId)
  } catch {
    localError.value = '删除城市失败，请稍后重试'
  }
}

/** 当前待搜索的关键词，防抖后再真正发起请求 */
let pendingKeyword = ''

/** 请求序号，丢弃过期响应 */
let searchToken = 0

const runSearch = useDebounceFn(async (): Promise<void> => {
  const value = pendingKeyword
  if (value.length === 0) return
  const token = searchToken + 1
  searchToken = token
  searching.value = true
  searchError.value = null
  try {
    const result = await window.api.weather.search(value)
    if (token !== searchToken) return
    if (result.ok) {
      results.value = result.cities
    } else {
      results.value = []
      searchError.value = '城市搜索失败，请稍后重试'
    }
  } catch {
    if (token !== searchToken) return
    results.value = []
    searchError.value = '城市搜索失败，请稍后重试'
  } finally {
    if (token === searchToken) {
      searching.value = false
    }
  }
}, SEARCH_DELAY)

/** 关键词为空时立即清空结果；否则进入防抖队列 */
const search = (value: string): Promise<void> => {
  keyword.value = value
  pendingKeyword = value.trim()
  if (pendingKeyword.length === 0) {
    searchToken += 1
    results.value = []
    searchError.value = null
    searching.value = false
    return Promise.resolve()
  }
  return runSearch()
}

/** 清空搜索结果与关键词 */
const clearSearch = (): void => {
  pendingKeyword = ''
  keyword.value = ''
  results.value = []
  searchError.value = null
  searching.value = false
  searchToken += 1
}

/** 订阅主进程广播，返回取消订阅函数 */
const subscribe = (): (() => void) =>
  window.api.weather.onStateChanged((next) => {
    state.value = next
  })

/** 天气数据的 composable，共享模块级状态 */
export function useWeather(): UseWeather {
  return {
    state,
    loading,
    error,
    keyword,
    results,
    searching,
    searchError,
    load,
    refresh,
    selectCity,
    addCity,
    removeCity,
    search,
    clearSearch,
    subscribe,
    switchingCityId,
    switching,
    activeCityId
  }
}
