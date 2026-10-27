<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Component } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import {
  AlertCircle,
  CloudOff,
  CloudRain,
  Droplets,
  Gauge,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  Sunrise,
  Sunset,
  Trash2,
  Wind
} from 'lucide-vue-next'
import { MAX_CITIES } from '@shared/weather'
import type { WeatherCity } from '@shared/weather'
import WeatherCurve from '@/components/WeatherCurve.vue'
import type { CurveSeries } from '@/components/WeatherCurve.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useWeather } from '@/composables/useWeather'
import {
  formatClock,
  formatTemperature,
  formatUpdatedAt,
  weatherVisual,
  windDirectionLabel
} from '@/lib/weather-visuals'

const {
  state,
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
} = useWeather()

/** 自动刷新间隔：10 分钟 */
const REFRESH_INTERVAL = 10 * 60 * 1000

/** 单次刷新进行中标记，避免重复点击 */
const busy = ref(false)

const snapshot = computed(() => state.value?.snapshot ?? null)
const currentCity = computed(() => state.value?.currentCity ?? null)
const cities = computed(() => state.value?.cities ?? [])
const status = computed(() => state.value?.status ?? 'loading')

const refreshing = computed(() => busy.value || status.value === 'refreshing')

const updatedLabel = computed(() =>
  formatUpdatedAt(snapshot.value?.updatedAt ?? null)
)

/** 副标题：省 · 市，同名（直辖市）只保留一项，缺省时回退国家 */
function regionMeta(city: WeatherCity): string {
  const parts = [city.admin1, city.city]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  const unique = parts.filter((item, index) => parts.indexOf(item) === index)
  return unique.length > 0 ? unique.join(' · ') : city.country
}

/** 当前城市行政信息，用于卡片副标题 */
const currentCityMeta = computed(() => {
  const city = currentCity.value
  return city ? regionMeta(city) : ''
})

const currentVisual = computed(() =>
  weatherVisual(
    snapshot.value?.current.weatherCode ?? -1,
    snapshot.value?.current.isDay ?? true
  )
)

const currentTemperature = computed(() =>
  formatTemperature(snapshot.value?.current.temperature ?? null)
)

const apparentTemperature = computed(() =>
  formatTemperature(snapshot.value?.current.apparentTemperature ?? null)
)

/** 当前天气指标栅格 */
interface WeatherMetric {
  key: string
  label: string
  value: string
  icon: Component
}

const metrics = computed<WeatherMetric[]>(() => {
  const current = snapshot.value?.current
  if (!current) return []
  return [
    {
      key: 'humidity',
      label: '湿度',
      value: `${Math.round(current.humidity)}%`,
      icon: Droplets
    },
    {
      key: 'wind',
      label: '风向风速',
      value:
        `${windDirectionLabel(current.windDirection)} ` +
        `${Math.round(current.windSpeed)} km/h`,
      icon: Wind
    },
    {
      key: 'pressure',
      label: '气压',
      value: `${Math.round(current.pressure)} hPa`,
      icon: Gauge
    },
    {
      key: 'precipitation',
      label: '降水量',
      value: `${current.precipitation.toFixed(1)} mm`,
      icon: CloudRain
    },
    {
      key: 'sunrise',
      label: '日出',
      value: formatClock(current.sunrise),
      icon: Sunrise
    },
    {
      key: 'sunset',
      label: '日落',
      value: formatClock(current.sunset),
      icon: Sunset
    }
  ]
})

/** 城市行的副标题 */
function cityMeta(city: WeatherCity): string {
  return regionMeta(city)
}

const cityRows = computed(() =>
  cities.value.map((city) => ({ city, meta: cityMeta(city) }))
)

const resultRows = computed(() =>
  results.value.map((city) => ({ city, meta: cityMeta(city) }))
)

/** 正在切换的目标城市名，用于加载文案 */
const switchingCityName = computed(() => {
  const id = switchingCityId.value
  if (!id) return ''
  return cities.value.find((entry) => entry.id === id)?.name ?? '该地区'
})

/** 天气内容的动画标识：城市或更新时间变化时重挂载触发淡入 */
const contentKey = computed(() =>
  snapshot.value
    ? `${snapshot.value.city.id}-${snapshot.value.updatedAt}`
    : 'empty'
)

const hourly = computed(() => snapshot.value?.hourly ?? [])

const hourlyLabels = computed(() =>
  hourly.value.map((point) => formatClock(point.time))
)

const hourlyPrecipitation = computed(() =>
  hourly.value.map((point) => Math.round(point.precipitationProbability))
)

const hourlySeries = computed<CurveSeries[]>(() => {
  if (hourly.value.length === 0) return []
  return [
    {
      key: 'temperature',
      label: '温度',
      values: hourly.value.map((point) => point.temperature),
      color: 'var(--color-foreground)',
      area: true,
      showValues: true
    }
  ]
})

const daily = computed(() => snapshot.value?.daily ?? [])

const dailyLabels = computed(() => daily.value.map((day) => day.weekday))

const dailySeries = computed<CurveSeries[]>(() => {
  if (daily.value.length === 0) return []
  return [
    {
      key: 'max',
      label: '最高温',
      values: daily.value.map((day) => day.temperatureMax),
      color: 'var(--color-foreground)',
      showValues: true
    },
    {
      key: 'min',
      label: '最低温',
      values: daily.value.map((day) => day.temperatureMin),
      color: 'var(--color-muted-foreground)',
      showValues: true
    }
  ]
})

const dailyRows = computed(() =>
  daily.value.map((day) => ({
    key: day.date,
    weekday: day.weekday,
    dateLabel: day.date.slice(5),
    visual: weatherVisual(day.weatherCode, true),
    probability: Math.round(day.precipitationProbability),
    sum: day.precipitationSum.toFixed(1),
    max: formatTemperature(day.temperatureMax),
    min: formatTemperature(day.temperatureMin)
  }))
)

/** 首次加载且无快照时展示骨架；加载失败则直接展示错误态 */
const showSkeleton = computed(
  () =>
    snapshot.value === null &&
    error.value === null &&
    (state.value === null || status.value === 'loading')
)

/** 已有快照但刷新失败时展示可重试提示条 */
const showBanner = computed(
  () =>
    snapshot.value !== null &&
    (error.value !== null || status.value === 'failed')
)

const errorMessage = computed(
  () => error.value ?? '天气数据获取失败，请稍后重试'
)

/** 无快照时的引导文案：城市列表为空时引导搜索，否则提示重试 */
const emptyHint = computed(() =>
  cities.value.length === 0
    ? '搜索并固定一个地区，即可查看天气'
    : errorMessage.value
)

const handleRefresh = async (): Promise<void> => {
  if (busy.value) return
  busy.value = true
  try {
    await refresh()
  } finally {
    busy.value = false
  }
}

const handleKeywordInput = (value: string | number): void => {
  void search(String(value))
}

const handleSelectCity = (cityId: string): void => {
  void selectCity(cityId)
}

const handleAddCity = async (city: WeatherCity): Promise<void> => {
  await addCity(city)
  clearSearch()
}

const handleRemoveCity = (cityId: string): void => {
  void removeCity(cityId)
}

const { pause, resume } = useIntervalFn(
  () => {
    void refresh()
  },
  REFRESH_INTERVAL,
  { immediate: false }
)

let unsubscribe: (() => void) | null = null

onMounted(() => {
  void load()
  unsubscribe = subscribe()
  resume()
})

onUnmounted(() => {
  pause()
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <div class="flex h-full flex-col gap-4 overflow-y-auto p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <LoaderCircle
          v-if="switching"
          class="text-muted-foreground size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <MapPin
          v-else
          class="text-muted-foreground size-4 shrink-0"
          aria-hidden="true"
        />
        <span class="truncate text-sm font-medium">
          {{ cities.length > 0 ? (currentCity?.name ?? '--') : '未选择地区' }}
        </span>
        <span v-if="switching" class="text-muted-foreground truncate text-xs">
          正在获取 {{ switchingCityName }} 天气…
        </span>
        <span
          v-else-if="snapshot"
          class="text-muted-foreground truncate text-xs"
        >
          {{ updatedLabel }}
        </span>
      </div>

      <Button
        variant="outline"
        size="sm"
        :disabled="refreshing || switching || cities.length === 0"
        @click="handleRefresh"
      >
        <RefreshCw
          data-icon="inline-start"
          class="motion-reduce:animate-none"
          :class="{ 'animate-spin': refreshing }"
        />
        刷新
      </Button>
    </div>

    <div
      v-if="showBanner"
      class="border-destructive/30 bg-destructive/5 text-destructive flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 text-xs"
    >
      <span class="flex min-w-0 items-center gap-2">
        <AlertCircle class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ errorMessage }}</span>
      </span>
      <Button
        variant="outline"
        size="sm"
        :disabled="refreshing || switching"
        @click="handleRefresh"
      >
        重试
      </Button>
    </div>

    <div
      v-if="showSkeleton"
      class="stagger-list grid gap-4 xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]"
      role="status"
      aria-busy="true"
    >
      <span class="sr-only">正在加载天气</span>
      <Card class="skeleton-shimmer h-72"></Card>
      <div class="flex flex-col gap-4">
        <Card class="skeleton-shimmer h-64"></Card>
        <Card class="skeleton-shimmer h-80"></Card>
      </div>
    </div>

    <div
      v-else
      class="grid gap-4 xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]"
    >
      <div class="stagger-list flex min-w-0 flex-col gap-4">
        <section
          v-if="snapshot"
          :key="contentKey"
          class="card-interactive shadow-soft relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br p-5"
          :class="currentVisual.gradient"
        >
          <div
            class="transition-opacity duration-200 ease-out"
            :class="switching ? 'opacity-40' : 'opacity-100'"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">
                  {{ snapshot.city.name }}
                </p>
                <p class="text-muted-foreground truncate text-xs">
                  {{ currentCityMeta }}
                </p>
              </div>
            </div>

            <div class="mt-4 flex items-center gap-3">
              <component
                :is="currentVisual.icon"
                class="size-10 shrink-0"
                aria-hidden="true"
              />
              <div class="min-w-0">
                <p class="text-5xl leading-none font-semibold tracking-tighter">
                  {{ currentTemperature }}
                </p>
                <p class="text-muted-foreground mt-1 text-xs">
                  {{ currentVisual.label }} · 体感 {{ apparentTemperature }}
                </p>
              </div>
            </div>

            <dl class="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
              <div
                v-for="metric in metrics"
                :key="metric.key"
                class="flex min-w-0 flex-col gap-0.5"
              >
                <dt
                  class="text-muted-foreground flex items-center gap-1 text-[11px]"
                >
                  <component
                    :is="metric.icon"
                    class="size-3 shrink-0"
                    aria-hidden="true"
                  />
                  {{ metric.label }}
                </dt>
                <dd class="truncate text-sm tabular-nums">
                  {{ metric.value }}
                </dd>
              </div>
            </dl>
          </div>

          <div
            v-if="switching"
            class="bg-background/55 absolute inset-0 flex flex-col items-center justify-center gap-2 backdrop-blur-[2px]"
            role="status"
          >
            <LoaderCircle
              class="size-6 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p class="text-muted-foreground text-xs">
              正在获取 {{ switchingCityName }} 天气…
            </p>
          </div>
        </section>

        <section
          class="bg-card shadow-soft rounded-2xl border border-border/70 p-4"
        >
          <div class="relative">
            <Search
              class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              :model-value="keyword"
              class="pl-8"
              placeholder="搜索城市，如「杭州」"
              aria-label="搜索城市"
              @update:model-value="handleKeywordInput"
            />
          </div>

          <p v-if="searchError" class="text-destructive mt-2 text-xs">
            {{ searchError }}
          </p>
          <p v-else-if="searching" class="text-muted-foreground mt-2 text-xs">
            正在搜索…
          </p>
          <ul
            v-else-if="resultRows.length > 0"
            class="mt-2 max-h-64 overflow-y-auto"
          >
            <li v-for="row in resultRows" :key="row.city.id">
              <Button
                variant="ghost"
                size="sm"
                class="h-auto w-full justify-between gap-2 px-2 py-2 font-normal transition-transform duration-150 active:scale-[0.99]"
                :disabled="switching"
                @click="handleAddCity(row.city)"
              >
                <span class="flex min-w-0 items-center gap-1.5">
                  <LoaderCircle
                    v-if="row.city.id === switchingCityId"
                    class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ row.city.name }}</span>
                </span>
                <span
                  v-if="row.meta"
                  class="text-muted-foreground shrink-0 truncate text-xs"
                >
                  {{ row.meta }}
                </span>
              </Button>
            </li>
          </ul>
        </section>

        <section
          class="bg-card shadow-soft rounded-2xl border border-border/70 p-4"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-sm font-medium">我的城市</p>
            <span class="text-muted-foreground text-xs">
              {{ cities.length }} / {{ MAX_CITIES }}
            </span>
          </div>

          <div v-if="cityRows.length > 0" class="flex flex-col gap-1">
            <div
              v-for="row in cityRows"
              :key="row.city.id"
              class="group flex items-center gap-1 rounded-lg pr-1"
              :class="
                row.city.id === activeCityId
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted/60'
              "
            >
              <Button
                variant="ghost"
                size="sm"
                class="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 font-normal transition-transform duration-150 active:scale-[0.99]"
                @click="handleSelectCity(row.city.id)"
              >
                <LoaderCircle
                  v-if="row.city.id === switchingCityId"
                  class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <MapPin
                  v-else
                  class="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span class="truncate text-sm">{{ row.city.name }}</span>
                <span
                  v-if="row.meta"
                  class="text-muted-foreground truncate text-xs"
                >
                  {{ row.meta }}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                class="app-no-drag text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                :aria-label="`删除 ${row.city.name}`"
                @click="handleRemoveCity(row.city.id)"
              >
                <Trash2 />
              </Button>
            </div>
          </div>

          <div v-else class="empty-state text-muted-foreground py-8">
            <span class="empty-state-icon">
              <MapPin class="size-5" aria-hidden="true" />
            </span>
            <p class="text-xs">搜索并固定一个地区吧</p>
          </div>
        </section>
      </div>

      <div class="stagger-list relative flex min-w-0 flex-col gap-4">
        <div :key="contentKey" class="relative flex flex-col gap-4">
          <div
            class="flex flex-col gap-4 transition-opacity duration-200 ease-out"
            :class="switching ? 'opacity-40' : 'opacity-100'"
          >
            <template v-if="snapshot">
              <section
                class="bg-card shadow-soft rounded-2xl border border-border/70 p-4"
              >
                <div
                  class="mb-2 flex flex-wrap items-baseline justify-between gap-2"
                >
                  <p class="text-sm font-medium">未来 24 小时</p>
                  <span class="text-muted-foreground text-xs">
                    温度与降水概率
                  </span>
                </div>

                <WeatherCurve
                  v-if="hourlySeries.length > 0"
                  :labels="hourlyLabels"
                  :series="hourlySeries"
                  :precipitation="hourlyPrecipitation"
                  :height="200"
                />
                <div v-else class="empty-state text-muted-foreground py-10">
                  <span class="empty-state-icon">
                    <CloudOff class="size-5" aria-hidden="true" />
                  </span>
                  <p class="text-xs">暂无逐时预报</p>
                </div>
              </section>

              <section
                class="bg-card shadow-soft rounded-2xl border border-border/70 p-4"
              >
                <div
                  class="mb-2 flex flex-wrap items-baseline justify-between gap-2"
                >
                  <p class="text-sm font-medium">7 天预报</p>
                  <span class="text-muted-foreground text-xs">
                    最高 / 最低温
                  </span>
                </div>

                <WeatherCurve
                  v-if="dailySeries.length > 0"
                  :labels="dailyLabels"
                  :series="dailySeries"
                  :height="180"
                />

                <ul
                  v-if="dailyRows.length > 0"
                  class="mt-3 flex flex-col divide-y divide-border/60"
                >
                  <li
                    v-for="day in dailyRows"
                    :key="day.key"
                    class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                  >
                    <span class="w-10 text-sm font-medium">
                      {{ day.weekday }}
                    </span>
                    <span
                      class="text-muted-foreground w-12 text-xs tabular-nums"
                    >
                      {{ day.dateLabel }}
                    </span>
                    <span class="flex min-w-0 flex-1 items-center gap-1.5">
                      <component
                        :is="day.visual.icon"
                        class="size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span class="truncate text-sm">
                        {{ day.visual.label }}
                      </span>
                    </span>
                    <span
                      class="text-muted-foreground flex items-center gap-1 text-xs tabular-nums"
                    >
                      <Droplets class="size-3" aria-hidden="true" />
                      {{ day.probability }}% · {{ day.sum }} mm
                    </span>
                    <span class="w-16 text-right text-sm tabular-nums">
                      <span class="font-medium">{{ day.max }}</span>
                      <span class="text-muted-foreground">
                        / {{ day.min }}
                      </span>
                    </span>
                  </li>
                </ul>

                <div v-else class="empty-state text-muted-foreground py-10">
                  <span class="empty-state-icon">
                    <CloudOff class="size-5" aria-hidden="true" />
                  </span>
                  <p class="text-xs">暂无逐日预报</p>
                </div>
              </section>
            </template>

            <section
              v-else
              class="bg-card shadow-soft empty-state text-muted-foreground rounded-2xl border border-border/70 px-6 py-16"
            >
              <span class="empty-state-icon">
                <CloudOff class="size-6" aria-hidden="true" />
              </span>
              <p class="text-sm">{{ emptyHint }}</p>
              <Button
                v-if="cities.length > 0"
                variant="outline"
                size="sm"
                :disabled="refreshing"
                @click="handleRefresh"
              >
                <RefreshCw data-icon="inline-start" />
                重试
              </Button>
            </section>
          </div>

          <div
            v-if="switching"
            class="bg-background/55 absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl backdrop-blur-[2px]"
            role="status"
          >
            <LoaderCircle
              class="size-6 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p class="text-muted-foreground text-xs">
              正在获取 {{ switchingCityName }} 天气…
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
