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
    expect(visual.tone).toBe('text-weather-sun')
    expect(visual.gradient).toContain('weather-sun')
  })

  it('0 夜间使用月亮图标', () => {
    const visual = weatherVisual(0, false)
    expect(visual.label).toBe('晴')
    expect(visual.icon).toBe(Moon)
    expect(visual.tone).toBe('text-weather-moon')
    expect(visual.gradient).toContain('weather-moon')
  })

  it('61 映射为小雨与降雨图标', () => {
    const visual = weatherVisual(61)
    expect(visual.label).toBe('小雨')
    expect(visual.icon).toBe(CloudRain)
    expect(visual.tone).toBe('text-weather-rain')
    expect(visual.gradient).toContain('weather-rain')
  })

  it('95 映射为雷阵雨与雷暴图标', () => {
    const visual = weatherVisual(95)
    expect(visual.label).toBe('雷阵雨')
    expect(visual.icon).toBe(CloudLightning)
    expect(visual.tone).toBe('text-weather-dusk')
    expect(visual.gradient).toContain('weather-bolt')
  })

  it('未知码回退到云图标与未知文案', () => {
    const visual = weatherVisual(999)
    expect(visual.label).toBe('未知')
    expect(visual.icon).toBe(Cloud)
    expect(visual.tone).toBe('text-weather-fog')
    expect(visual.gradient).toContain('weather-cloud')
  })

  it('1 / 2 白天与夜间分别使用日照与月色色调', () => {
    expect(weatherVisual(1, true).tone).toBe('text-weather-sun')
    expect(weatherVisual(1, true).gradient).toContain('weather-sun')
    expect(weatherVisual(2, true).tone).toBe('text-weather-sun')
    expect(weatherVisual(1, false).tone).toBe('text-weather-moon')
    expect(weatherVisual(1, false).gradient).toContain('weather-moon')
    expect(weatherVisual(2, false).tone).toBe('text-weather-moon')
  })

  it('3 阴天使用雾色色调与阴天渐变', () => {
    const visual = weatherVisual(3)
    expect(visual.label).toBe('阴')
    expect(visual.tone).toBe('text-weather-fog')
    expect(visual.gradient).toContain('weather-fog')
  })

  it('45 / 48 雾使用雾色色调与雾渐变', () => {
    expect(weatherVisual(45).tone).toBe('text-weather-fog')
    expect(weatherVisual(45).gradient).toContain('weather-fog')
    expect(weatherVisual(48).tone).toBe('text-weather-fog')
    expect(weatherVisual(48).gradient).toContain('weather-cloud')
  })

  it('毛毛雨 / 冻雨 / 阵雨归为降雨色调', () => {
    const codes = [51, 53, 55, 56, 57, 63, 65, 66, 67, 80, 81, 82]
    for (const code of codes) {
      const visual = weatherVisual(code)
      expect(visual.tone).toBe('text-weather-rain')
      expect(visual.gradient).toContain('weather-rain')
    }
  })

  it('各种雪归为降雪色调', () => {
    const codes = [71, 73, 75, 77, 85, 86]
    for (const code of codes) {
      const visual = weatherVisual(code)
      expect(visual.tone).toBe('text-weather-snow')
      expect(visual.gradient).toContain('weather-snow')
    }
  })

  it('96 / 99 归为雷暴色调与黄昏渐变', () => {
    expect(weatherVisual(96).tone).toBe('text-weather-dusk')
    expect(weatherVisual(96).gradient).toContain('weather-dusk')
    expect(weatherVisual(99).tone).toBe('text-weather-dusk')
    expect(weatherVisual(99).gradient).toContain('weather-bolt')
  })

  it('所有分支的渐变都使用天气色彩而非灰阶', () => {
    const codes = [0, 1, 2, 3, 45, 48, 51, 56, 61, 66, 71, 77, 80, 85, 95]
    for (const code of codes) {
      expect(weatherVisual(code, true).gradient).not.toContain('foreground')
      expect(weatherVisual(code, false).gradient).not.toContain('foreground')
    }
    expect(weatherVisual(999).gradient).not.toContain('foreground')
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
