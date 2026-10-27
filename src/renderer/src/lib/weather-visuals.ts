// 天气可视化映射：WMO 天气码 → 图标 / 文案 / 渐变，以及格式化工具

import type { Component } from 'vue'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Moon,
  Sun
} from 'lucide-vue-next'

/** 单个天气现象的展示信息 */
export interface WeatherVisual {
  /** 中文天气现象，如「晴」「小雨」 */
  label: string
  /** lucide-vue-next 图标组件 */
  icon: Component
  /** 图标与图例的 Tailwind 文本颜色类 */
  tone: string
  /** 卡片背景渐变工具类，如 'from-weather-sun/25 …' */
  gradient: string
}

/** 卡片渐变使用天气色彩令牌，按现象类型着色 */
const GRADIENTS = {
  clear: 'from-weather-sun/25 via-weather-rain/10 to-transparent',
  clearNight: 'from-weather-moon/25 via-weather-dusk/10 to-transparent',
  partly: 'from-weather-sun/20 via-weather-cloud/20 to-transparent',
  partlyNight: 'from-weather-moon/20 via-weather-cloud/15 to-transparent',
  overcast: 'from-weather-fog/25 via-weather-cloud/20 to-transparent',
  fog: 'from-weather-fog/30 via-weather-cloud/20 to-transparent',
  rain: 'from-weather-rain/25 via-weather-snow/10 to-transparent',
  snow: 'from-weather-snow/30 via-weather-rain/10 to-transparent',
  storm: 'from-weather-dusk/25 via-weather-bolt/15 to-transparent',
  unknown: 'from-weather-fog/15 via-weather-cloud/10 to-transparent'
}

/** 八方位中文名，索引与 45° 扇区一一对应 */
const WIND_LABELS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

/** 不可用数值的统一占位 */
const PLACEHOLDER = '--'

/** 逐天预报时间格式的兜底值 */
const CLOCK_PLACEHOLDER = '--:--'

/** 天气码 → 图标 / 中文文案 / 色调 / 渐变 */
export function weatherVisual(code: number, isDay?: boolean): WeatherVisual {
  const day = isDay !== false

  if (code === 0) {
    return {
      label: '晴',
      icon: day ? Sun : Moon,
      tone: day ? 'text-weather-sun' : 'text-weather-moon',
      gradient: day ? GRADIENTS.clear : GRADIENTS.clearNight
    }
  }
  if (code === 1) {
    return {
      label: '少云',
      icon: day ? CloudSun : CloudMoon,
      tone: day ? 'text-weather-sun' : 'text-weather-moon',
      gradient: day ? GRADIENTS.partly : GRADIENTS.partlyNight
    }
  }
  if (code === 2) {
    return {
      label: '多云',
      icon: day ? CloudSun : CloudMoon,
      tone: day ? 'text-weather-sun' : 'text-weather-moon',
      gradient: day ? GRADIENTS.partly : GRADIENTS.partlyNight
    }
  }
  if (code === 3) {
    return {
      label: '阴',
      icon: Cloudy,
      tone: 'text-weather-fog',
      gradient: GRADIENTS.overcast
    }
  }
  if (code === 45 || code === 48) {
    return {
      label: '雾',
      icon: CloudFog,
      tone: 'text-weather-fog',
      gradient: GRADIENTS.fog
    }
  }
  if (code === 51 || code === 53 || code === 55) {
    return {
      label: '毛毛雨',
      icon: CloudDrizzle,
      tone: 'text-weather-rain',
      gradient: GRADIENTS.rain
    }
  }
  if (code === 56 || code === 57) {
    return {
      label: '冻毛毛雨',
      icon: CloudDrizzle,
      tone: 'text-weather-rain',
      gradient: GRADIENTS.rain
    }
  }
  if (code === 61) {
    return {
      label: '小雨',
      icon: CloudRain,
      tone: 'text-weather-rain',
      gradient: GRADIENTS.rain
    }
  }
  if (code === 63) {
    return {
      label: '中雨',
      icon: CloudRain,
      tone: 'text-weather-rain',
      gradient: GRADIENTS.rain
    }
  }
  if (code === 65) {
    return {
      label: '大雨',
      icon: CloudRain,
      tone: 'text-weather-rain',
      gradient: GRADIENTS.rain
    }
  }
  if (code === 66 || code === 67) {
    return {
      label: '冻雨',
      icon: CloudRain,
      tone: 'text-weather-rain',
      gradient: GRADIENTS.rain
    }
  }
  if (code === 80 || code === 81 || code === 82) {
    return {
      label: '阵雨',
      icon: CloudRain,
      tone: 'text-weather-rain',
      gradient: GRADIENTS.rain
    }
  }
  if (code === 71 || code === 73 || code === 75) {
    return {
      label: '雪',
      icon: CloudSnow,
      tone: 'text-weather-snow',
      gradient: GRADIENTS.snow
    }
  }
  if (code === 77) {
    return {
      label: '米雪',
      icon: CloudSnow,
      tone: 'text-weather-snow',
      gradient: GRADIENTS.snow
    }
  }
  if (code === 85 || code === 86) {
    return {
      label: '阵雪',
      icon: CloudSnow,
      tone: 'text-weather-snow',
      gradient: GRADIENTS.snow
    }
  }
  if (code === 95) {
    return {
      label: '雷阵雨',
      icon: CloudLightning,
      tone: 'text-weather-dusk',
      gradient: GRADIENTS.storm
    }
  }
  if (code === 96 || code === 99) {
    return {
      label: '雷暴冰雹',
      icon: CloudLightning,
      tone: 'text-weather-dusk',
      gradient: GRADIENTS.storm
    }
  }
  return {
    label: '未知',
    icon: Cloud,
    tone: 'text-weather-fog',
    gradient: GRADIENTS.unknown
  }
}

/** 风向角度 → 八方位中文名，非法数字返回占位 */
export function windDirectionLabel(degrees: number): string {
  if (!Number.isFinite(degrees)) return PLACEHOLDER
  const index = ((Math.round(degrees / 45) % 8) + 8) % 8
  return WIND_LABELS[index]
}

/** 温度格式化：四舍五入后加度符号 */
export function formatTemperature(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return PLACEHOLDER
  }
  return `${Math.round(value)}°`
}

/** 从 ISO 时间或 'HH:mm' 中取时钟部分 */
export function formatClock(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    return CLOCK_PLACEHOLDER
  }
  const matched = /(\d{2}):(\d{2})/.exec(value)
  if (!matched) return CLOCK_PLACEHOLDER
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  if (hour > 23 || minute > 59) return CLOCK_PLACEHOLDER
  return `${matched[1]}:${matched[2]}`
}

/** 最近刷新时间：1 分钟内显示「刚刚更新」，其余显示本地时钟 */
export function formatUpdatedAt(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return PLACEHOLDER
  }
  const now = Date.now()
  const diff = now - timestamp
  if (diff >= 0 && diff < 60_000) {
    return '刚刚更新'
  }
  const date = new Date(timestamp)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute} 更新`
}
