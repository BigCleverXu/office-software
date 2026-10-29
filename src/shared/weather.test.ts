import { describe, expect, it } from 'vitest'
import { APP_MODULE_IDS, isAppModuleId } from './navigation'
import {
  DEFAULT_CITY,
  MAX_CITIES,
  normalizeWeatherCities,
  normalizeWeatherCity,
  normalizeWeatherCityId
} from './weather'

describe('normalizeWeatherCity', () => {
  it('合法城市返回完整对象', () => {
    expect(
      normalizeWeatherCity({
        id: 'hz',
        name: '杭州',
        admin1: '浙江',
        country: '中国',
        latitude: 30.2741,
        longitude: 120.1551
      })
    ).toEqual({
      id: 'hz',
      name: '杭州',
      admin1: '浙江',
      country: '中国',
      latitude: 30.2741,
      longitude: 120.1551
    })
  })

  it('缺少 id 时按坐标生成', () => {
    const city = normalizeWeatherCity({
      name: '杭州',
      admin1: '浙江',
      country: '中国',
      latitude: 30.2741,
      longitude: 120.1551
    })
    expect(city?.id).toBe('30.2741,120.1551')
  })

  it('id 为空白字符串时按坐标生成', () => {
    const city = normalizeWeatherCity({
      id: '   ',
      name: '杭州',
      latitude: 30.2741,
      longitude: 120.1551
    })
    expect(city?.id).toBe('30.2741,120.1551')
  })

  it('id 与名称会 trim', () => {
    const city = normalizeWeatherCity({
      id: ' hz ',
      name: ' 杭州 ',
      latitude: 30.2741,
      longitude: 120.1551
    })
    expect(city?.id).toBe('hz')
    expect(city?.name).toBe('杭州')
  })

  it('admin1 / country 非字符串时归一化为空字符串', () => {
    const city = normalizeWeatherCity({
      id: 'hz',
      name: '杭州',
      admin1: 123,
      country: null,
      latitude: 30.2741,
      longitude: 120.1551
    })
    expect(city?.admin1).toBe('')
    expect(city?.country).toBe('')
  })

  it('name 为空或空白返回 null', () => {
    expect(
      normalizeWeatherCity({
        name: '',
        latitude: 30,
        longitude: 120
      })
    ).toBeNull()
    expect(
      normalizeWeatherCity({
        name: '   ',
        latitude: 30,
        longitude: 120
      })
    ).toBeNull()
  })

  it('纬度越界返回 null', () => {
    expect(
      normalizeWeatherCity({ name: '杭州', latitude: 91, longitude: 120 })
    ).toBeNull()
    expect(
      normalizeWeatherCity({ name: '杭州', latitude: -91, longitude: 120 })
    ).toBeNull()
  })

  it('经度越界返回 null', () => {
    expect(
      normalizeWeatherCity({ name: '杭州', latitude: 30, longitude: 181 })
    ).toBeNull()
    expect(
      normalizeWeatherCity({ name: '杭州', latitude: 30, longitude: -181 })
    ).toBeNull()
  })

  it('经纬度非数字返回 null', () => {
    expect(
      normalizeWeatherCity({ name: '杭州', latitude: '30', longitude: 120 })
    ).toBeNull()
    expect(
      normalizeWeatherCity({ name: '杭州', latitude: 30, longitude: null })
    ).toBeNull()
    expect(
      normalizeWeatherCity({
        name: '杭州',
        latitude: Number.NaN,
        longitude: 120
      })
    ).toBeNull()
    expect(
      normalizeWeatherCity({
        name: '杭州',
        latitude: Number.POSITIVE_INFINITY,
        longitude: 120
      })
    ).toBeNull()
  })

  it('null、字符串、数组等非对象返回 null', () => {
    expect(normalizeWeatherCity(null)).toBeNull()
    expect(normalizeWeatherCity(undefined)).toBeNull()
    expect(normalizeWeatherCity('杭州')).toBeNull()
    expect(normalizeWeatherCity(42)).toBeNull()
    expect(normalizeWeatherCity([])).toBeNull()
  })

  it('保留 city / district 并 trim', () => {
    expect(
      normalizeWeatherCity({
        id: '330602',
        name: '越城',
        admin1: '浙江省',
        country: '中国',
        city: ' 绍兴市 ',
        district: ' 越城 ',
        latitude: 29.996992,
        longitude: 120.585312
      })
    ).toEqual({
      id: '330602',
      name: '越城',
      admin1: '浙江省',
      country: '中国',
      city: '绍兴市',
      district: '越城',
      latitude: 29.996992,
      longitude: 120.585312
    })
  })

  it('缺少 city / district 时不输出这两个键', () => {
    const city = normalizeWeatherCity({
      id: 'hz',
      name: '杭州',
      latitude: 30.2741,
      longitude: 120.1551
    })
    expect(city?.city).toBeUndefined()
    expect(city?.district).toBeUndefined()
    expect(Object.keys(city ?? {})).not.toContain('city')
    expect(Object.keys(city ?? {})).not.toContain('district')
  })

  it('city / district 非字符串或空白时忽略', () => {
    const city = normalizeWeatherCity({
      id: 'hz',
      name: '杭州',
      city: 123,
      district: '   ',
      latitude: 30.2741,
      longitude: 120.1551
    })
    expect(Object.keys(city ?? {})).not.toContain('city')
    expect(Object.keys(city ?? {})).not.toContain('district')
  })
})

describe('normalizeWeatherCities', () => {
  it('非数组回退默认城市', () => {
    expect(normalizeWeatherCities(undefined)).toEqual([DEFAULT_CITY])
    expect(normalizeWeatherCities(null)).toEqual([DEFAULT_CITY])
    expect(normalizeWeatherCities('杭州')).toEqual([DEFAULT_CITY])
    expect(normalizeWeatherCities({ id: 'hz' })).toEqual([DEFAULT_CITY])
  })

  it('回退默认城市时返回新对象，避免污染常量', () => {
    const result = normalizeWeatherCities(undefined)
    expect(result[0]).not.toBe(DEFAULT_CITY)
    result[0].name = '改动'
    expect(DEFAULT_CITY.name).toBe('北京')
  })

  it('空数组返回空数组，不回退北京', () => {
    expect(normalizeWeatherCities([])).toEqual([])
  })

  it('全非法数组返回空数组，不回退北京', () => {
    expect(
      normalizeWeatherCities([null, '杭州', { name: '', latitude: 1 }])
    ).toEqual([])
  })

  it('过滤非法项并按 id 去重，保留首次出现', () => {
    const result = normalizeWeatherCities([
      { id: 'hz', name: '杭州', latitude: 30.27, longitude: 120.15 },
      { id: 'hz', name: '杭州副本', latitude: 30.27, longitude: 120.15 },
      { id: 'bad', name: '  ', latitude: 30, longitude: 120 },
      { id: 'sh', name: '上海', latitude: 31.23, longitude: 121.47 }
    ])
    expect(result.map((city) => city.id)).toEqual(['hz', 'sh'])
    expect(result[0].name).toBe('杭州')
  })

  it('超过 MAX_CITIES 时截断', () => {
    const many = Array.from({ length: MAX_CITIES + 3 }, (_, index) => ({
      id: `city-${index}`,
      name: `城市${index}`,
      latitude: 20 + index,
      longitude: 100 + index
    }))
    const result = normalizeWeatherCities(many)
    expect(result).toHaveLength(MAX_CITIES)
    expect(result.map((city) => city.id)).toEqual(
      many.slice(0, MAX_CITIES).map((city) => city.id)
    )
  })

  it('缺 id 的城市按坐标去重', () => {
    const result = normalizeWeatherCities([
      { name: '杭州', latitude: 30.2741, longitude: 120.1551 },
      { name: '杭州别名', latitude: 30.2741, longitude: 120.1551 }
    ])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('杭州')
  })
})

describe('normalizeWeatherCityId', () => {
  it('合法 id 返回 trim 后的值', () => {
    expect(normalizeWeatherCityId('beijing')).toBe('beijing')
    expect(normalizeWeatherCityId(' hz ')).toBe('hz')
  })

  it('空字符串、非字符串返回 null', () => {
    expect(normalizeWeatherCityId('')).toBeNull()
    expect(normalizeWeatherCityId('   ')).toBeNull()
    expect(normalizeWeatherCityId(null)).toBeNull()
    expect(normalizeWeatherCityId(undefined)).toBeNull()
    expect(normalizeWeatherCityId(42)).toBeNull()
    expect(normalizeWeatherCityId({ id: 'hz' })).toBeNull()
  })
})

describe('DEFAULT_CITY', () => {
  it('默认城市为北京', () => {
    expect(DEFAULT_CITY.id).toBe('beijing')
    expect(DEFAULT_CITY.name).toBe('北京')
    expect(DEFAULT_CITY.latitude).toBe(39.9075)
    expect(DEFAULT_CITY.longitude).toBe(116.39723)
  })
})

describe('APP_MODULE_IDS', () => {
  it('包含 weather 且顺序为提醒/日历/行情/天气/热点/便签/文件/游戏', () => {
    expect(APP_MODULE_IDS).toEqual([
      'alarms',
      'calendar',
      'market',
      'weather',
      'news',
      'notes',
      'files',
      'games'
    ])
  })

  it('isAppModuleId 识别 weather 与 files', () => {
    expect(isAppModuleId('weather')).toBe(true)
    expect(isAppModuleId('weathers')).toBe(false)
    expect(isAppModuleId('files')).toBe(true)
    expect(isAppModuleId('file')).toBe(false)
    expect(isAppModuleId(null)).toBe(false)
  })
})
