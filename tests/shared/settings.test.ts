import { describe, expect, it } from 'vitest'
import { APP_MODULE_IDS } from '../../src/shared/navigation'
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  normalizeVisibleModules
} from '../../src/shared/settings'

describe('DEFAULT_APP_SETTINGS.visibleModules', () => {
  it('默认显示全部模块，且不是 APP_MODULE_IDS 的同一引用', () => {
    expect(DEFAULT_APP_SETTINGS.visibleModules).toEqual([...APP_MODULE_IDS])
    expect(DEFAULT_APP_SETTINGS.visibleModules).not.toBe(APP_MODULE_IDS)
  })
})

describe('normalizeVisibleModules', () => {
  it('子集按固定模块顺序排列', () => {
    expect(normalizeVisibleModules(['weather', 'alarms'])).toEqual([
      'alarms',
      'weather'
    ])
  })

  it('过滤未知 id、非字符串值与重复项', () => {
    expect(normalizeVisibleModules(['water', 'water', 'nope', 123])).toEqual([
      'water'
    ])
  })

  it('空数组回退为全部模块', () => {
    expect(normalizeVisibleModules([])).toEqual([...APP_MODULE_IDS])
  })

  it('非数组值回退为全部模块', () => {
    expect(normalizeVisibleModules(null)).toEqual([...APP_MODULE_IDS])
    expect(normalizeVisibleModules('water')).toEqual([...APP_MODULE_IDS])
    expect(normalizeVisibleModules({ 0: 'water' })).toEqual([...APP_MODULE_IDS])
    expect(normalizeVisibleModules(undefined)).toEqual([...APP_MODULE_IDS])
  })

  it('全部为非法项时回退为全部模块', () => {
    expect(normalizeVisibleModules(['nope', 1, null])).toEqual([
      ...APP_MODULE_IDS
    ])
  })
})

describe('normalizeAppSettings.visibleModules', () => {
  it('保留合法子集并补全其它默认字段', () => {
    expect(
      normalizeAppSettings({ theme: 'dark', visibleModules: ['notes'] })
    ).toEqual({
      launchAtLogin: false,
      theme: 'dark',
      visibleModules: ['notes']
    })
  })

  it('缺少 visibleModules 时回退为全部模块', () => {
    expect(normalizeAppSettings({ theme: 'light' })).toEqual({
      launchAtLogin: false,
      theme: 'light',
      visibleModules: [...APP_MODULE_IDS]
    })
  })

  it('原始值为 undefined 时返回默认设置', () => {
    const normalized = normalizeAppSettings(undefined)
    expect(normalized).toEqual(DEFAULT_APP_SETTINGS)
    expect(normalized.visibleModules).toEqual([...APP_MODULE_IDS])
    expect(normalized.visibleModules).not.toBe(
      DEFAULT_APP_SETTINGS.visibleModules
    )
  })
})
