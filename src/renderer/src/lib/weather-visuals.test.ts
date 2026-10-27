import { describe, expect, it } from 'vitest'
import { Cloud, CloudLightning, CloudRain, Moon, Sun } from 'lucide-vue-next'
import {
  formatClock,
  formatTemperature,
  formatUpdatedAt,
  weatherVisual,
  windDirectionLabel
} from './weather-visuals'

describe('weatherVisual', () => {
  it('0 白天使用太阳图标', () => {
    const visual = weatherVisual(0, true)
    expect(visual.label).toBe('晴')
    expect(visual.icon).toBe(Sun)
  })

  it('0 夜间使用月亮图标', () => {
    const visual = weatherVisual(0, false)
    expect(visual.label).toBe('晴')
    expect(visual.icon).toBe(Moon)
  })

  it('61 映射为小雨与降雨图标', () => {
    const visual = weatherVisual(61)
    expect(visual.label).toBe('小雨')
    expect(visual.icon).toBe(CloudRain)
  })

  it('95 映射为雷阵雨与雷暴图标', () => {
    const visual = weatherVisual(95)
    expect(visual.label).toBe('雷阵雨')
    expect(visual.icon).toBe(CloudLightning)
  })

  it('未知码回退到云图标与未知文案', () => {
    const visual = weatherVisual(999)
    expect(visual.label).toBe('未知')
    expect(visual.icon).toBe(Cloud)
  })
})

describe('windDirectionLabel', () => {
  it('0 度为北', () => {
    expect(windDirectionLabel(0)).toBe('北')
  })

  it('90 度为东', () => {
    expect(windDirectionLabel(90)).toBe('东')
  })

  it('225 度为西南', () => {
    expect(windDirectionLabel(225)).toBe('西南')
  })

  it('非法数字返回占位', () => {
    expect(windDirectionLabel(Number.NaN)).toBe('--')
    expect(windDirectionLabel(Number.POSITIVE_INFINITY)).toBe('--')
  })
})

describe('formatTemperature', () => {
  it('四舍五入后加度符号', () => {
    expect(formatTemperature(18.6)).toBe('19°')
  })

  it('空值返回占位', () => {
    expect(formatTemperature(null)).toBe('--')
    expect(formatTemperature(undefined)).toBe('--')
  })
})

describe('formatClock', () => {
  it('从 ISO 时间中取时钟', () => {
    expect(formatClock('2026-10-27T06:31')).toBe('06:31')
  })

  it('直接接受 HH:mm', () => {
    expect(formatClock('06:31')).toBe('06:31')
  })

  it('无法解析时返回占位', () => {
    expect(formatClock('2026-10-27')).toBe('--:--')
    expect(formatClock(null)).toBe('--:--')
  })
})

describe('formatUpdatedAt', () => {
  it('空值返回占位', () => {
    expect(formatUpdatedAt(null)).toBe('--')
  })
})
