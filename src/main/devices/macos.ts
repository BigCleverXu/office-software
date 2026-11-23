// 设备模块：macOS 平台后端
// 全部使用系统自带命令：system_profiler / osascript / defaults
import type { AudioSnapshot, PointerSnapshot } from '../../shared/devices'
import type {
  DeviceBackend,
  DeviceBackendContext,
  DeviceScene
} from './backend'
import {
  parseMacAudioOutputs,
  parseMacBluetoothDevices,
  parseMacDisplays,
  parseMacPointerScaling,
  parseMacUsbDevices,
  parseMacVolumeSettings
} from './parse'
import {
  AUDIO_TIMEOUT_MS,
  DEVICE_SCAN_TIMEOUT_MS,
  POINTER_TIMEOUT_MS
} from './shell-run'

/** 系统信息命令 */
const SYSTEM_PROFILER = 'system_profiler'

/** AppleScript 命令 */
const OSASCRIPT = 'osascript'

/** 偏好设置命令 */
const DEFAULTS = 'defaults'

/** 指针速度下限 */
const POINTER_MIN = 0

/** 指针速度上限 */
const POINTER_MAX = 3

/** 指针速度步进 */
const POINTER_STEP = 0.01

/** 扫描告警：蓝牙读取失败 */
const WARNING_BLUETOOTH = '读取蓝牙设备失败'

/** 扫描告警：USB 读取失败 */
const WARNING_USB = '读取 USB 设备失败'

/** 扫描告警：显示器读取失败 */
const WARNING_DISPLAYS = '读取显示器列表失败'

/** 解析 JSON 文本，失败返回 null */
function parseJsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

/** 音量百分比归一化为 0–100 整数 */
function percentOf(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** 指针速度归一化为 0–3，保留两位小数 */
function pointerSpeedOf(value: number): number {
  if (!Number.isFinite(value)) {
    return POINTER_MIN
  }
  const clamped = Math.min(POINTER_MAX, Math.max(POINTER_MIN, value))
  return Math.round(clamped * 100) / 100
}

/** 一次 system_profiler 读取结果：失败时 json 为 null 并带告警 */
interface ProfilerResult {
  json: unknown
  warning: string | null
}

/** 创建 macOS 设备后端 */
export function createMacBackend(context: DeviceBackendContext): DeviceBackend {
  /** 读取并解析 system_profiler 的一个数据类型 */
  const readProfiler = async (
    dataType: string,
    warning: string
  ): Promise<ProfilerResult> => {
    const result = await context.runner.run(
      SYSTEM_PROFILER,
      [dataType, '-json'],
      DEVICE_SCAN_TIMEOUT_MS
    )
    if (!result.ok) {
      return { json: null, warning }
    }
    const json = parseJsonOutput(result.stdout)
    return json === null ? { json: null, warning } : { json, warning: null }
  }

  return {
    platform: context.platform,
    supported: true,

    async scanDevices(): Promise<DeviceScene> {
      // 三段并行读取，任一失败只记告警，设备列表尽力返回
      const results = await Promise.all([
        readProfiler('SPBluetoothDataType', WARNING_BLUETOOTH),
        readProfiler('SPUSBDataType', WARNING_USB),
        readProfiler('SPDisplaysDataType', WARNING_DISPLAYS)
      ])
      const warnings = results
        .map((item) => item.warning)
        .filter((item): item is string => item !== null)
      const bluetooth = parseMacBluetoothDevices(results[0].json)
      const usb = parseMacUsbDevices(results[1].json)
      const displays = parseMacDisplays(results[2].json)
      return {
        devices: [...bluetooth.devices, ...usb.devices, ...displays.devices],
        hiddenDeviceCount:
          bluetooth.hiddenDeviceCount +
          usb.hiddenDeviceCount +
          displays.hiddenDeviceCount,
        warnings
      }
    },

    async readAudio(): Promise<AudioSnapshot> {
      const settings = await context.runner.run(
        OSASCRIPT,
        ['-e', 'get volume settings'],
        AUDIO_TIMEOUT_MS
      )
      if (!settings.ok) {
        throw new Error('读取音频状态失败')
      }
      const volume = parseMacVolumeSettings(settings.stdout)
      const profiler = await context.runner.run(
        SYSTEM_PROFILER,
        ['SPAudioDataType', '-json'],
        AUDIO_TIMEOUT_MS
      )
      const outputs = profiler.ok
        ? parseMacAudioOutputs(parseJsonOutput(profiler.stdout))
        : []
      return {
        masterVolume: volume.volume,
        masterMuted: volume.muted,
        outputs,
        perDeviceSupported: false
      }
    },

    async setMasterVolume(volume: number): Promise<void> {
      const result = await context.runner.run(
        OSASCRIPT,
        ['-e', `set volume output volume ${percentOf(volume)}`],
        AUDIO_TIMEOUT_MS
      )
      if (!result.ok) {
        throw new Error('设置主音量失败')
      }
    },

    async setOutputVolume(): Promise<void> {
      throw new Error('macOS 不支持单独调节输出设备音量')
    },

    async setMuted(muted: boolean): Promise<void> {
      const result = await context.runner.run(
        OSASCRIPT,
        ['-e', `set volume output muted ${muted ? 'true' : 'false'}`],
        AUDIO_TIMEOUT_MS
      )
      if (!result.ok) {
        throw new Error('设置静音状态失败')
      }
    },

    async readPointer(): Promise<PointerSnapshot> {
      const result = await context.runner.run(
        DEFAULTS,
        ['-currentHost', 'read', '-g', 'com.apple.mouse.scaling'],
        POINTER_TIMEOUT_MS
      )
      return {
        speed: result.ok ? parseMacPointerScaling(result.stdout) : null,
        min: POINTER_MIN,
        max: POINTER_MAX,
        step: POINTER_STEP,
        supported: true
      }
    },

    async setPointerSpeed(speed: number): Promise<void> {
      const result = await context.runner.run(
        DEFAULTS,
        [
          '-currentHost',
          'write',
          '-g',
          'com.apple.mouse.scaling',
          String(pointerSpeedOf(speed))
        ],
        POINTER_TIMEOUT_MS
      )
      if (!result.ok) {
        throw new Error('设置指针速度失败')
      }
    }
  }
}
