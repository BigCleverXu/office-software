<script lang="ts">
/** 折线序列配置 */
export interface CurveSeries {
  key: string
  label: string
  values: number[]
  /** 颜色，传 CSS 变量字符串，如 'var(--color-foreground)' */
  color: string
  /** 是否绘制渐变面积，默认 false */
  area?: boolean
  /** 是否在数据点上标注数值，默认 false */
  showValues?: boolean
}

/** 图表内边距与固定画布宽度 */
export const CURVE_VIEWBOX_WIDTH = 720
</script>

<script setup lang="ts">
import { computed, useId } from 'vue'
import { formatTemperature } from '@/lib/weather-visuals'

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: CurveSeries[]
    /** 降水概率 0-100，可选；传入则绘制底部柱状图 */
    precipitation?: number[]
    /** 图表高度，默认 200 */
    height?: number
  }>(),
  {
    precipitation: () => [],
    height: 200
  }
)

/** 绘图区留白：上留数值标注位，下留时间刻度位 */
const PAD_LEFT = 24
const PAD_RIGHT = 24
const PAD_TOP = 24
const PAD_BOTTOM = 26

/** 保留两位小数，避免路径字符串过长 */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** 数据点坐标 */
interface CurvePoint {
  x: number
  y: number
  value: number
}

/** 是否有可绘制的数据 */
const hasData = computed(
  () =>
    props.series.length > 0 &&
    props.series.some((item) => item.values.length > 0)
)

/** 横轴点位数 */
const pointCount = computed(() => {
  const lengths = props.series.map((item) => item.values.length)
  return Math.max(props.labels.length, ...lengths, 1)
})

/** 绘图区尺寸 */
const plot = computed(() => ({
  width: CURVE_VIEWBOX_WIDTH - PAD_LEFT - PAD_RIGHT,
  height: Math.max(props.height - PAD_TOP - PAD_BOTTOM, 1),
  bottom: props.height - PAD_BOTTOM
}))

/** 纵轴范围：所有序列共用一个刻度，上下各留 15% 余量 */
const range = computed(() => {
  const values: number[] = []
  for (const item of props.series) {
    for (const value of item.values) {
      if (Number.isFinite(value)) values.push(value)
    }
  }
  if (values.length === 0) {
    return { min: 0, max: 1 }
  }
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const span = rawMax - rawMin
  const pad = span === 0 ? 1 : span * 0.15
  return { min: rawMin - pad, max: rawMax + pad }
})

/** 第 index 个点的横坐标 */
function xAt(index: number): number {
  if (pointCount.value <= 1) {
    return PAD_LEFT + plot.value.width / 2
  }
  return PAD_LEFT + (index / (pointCount.value - 1)) * plot.value.width
}

/** 数值对应的纵坐标 */
function yAt(value: number): number {
  const { min, max } = range.value
  if (max <= min) return PAD_TOP + plot.value.height / 2
  return PAD_TOP + ((max - value) / (max - min)) * plot.value.height
}

/** 生成平滑折线路径：相邻点的中点作为三次贝塞尔控制点 */
function buildLinePath(points: CurvePoint[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]
    const current = points[index]
    const midX = round((prev.x + current.x) / 2)
    const midY = round((prev.y + current.y) / 2)
    path += ` C ${midX} ${midY}, ${midX} ${midY}, ${current.x} ${current.y}`
  }
  return path
}

/** 面积路径：折线闭合到底部基线 */
function buildAreaPath(points: CurvePoint[]): string {
  if (points.length < 2) return ''
  const line = buildLinePath(points)
  const first = points[0]
  const last = points[points.length - 1]
  const baseline = plot.value.bottom
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`
}

/** 实例级 id 前缀，避免多实例渐变冲突 */
const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '')

/** 每个序列的渐变 id */
function gradientId(key: string): string {
  return `weather-curve-${instanceId}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

/** 降水柱渐变 id，同样做实例隔离 */
const barGradientId = `weather-curve-${instanceId}-precip`

/** 序列视图：点位、路径与渐变引用 */
const seriesViews = computed(() =>
  props.series.map((item) => {
    const points: CurvePoint[] = item.values.map((value, index) => ({
      x: round(xAt(index)),
      y: round(yAt(value)),
      value
    }))
    const linePath = buildLinePath(points)
    return {
      key: item.key,
      label: item.label,
      color: item.color,
      showValues: item.showValues === true,
      linePath,
      areaPath: item.area === true ? buildAreaPath(points) : '',
      fill: `url(#${gradientId(item.key)})`,
      points
    }
  })
)

/** 面积渐变定义，仅取有面积路径的序列 */
const areaViews = computed(() =>
  seriesViews.value.filter((view) => view.areaPath.length > 0)
)

/** 降水柱：高度按概率占图表高度 25% 绘制 */
const precipitationBars = computed(() => {
  const source = props.precipitation ?? []
  const count = Math.max(props.labels.length, 1)
  if (source.length === 0) return []
  const slot = plot.value.width / count
  const barWidth = Math.min(14, slot * 0.5)
  const maxBarHeight = props.height * 0.25
  return source.slice(0, count).map((value, index) => {
    const probability = Math.min(Math.max(value, 0), 100)
    const barHeight = round((probability / 100) * maxBarHeight)
    return {
      key: `${index}-${probability}`,
      x: round(PAD_LEFT + slot * (index + 0.5) - barWidth / 2),
      y: round(plot.value.bottom - barHeight),
      width: round(barWidth),
      height: barHeight
    }
  })
})

/** 时间刻度：按等距抽样，避免文字重叠 */
const tickViews = computed(() => {
  const step = Math.max(Math.ceil(props.labels.length / 8), 1)
  const views: { key: string; label: string; x: number }[] = []
  for (let index = 0; index < props.labels.length; index += step) {
    views.push({
      key: `${index}-${props.labels[index]}`,
      label: props.labels[index],
      x: round(xAt(index))
    })
  }
  return views
})
</script>

<template>
  <div v-if="hasData" class="flex flex-col gap-2">
    <div
      v-if="series.length > 1"
      class="text-muted-foreground flex flex-wrap items-center gap-3 text-xs"
    >
      <span
        v-for="item in series"
        :key="item.key"
        class="flex items-center gap-1.5"
      >
        <svg viewBox="0 0 10 10" class="size-2.5" aria-hidden="true">
          <circle cx="5" cy="5" r="4" :fill="item.color" />
        </svg>
        {{ item.label }}
      </span>
    </div>

    <svg
      :viewBox="`0 0 ${CURVE_VIEWBOX_WIDTH} ${height}`"
      class="w-full"
      role="img"
    >
      <title>温度趋势图</title>

      <defs>
        <linearGradient
          v-for="view in areaViews"
          :id="gradientId(view.key)"
          :key="view.key"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" :stop-color="view.color" stop-opacity="0.25" />
          <stop offset="100%" :stop-color="view.color" stop-opacity="0" />
        </linearGradient>

        <linearGradient :id="barGradientId" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stop-color="var(--color-weather-rain)"
            stop-opacity="0.55"
          />
          <stop
            offset="100%"
            stop-color="var(--color-weather-rain)"
            stop-opacity="0.12"
          />
        </linearGradient>
      </defs>

      <g>
        <rect
          v-for="bar in precipitationBars"
          :key="bar.key"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          rx="2"
          :fill="`url(#${barGradientId})`"
        />
      </g>

      <path
        v-for="view in areaViews"
        :key="`area-${view.key}`"
        :d="view.areaPath"
        :fill="view.fill"
      />

      <path
        v-for="view in seriesViews"
        :key="`line-${view.key}`"
        :d="view.linePath"
        fill="none"
        :stroke="view.color"
        stroke-width="2"
        stroke-linecap="round"
      />

      <g v-for="view in seriesViews" :key="`points-${view.key}`">
        <circle
          v-for="(point, index) in view.points"
          :key="`${view.key}-point-${index}`"
          :cx="point.x"
          :cy="point.y"
          r="3"
          :fill="view.color"
        />
      </g>

      <g v-for="view in seriesViews" :key="`values-${view.key}`">
        <template v-if="view.showValues">
          <text
            v-for="(point, index) in view.points"
            :key="`${view.key}-value-${index}`"
            :x="point.x"
            :y="point.y - 8"
            text-anchor="middle"
            fill="var(--color-muted-foreground)"
            font-size="11"
          >
            {{ formatTemperature(point.value) }}
          </text>
        </template>
      </g>

      <g>
        <text
          v-for="tick in tickViews"
          :key="tick.key"
          :x="tick.x"
          :y="height - 8"
          text-anchor="middle"
          fill="var(--color-muted-foreground)"
          font-size="11"
        >
          {{ tick.label }}
        </text>
      </g>
    </svg>
  </div>
</template>
