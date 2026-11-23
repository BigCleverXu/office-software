import { describe, expect, it, vi } from 'vitest'
import {
  DEVICE_WARNING_MAC_POINTER,
  DEVICE_WARNING_MAC_VOLUME,
  DEVICE_WARNING_UNSUPPORTED,
  type AudioSnapshot,
  type DeviceSnapshot,
  type PointerSnapshot
} from '../../src/shared/devices'
import type { DeviceBackend, DeviceScene } from '../../src/main/devices/backend'
import { DeviceService } from '../../src/main/devices/service'

/** 构造默认音频快照：主音量 60、扬声器 80、耳机不可读 */
function makeAudio(overrides: Partial<AudioSnapshot> = {}): AudioSnapshot {
  return {
    masterVolume: 60,
    masterMuted: false,
    outputs: [
      {
        id: 'speaker',
        name: '扬声器',
        isDefault: true,
        volume: 80,
        muted: false,
        controllable: true
      },
      {
        id: 'headset',
        name: '耳机',
        isDefault: false,
        volume: null,
        muted: false,
        controllable: false
      }
    ],
    perDeviceSupported: true,
    ...overrides
  }
}

/** 构造默认指针快照：速度 10，区间 1–20 */
function makePointer(
  overrides: Partial<PointerSnapshot> = {}
): PointerSnapshot {
  return {
    speed: 10,
    min: 1,
    max: 20,
    step: 1,
    supported: true,
    ...overrides
  }
}

/** 构造默认设备列表 */
function makeDevices(): DeviceScene {
  return {
    devices: [
      {
        id: 'd1',
        name: 'USB 鼠标',
        kind: 'mouse',
        connection: 'usb',
        vendor: null,
        model: null,
        connected: true,
        battery: null
      }
    ],
    hiddenDeviceCount: 0,
    warnings: []
  }
}

interface Harness {
  service: DeviceService
  snapshots: DeviceSnapshot[]
  failRead: { devices: boolean; audio: boolean; pointer: boolean }
  failWrite: {
    master: boolean
    output: boolean
    muted: boolean
    pointer: boolean
  }
  masterCalls: number[]
  outputCalls: Array<[string, number]>
  mutedCalls: boolean[]
  pointerCalls: number[]
  callLog: string[]
  scanDevices: ReturnType<typeof vi.fn>
  setAudio: (value: AudioSnapshot) => void
  setPointer: (value: PointerSnapshot) => void
  setDevices: (value: DeviceScene) => void
}

/** 可控制读取失败与写入失败的假后端 */
function createHarness(
  options: {
    supported?: boolean
    platform?: NodeJS.Platform
    audio?: AudioSnapshot
    pointer?: PointerSnapshot
  } = {}
): Harness {
  let audio = options.audio ?? makeAudio()
  let pointer = options.pointer ?? makePointer()
  let devices = makeDevices()
  const failRead = { devices: false, audio: false, pointer: false }
  const failWrite = {
    master: false,
    output: false,
    muted: false,
    pointer: false
  }
  const masterCalls: number[] = []
  const outputCalls: Array<[string, number]> = []
  const mutedCalls: boolean[] = []
  const pointerCalls: number[] = []
  const callLog: string[] = []

  const scanDevices = vi.fn(async (): Promise<DeviceScene> => {
    if (failRead.devices) {
      throw new Error('扫描设备失败')
    }
    return devices
  })
  const readAudio = vi.fn(async (): Promise<AudioSnapshot> => {
    if (failRead.audio) {
      throw new Error('读取音频失败')
    }
    return audio
  })
  const readPointer = vi.fn(async (): Promise<PointerSnapshot> => {
    if (failRead.pointer) {
      throw new Error('读取指针失败')
    }
    return pointer
  })

  const backend: DeviceBackend = {
    platform: options.platform ?? 'win32',
    supported: options.supported ?? true,
    scanDevices,
    readAudio,
    readPointer,
    async setMasterVolume(volume: number): Promise<void> {
      callLog.push('master')
      if (failWrite.master) {
        throw new Error('设置主音量失败')
      }
      masterCalls.push(volume)
    },
    async setOutputVolume(id: string, volume: number): Promise<void> {
      callLog.push(`output:${id}`)
      if (failWrite.output) {
        throw new Error('设置输出音量失败')
      }
      outputCalls.push([id, volume])
    },
    async setMuted(muted: boolean): Promise<void> {
      callLog.push('muted')
      if (failWrite.muted) {
        throw new Error('设置静音失败')
      }
      mutedCalls.push(muted)
    },
    async setPointerSpeed(speed: number): Promise<void> {
      callLog.push('pointer')
      if (failWrite.pointer) {
        throw new Error('设置指针速度失败')
      }
      pointerCalls.push(speed)
    }
  }

  const snapshots: DeviceSnapshot[] = []
  const service = new DeviceService({
    backend,
    onSnapshot: (snapshot) => snapshots.push(snapshot)
  })

  return {
    service,
    snapshots,
    failRead,
    failWrite,
    masterCalls,
    outputCalls,
    mutedCalls,
    pointerCalls,
    callLog,
    scanDevices,
    setAudio: (value) => {
      audio = value
    },
    setPointer: (value) => {
      pointer = value
    },
    setDevices: (value) => {
      devices = value
    }
  }
}

describe('DeviceService', () => {
  it('首次刷新捕获基线，第二次刷新不覆盖', async () => {
    const harness = createHarness()

    const first = await harness.service.refresh()
    expect(first.status).toBe('ready')
    expect(first.updatedAt).not.toBeNull()
    expect(first.updatedAtLabel).not.toBeNull()
    expect(harness.service.getBaseline()).toEqual({
      masterVolume: 60,
      masterMuted: false,
      outputs: { speaker: 80 },
      pointerSpeed: 10
    })

    harness.setAudio(makeAudio({ masterVolume: 25, outputs: [] }))
    harness.setPointer(makePointer({ speed: 18 }))
    await harness.service.refresh()

    expect(harness.service.getBaseline()).toEqual({
      masterVolume: 60,
      masterMuted: false,
      outputs: { speaker: 80 },
      pointerSpeed: 10
    })
  })

  it('setMasterVolume 成功后调用后端；后端抛错时返回失败且快照保持原值', async () => {
    const harness = createHarness()
    await harness.service.refresh()

    const ok = await harness.service.setMasterVolume(35)
    expect(ok.ok).toBe(true)
    expect(harness.masterCalls).toEqual([35])
    expect(ok.snapshot.audio.masterVolume).toBe(60)

    harness.failWrite.master = true
    const failed = await harness.service.setMasterVolume(50)
    expect(failed.ok).toBe(false)
    expect(failed.error).toBe('设置主音量失败')
    expect(failed.snapshot.audio.masterVolume).toBe(60)
    expect(harness.service.getSnapshot().audio.masterVolume).toBe(60)
  })

  it('setPointerSpeed 拒绝越界值', async () => {
    const harness = createHarness()
    await harness.service.refresh()

    const zero = await harness.service.setPointerSpeed(0)
    expect(zero.ok).toBe(false)
    expect(zero.error).toBe('指针速度参数无效')

    const huge = await harness.service.setPointerSpeed(999)
    expect(huge.ok).toBe(false)
    expect(huge.error).toBe('指针速度参数无效')
    expect(harness.pointerCalls).toEqual([])
  })

  it('setOutputVolume 拒绝空标识', async () => {
    const harness = createHarness()

    const result = await harness.service.setOutputVolume('', 50)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('输出设备标识无效')
    expect(harness.outputCalls).toEqual([])
  })

  it('有基线时按基线还原，调用顺序与参数正确', async () => {
    const harness = createHarness()
    await harness.service.refresh()
    harness.callLog.length = 0

    const result = await harness.service.resetToBaseline()
    expect(result.ok).toBe(true)
    expect(harness.callLog).toEqual([
      'master',
      'muted',
      'output:speaker',
      'pointer'
    ])
    expect(harness.masterCalls).toEqual([60])
    expect(harness.mutedCalls).toEqual([false])
    expect(harness.outputCalls).toEqual([['speaker', 80]])
    expect(harness.pointerCalls).toEqual([10])
  })

  it('无基线时使用平台默认值还原', async () => {
    const harness = createHarness({
      audio: makeAudio({ masterVolume: null, outputs: [] }),
      pointer: makePointer({ speed: null })
    })
    await harness.service.refresh()
    expect(harness.service.getBaseline()).toBeNull()

    const result = await harness.service.resetToBaseline()
    expect(result.ok).toBe(true)
    expect(harness.masterCalls).toEqual([100])
    expect(harness.mutedCalls).toEqual([false])
    expect(harness.outputCalls).toEqual([])
    // 1–20 区间步进 1 的中位速度为 11
    expect(harness.pointerCalls).toEqual([11])
  })

  it('部分还原失败时返回 ok:false，其余项仍被调用', async () => {
    const harness = createHarness()
    await harness.service.refresh()
    harness.callLog.length = 0
    harness.failWrite.muted = true

    const result = await harness.service.resetToBaseline()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('静音状态恢复失败')
    expect(harness.callLog).toEqual([
      'master',
      'muted',
      'output:speaker',
      'pointer'
    ])
    expect(harness.masterCalls).toEqual([60])
    expect(harness.outputCalls).toEqual([['speaker', 80]])
    expect(harness.pointerCalls).toEqual([10])
  })

  it('刷新部分失败时状态为 partial，可用段数据保留', async () => {
    const harness = createHarness()
    const ready = await harness.service.refresh()
    expect(ready.status).toBe('ready')

    harness.setDevices({
      devices: [
        {
          id: 'd2',
          name: '新设备',
          kind: 'keyboard',
          connection: 'bluetooth',
          vendor: null,
          model: null,
          connected: true,
          battery: null
        }
      ],
      hiddenDeviceCount: 0,
      warnings: []
    })
    harness.failRead.audio = true

    const partial = await harness.service.refresh()
    expect(partial.status).toBe('partial')
    expect(partial.warnings).toContain('音频状态读取失败')
    expect(partial.audio.masterVolume).toBe(60)
    expect(partial.devices.map((device) => device.id)).toEqual(['d2'])
  })

  it('刷新后快照保留 hiddenDeviceCount；设备段失败时保留旧值', async () => {
    const harness = createHarness()
    harness.setDevices({ ...makeDevices(), hiddenDeviceCount: 12 })

    const first = await harness.service.refresh()
    expect(first.hiddenDeviceCount).toBe(12)

    harness.failRead.devices = true
    const partial = await harness.service.refresh()
    expect(partial.hiddenDeviceCount).toBe(12)
    expect(partial.warnings).toContain('设备列表读取失败')
  })

  it('不支持的平台返回 supported=false、partial 且不扫描', async () => {
    const harness = createHarness({ supported: false })

    const snapshot = await harness.service.refresh()
    expect(snapshot.supported).toBe(false)
    expect(snapshot.status).toBe('partial')
    expect(snapshot.warnings).toEqual([DEVICE_WARNING_UNSUPPORTED])
    expect(harness.scanDevices).not.toHaveBeenCalled()
  })

  it('并发刷新复用在途任务，只扫描一次', async () => {
    const harness = createHarness()

    const first = harness.service.refresh()
    const second = harness.service.refresh()
    expect(harness.scanDevices).toHaveBeenCalledTimes(1)

    await Promise.all([first, second])
    expect(harness.scanDevices).toHaveBeenCalledTimes(1)
    expect(harness.service.getSnapshot().status).toBe('ready')
  })

  it('macOS 的平台限制提示只作说明，不把状态降为 partial', async () => {
    const harness = createHarness({ platform: 'darwin' })

    const snapshot = await harness.service.refresh()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.warnings).toContain(DEVICE_WARNING_MAC_VOLUME)
    expect(snapshot.warnings).toContain(DEVICE_WARNING_MAC_POINTER)
  })
})
