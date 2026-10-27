import { describe, expect, it } from 'vitest'
import { weatherScene } from './weather-scene'

describe('weatherScene 类型映射', () => {
  it('晴天白天返回太阳场景', () => {
    expect(weatherScene(0, true, 0)).toEqual({
      kind: 'sun',
      level: 1,
      drops: 0,
      flakes: 0,
      clouds: 1,
      stars: 0
    })
  })

  it('晴天夜间返回月亮场景并带星星', () => {
    const scene = weatherScene(0, false, 0)
    expect(scene.kind).toBe('moon')
    expect(scene.level).toBe(1)
    expect(scene.clouds).toBe(1)
    expect(scene.stars).toBe(14)
  })

  it('1 与 2 白天映射为少云', () => {
    expect(weatherScene(1, true, 0).kind).toBe('partly')
    expect(weatherScene(2, true, 0).kind).toBe('partly')
    expect(weatherScene(1, true, 0).clouds).toBe(2)
    expect(weatherScene(2, true, 0).clouds).toBe(2)
  })

  it('1 与 2 夜间映射为夜间少云并带星星', () => {
    const scene = weatherScene(2, false, 0)
    expect(scene.kind).toBe('partly-night')
    expect(scene.clouds).toBe(2)
    expect(scene.stars).toBe(14)
  })

  it('3 映射为阴天且有四层云', () => {
    const scene = weatherScene(3, true, 0)
    expect(scene.kind).toBe('cloud')
    expect(scene.level).toBe(1)
    expect(scene.clouds).toBe(4)
    expect(scene.stars).toBe(0)
  })

  it('45 与 48 映射为雾且有三层云', () => {
    expect(weatherScene(45, true, 0).kind).toBe('fog')
    expect(weatherScene(48, true, 0).kind).toBe('fog')
    expect(weatherScene(45, true, 0).clouds).toBe(3)
    expect(weatherScene(48, false, 0).clouds).toBe(3)
  })

  it('未知码回退为阴天', () => {
    for (const code of [-1, 999, Number.NaN]) {
      const scene = weatherScene(code, true, 0)
      expect(scene.kind).toBe('cloud')
      expect(scene.level).toBe(1)
      expect(scene.clouds).toBe(4)
    }
  })
})

describe('weatherScene 降水强度与数量', () => {
  it('51 为毛毛雨一级', () => {
    const scene = weatherScene(51, true, 0)
    expect(scene.kind).toBe('drizzle')
    expect(scene.level).toBe(1)
    expect(scene.drops).toBe(12)
    expect(scene.flakes).toBe(0)
    expect(scene.clouds).toBe(2)
  })

  it('55 与 57 为毛毛雨二级', () => {
    expect(weatherScene(55, true, 0).level).toBe(2)
    expect(weatherScene(55, true, 0).drops).toBe(20)
    expect(weatherScene(57, true, 0).level).toBe(2)
    expect(weatherScene(57, true, 0).drops).toBe(20)
  })

  it('61 / 63 / 65 分别为小雨一级、中雨二级、大雨三级', () => {
    const light = weatherScene(61, true, 0)
    expect(light.kind).toBe('rain')
    expect(light.level).toBe(1)
    expect(light.drops).toBe(12)

    const moderate = weatherScene(63, true, 0)
    expect(moderate.level).toBe(2)
    expect(moderate.drops).toBe(20)

    const heavy = weatherScene(65, true, 0)
    expect(heavy.level).toBe(3)
    expect(heavy.drops).toBe(30)
  })

  it('80 / 81 / 82 阵雨分别为一至三级', () => {
    expect(weatherScene(80, true, 0).kind).toBe('rain')
    expect(weatherScene(80, true, 0).level).toBe(1)
    expect(weatherScene(81, true, 0).level).toBe(2)
    expect(weatherScene(82, true, 0).level).toBe(3)
  })

  it('71 / 73 / 75 雪分别为 10 / 16 / 22 片', () => {
    const light = weatherScene(71, true, 0)
    expect(light.kind).toBe('snow')
    expect(light.level).toBe(1)
    expect(light.flakes).toBe(10)
    expect(light.drops).toBe(0)

    const moderate = weatherScene(73, true, 0)
    expect(moderate.level).toBe(2)
    expect(moderate.flakes).toBe(16)

    const heavy = weatherScene(75, true, 0)
    expect(heavy.level).toBe(3)
    expect(heavy.flakes).toBe(22)
  })

  it('95 与 99 为雷雨三级', () => {
    const scene = weatherScene(95, true, 0)
    expect(scene.kind).toBe('thunder')
    expect(scene.level).toBe(3)
    expect(scene.drops).toBe(30)
    expect(weatherScene(99, true, 0).level).toBe(3)
  })
})

describe('weatherScene 降水量修正', () => {
  it('降水量可抬升等级', () => {
    expect(weatherScene(61, true, 3).level).toBe(2)
    expect(weatherScene(61, true, 3).drops).toBe(20)
    expect(weatherScene(61, true, 8.1).level).toBe(3)
    expect(weatherScene(61, true, 8.1).drops).toBe(30)
  })

  it('降水量不会降低天气码自带的等级', () => {
    expect(weatherScene(63, true, 0).level).toBe(2)
    expect(weatherScene(65, true, 0).level).toBe(3)
  })

  it('降水量边界值按阈值判断', () => {
    expect(weatherScene(61, true, 2.49).level).toBe(1)
    expect(weatherScene(61, true, 2.5).level).toBe(2)
  })

  it('非法降水量按 0 处理', () => {
    expect(weatherScene(61, true, Number.NaN).level).toBe(1)
    expect(weatherScene(61, true, -1).level).toBe(1)
  })

  it('非降水场景不受降水量影响', () => {
    const clear = weatherScene(0, true, 9)
    expect(clear.kind).toBe('sun')
    expect(clear.level).toBe(1)

    const cloudy = weatherScene(3, true, 9)
    expect(cloudy.kind).toBe('cloud')
    expect(cloudy.level).toBe(1)
  })
})
