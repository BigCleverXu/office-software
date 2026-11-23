import { describe, expect, it } from 'vitest'
import {
  batteryHintOf,
  batteryTierOf,
  BATTERY_TIER_LABELS,
  clampVolume,
  createEmptyAudioSnapshot,
  createEmptyDeviceSnapshot,
  createEmptyPointerSnapshot,
  DEVICE_CHANNELS,
  formatDeviceUpdatedLabel,
  isValidPointerSpeed,
  normalizeDeviceSnapshot,
  pointerPercentToSpeed,
  pointerSpeedToPercent
} from '../../src/shared/devices'
import type { BatteryTier } from '../../src/shared/devices'
import { formatClockTime } from '../../src/shared/market'

describe('batteryTierOf', () => {
  it('null 或 percent 非有限数返回 unknown', () => {
    expect(batteryTierOf(null)).toBe('unknown')
    expect(batteryTierOf({ percent: null, charging: false })).toBe('unknown')
    expect(batteryTierOf({ percent: Number.NaN, charging: true })).toBe('unknown')
    expect(
      batteryTierOf({ percent: Number.POSITIVE_INFINITY, charging: false })
    ).toBe('unknown')
  })

  it('按边界分级，0 落在 critical', () => {
    const cases: Array<[number, BatteryTier]> = [
      [0, 'critical'],
      [10, 'critical'],
      [11, 'low'],
      [20, 'low'],
      [21, 'medium'],
      [60, 'medium'],
      [61, 'high'],
      [100, 'high']
    ]
    for (const [percent, tier] of cases) {
      expect(batteryTierOf({ percent, charging: false })).toBe(tier)
    }
  })

  it('负值按 0 处理为 critical', () => {
    expect(batteryTierOf({ percent: -5, charging: false })).toBe('critical')
  })
})

describe('batteryHintOf', () => {
  const tiers: BatteryTier[] = [
    'critical',
    'low',
    'medium',
    'high',
    'unknown'
  ]

  it('各分级文案非空', () => {
    for (const tier of tiers) {
      expect(batteryHintOf(tier).length).toBeGreaterThan(0)
    }
  })

  it('critical 与 low 文案不同，其余复用分级名称', () => {
    expect(batteryHintOf('critical')).not.toBe(batteryHintOf('low'))
    expect(batteryHintOf('medium')).toBe(BATTERY_TIER_LABELS.medium)
    expect(batteryHintOf('high')).toBe(BATTERY_TIER_LABELS.high)
    expect(batteryHintOf('unknown')).toBe(BATTERY_TIER_LABELS.unknown)
  })
})

describe('clampVolume', () => {
  it('四舍五入并限制在 0–100', () => {
    expect(clampVolume(-5)).toBe(0)
    expect(clampVolume(0)).toBe(0)
    expect(clampVolume(55.4)).toBe(55)
    expect(clampVolume(55.6)).toBe(56)
    expect(clampVolume(100)).toBe(100)
    expect(clampVolume(101)).toBe(100)
  })

  it('非有限数与非 number 类型返回 null', () => {
    expect(clampVolume(Number.NaN)).toBeNull()
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBeNull()
    expect(clampVolume('50')).toBeNull()
    expect(clampVolume(null)).toBeNull()
    expect(clampVolume(undefined)).toBeNull()
  })
})

describe('isValidPointerSpeed', () => {
  it('仅接受有限正数', () => {
    expect(isValidPointerSpeed(1)).toBe(true)
    expect(isValidPointerSpeed(0.35)).toBe(true)
    expect(isValidPointerSpeed(0)).toBe(false)
    expect(isValidPointerSpeed(-1)).toBe(false)
    expect(isValidPointerSpeed(Number.NaN)).toBe(false)
    expect(isValidPointerSpeed('1')).toBe(false)
    expect(isValidPointerSpeed(null)).toBe(false)
  })
})

describe('pointerSpeedToPercent / pointerPercentToSpeed', () => {
  it('Windows 区间 1–20 step=1 往返可逆', () => {
    for (const speed of [1, 10, 11, 20]) {
      const percent = pointerSpeedToPercent(speed, 1, 20)
      expect(percent).not.toBeNull()
      expect(pointerPercentToSpeed(percent ?? 0, 1, 20, 1)).toBe(speed)
    }
    expect(pointerSpeedToPercent(1, 1, 20)).toBe(0)
    expect(pointerSpeedToPercent(10, 1, 20)).toBe(47)
    expect(pointerSpeedToPercent(11, 1, 20)).toBe(53)
    expect(pointerSpeedToPercent(20, 1, 20)).toBe(100)
  })

  it('macOS 区间 0–3 step=0.01 往返误差不超过半个 step', () => {
    for (const speed of [0, 0.69, 3]) {
      const percent = pointerSpeedToPercent(speed, 0, 3)
      expect(percent).not.toBeNull()
      const back = pointerPercentToSpeed(percent ?? 0, 0, 3, 0.01)
      expect(back).not.toBeNull()
      expect(Math.abs((back ?? 0) - speed)).toBeLessThanOrEqual(0.005 + 1e-9)
    }
    expect(pointerSpeedToPercent(0, 0, 3)).toBe(0)
    expect(pointerSpeedToPercent(0.69, 0, 3)).toBe(23)
    expect(pointerSpeedToPercent(3, 0, 3)).toBe(100)
    expect(pointerPercentToSpeed(23, 0, 3, 0.01)).toBe(0.69)
  })

  it('非法区间或非法输入返回 null', () => {
    expect(pointerSpeedToPercent(null, 1, 20)).toBeNull()
    expect(pointerSpeedToPercent(Number.NaN, 1, 20)).toBeNull()
    expect(pointerSpeedToPercent(5, 10, 10)).toBeNull()
    expect(pointerSpeedToPercent(5, 10, 5)).toBeNull()
    expect(pointerPercentToSpeed(50, 10, 10, 1)).toBeNull()
    expect(pointerPercentToSpeed(50, 1, 20, 0)).toBeNull()
    expect(pointerPercentToSpeed(Number.NaN, 1, 20, 1)).toBeNull()
  })
})

describe('空快照构造', () => {
  it('createEmptyDeviceSnapshot 使用默认值', () => {
    expect(createEmptyDeviceSnapshot('win32')).toEqual({
      platform: 'win32',
      supported: true,
      status: 'loading',
      devices: [],
      hiddenDeviceCount: 0,
      audio: {
        masterVolume: null,
        masterMuted: false,
        outputs: [],
        perDeviceSupported: false
      },
      pointer: {
        speed: null,
        min: 1,
        max: 20,
        step: 1,
        supported: false
      },
      warnings: [],
      updatedAt: null,
      updatedAtLabel: null
    })
  })

  it('可指定状态，音频与指针空快照字段固定', () => {
    expect(createEmptyDeviceSnapshot('linux', 'failed').status).toBe('failed')
    expect(createEmptyAudioSnapshot()).toEqual({
      masterVolume: null,
      masterMuted: false,
      outputs: [],
      perDeviceSupported: false
    })
    expect(createEmptyPointerSnapshot()).toEqual({
      speed: null,
      min: 1,
      max: 20,
      step: 1,
      supported: false
    })
  })
})

describe('normalizeDeviceSnapshot', () => {
  it('非对象输入返回 failed 空快照', () => {
    for (const raw of [null, undefined, 'bad', 42]) {
      const snapshot = normalizeDeviceSnapshot(raw, 'win32')
      expect(snapshot.platform).toBe('win32')
      expect(snapshot.status).toBe('failed')
      expect(snapshot.devices).toEqual([])
      expect(snapshot.warnings).toEqual([])
      expect(snapshot.updatedAt).toBeNull()
      expect(snapshot.updatedAtLabel).toBeNull()
    }
  })

  it('缺字段时回退默认值', () => {
    const snapshot = normalizeDeviceSnapshot({}, 'darwin')
    expect(snapshot.platform).toBe('darwin')
    expect(snapshot.supported).toBe(false)
    expect(snapshot.status).toBe('failed')
    expect(snapshot.devices).toEqual([])
    expect(snapshot.warnings).toEqual([])
    expect(snapshot.audio.masterVolume).toBeNull()
    expect(snapshot.audio.masterMuted).toBe(false)
    expect(snapshot.audio.perDeviceSupported).toBe(false)
    expect(snapshot.pointer).toEqual({
      speed: null,
      min: 1,
      max: 20,
      step: 1,
      supported: false
    })
  })

  it('非法 status 回退为 failed，合法值保留', () => {
    expect(normalizeDeviceSnapshot({ status: 'weird' }, 'win32').status).toBe(
      'failed'
    )
    expect(normalizeDeviceSnapshot({ status: 1 }, 'win32').status).toBe(
      'failed'
    )
    expect(normalizeDeviceSnapshot({ status: 'partial' }, 'win32').status).toBe(
      'partial'
    )
    expect(normalizeDeviceSnapshot({ status: 'ready' }, 'win32').status).toBe(
      'ready'
    )
  })

  it('battery.percent 为 null 时保持 null，非法值也回退为 null', () => {
    const snapshot = normalizeDeviceSnapshot(
      {
        status: 'ready',
        devices: [
          {
            id: 'd1',
            name: '鼠标',
            kind: 'mouse',
            connection: 'bluetooth',
            battery: { percent: null, charging: true }
          },
          { id: 'd2', battery: { percent: 120 } },
          { id: 'd3', battery: { percent: '80' } }
        ]
      },
      'win32'
    )
    expect(snapshot.devices).toHaveLength(3)
    expect(snapshot.devices[0].battery).toEqual({
      percent: null,
      charging: true
    })
    expect(snapshot.devices[0].vendor).toBeNull()
    expect(snapshot.devices[1].battery).toEqual({
      percent: null,
      charging: false
    })
    expect(snapshot.devices[2].battery).toEqual({
      percent: null,
      charging: false
    })
  })

  it('过滤非法 devices / warnings 元素', () => {
    const snapshot = normalizeDeviceSnapshot(
      {
        status: 'partial',
        devices: [
          'bad',
          {
            id: 1,
            name: '键盘',
            kind: 'nope',
            connection: 'nope',
            connected: 'yes'
          }
        ],
        warnings: ['a', 1, null]
      },
      'win32'
    )
    expect(snapshot.devices).toEqual([
      {
        id: '',
        name: '键盘',
        kind: 'other',
        connection: 'unknown',
        vendor: null,
        model: null,
        connected: false,
        battery: null
      }
    ])
    expect(snapshot.warnings).toEqual(['a'])
  })

  it('updatedAt 正常时生成时间标签，非正数回退为 null', () => {
    const ms = new Date(2026, 0, 5, 9, 57, 40).getTime()
    const snapshot = normalizeDeviceSnapshot(
      { status: 'ready', updatedAt: ms },
      'win32'
    )
    expect(snapshot.updatedAt).toBe(ms)
    expect(snapshot.updatedAtLabel).toBe('09:57:40')
    expect(snapshot.updatedAtLabel).toBe(formatClockTime(ms))
    expect(normalizeDeviceSnapshot({ updatedAt: 0 }, 'win32').updatedAt).toBeNull()
    expect(
      normalizeDeviceSnapshot({ updatedAt: -1 }, 'win32').updatedAtLabel
    ).toBeNull()
    expect(
      normalizeDeviceSnapshot({ updatedAt: 'now' }, 'win32').updatedAt
    ).toBeNull()
  })

  it('hiddenDeviceCount 仅接受非负有限数并取整', () => {
    expect(
      normalizeDeviceSnapshot({ hiddenDeviceCount: 12 }, 'win32')
        .hiddenDeviceCount
    ).toBe(12)
    expect(
      normalizeDeviceSnapshot({ hiddenDeviceCount: 12.7 }, 'win32')
        .hiddenDeviceCount
    ).toBe(12)
    expect(
      normalizeDeviceSnapshot({ hiddenDeviceCount: -1 }, 'win32')
        .hiddenDeviceCount
    ).toBe(0)
    expect(
      normalizeDeviceSnapshot({ hiddenDeviceCount: Number.NaN }, 'win32')
        .hiddenDeviceCount
    ).toBe(0)
    expect(
      normalizeDeviceSnapshot({ hiddenDeviceCount: '12' }, 'win32')
        .hiddenDeviceCount
    ).toBe(0)
  })

  it('platform 优先取原始数据中的非空字符串', () => {
    expect(normalizeDeviceSnapshot({ platform: 'linux' }, 'win32').platform).toBe(
      'linux'
    )
    expect(normalizeDeviceSnapshot({ platform: '' }, 'win32').platform).toBe(
      'win32'
    )
  })
})

describe('DEVICE_CHANNELS', () => {
  it('全部以 devices: 开头且互不重复', () => {
    const values = Object.values(DEVICE_CHANNELS)
    expect(values.length).toBe(8)
    for (const value of values) {
      expect(value.startsWith('devices:')).toBe(true)
    }
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('formatDeviceUpdatedLabel', () => {
  it('空或非有限数返回 null，否则为 HH:mm:ss', () => {
    expect(formatDeviceUpdatedLabel(null)).toBeNull()
    expect(formatDeviceUpdatedLabel(Number.NaN)).toBeNull()
    expect(
      formatDeviceUpdatedLabel(new Date(2026, 0, 5, 9, 57, 40).getTime())
    ).toBe('09:57:40')
  })
})
