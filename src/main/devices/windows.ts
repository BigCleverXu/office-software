// 设备模块：Windows 平台后端
// 通过 resources/devices 下的 PowerShell 脚本读取设备、音频与指针状态
import { join } from 'node:path'
import type { AudioSnapshot, PointerSnapshot } from '../../shared/devices'
import type {
  DeviceBackend,
  DeviceBackendContext,
  DeviceScene
} from './backend'
import { parseWindowsAudio, parseWindowsDevices } from './parse'
import {
  applyRazerBatteries,
  parseRazerOutput,
  type RazerInterfaceResult
} from './razer'
import {
  AUDIO_TIMEOUT_MS,
  DEVICE_SCAN_TIMEOUT_MS,
  POINTER_TIMEOUT_MS
} from './shell-run'

/** PowerShell 可执行文件名 */
const POWERSHELL = 'powershell.exe'

/** 脚本在资源根目录下的子目录 */
const SCRIPT_DIR = 'devices'

/** 雷蛇电量查询超时 */
const RAZER_TIMEOUT_MS = 5000

/** 雷蛇电量缓存有效期，避免每 10 秒轮询都打开 HID 接口 */
const RAZER_CACHE_TTL_MS = 30_000

/** 雷蛇设备电量读取失败的告警文案 */
const RAZER_WARNING = '雷蛇设备电量读取失败'

/** 模块级缓存：设备列表每次仍正常扫描，仅电量结果复用 */
let razerCache: { at: number; results: RazerInterfaceResult[] } | null = null

/** 脚本固定启动参数，避免加载用户配置与交互提示 */
const POWERSHELL_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File'
]

/** 指针速度下限 */
const POINTER_MIN = 1

/** 指针速度上限 */
const POINTER_MAX = 20

/** 音量百分比归一化为 0–100 整数 */
function percentOf(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** 指针速度归一化为 1–20 整数 */
function pointerSpeedOf(value: number): number {
  if (!Number.isFinite(value)) {
    return POINTER_MIN
  }
  return Math.min(POINTER_MAX, Math.max(POINTER_MIN, Math.round(value)))
}

/** 解析 pointer.ps1 的 `{ speed }` 输出，非法时为 null */
function parsePointerSpeed(stdout: string): number | null {
  try {
    const parsed: unknown = JSON.parse(stdout.trim())
    if (parsed === null || typeof parsed !== 'object') {
      return null
    }
    const speed = (parsed as { speed?: unknown }).speed
    return typeof speed === 'number' && Number.isFinite(speed) ? speed : null
  } catch {
    return null
  }
}

/** 创建 Windows 设备后端 */
export function createWindowsBackend(
  context: DeviceBackendContext
): DeviceBackend {
  const scriptPath = (name: string): string =>
    join(context.resourcesDir, SCRIPT_DIR, name)

  /** 执行脚本；失败时抛出中文原因 */
  const runScript = async (
    name: string,
    extraArgs: string[],
    timeoutMs: number,
    errorMessage: string
  ): Promise<string> => {
    const result = await context.runner.run(
      POWERSHELL,
      [...POWERSHELL_ARGS, scriptPath(name), ...extraArgs],
      timeoutMs
    )
    if (!result.ok) {
      throw new Error(errorMessage)
    }
    return result.stdout
  }

  /** 读取雷蛇电量；30 秒内复用缓存，脚本失败时抛出 */
  const readRazerBatteries = async (): Promise<RazerInterfaceResult[]> => {
    const now = Date.now()
    if (razerCache && now - razerCache.at < RAZER_CACHE_TTL_MS) {
      return razerCache.results
    }
    const stdout = await runScript(
      'razer-battery.ps1',
      ['-Mode', 'query'],
      RAZER_TIMEOUT_MS,
      RAZER_WARNING
    )
    const results = parseRazerOutput(stdout)
    razerCache = { at: now, results }
    return results
  }

  return {
    platform: context.platform,
    supported: true,

    async scanDevices(): Promise<DeviceScene> {
      const stdout = await runScript(
        'pnp-devices.ps1',
        [],
        DEVICE_SCAN_TIMEOUT_MS,
        '读取设备列表失败'
      )
      const scene = parseWindowsDevices(stdout)
      let devices = scene.devices
      const warnings: string[] = []
      const hasRazer = scene.devices.some(
        (device) =>
          /VID_1532/i.test(device.id) || /VID_1532/i.test(device.vendor ?? '')
      )
      if (hasRazer) {
        try {
          devices = applyRazerBatteries(devices, await readRazerBatteries())
        } catch {
          warnings.push(RAZER_WARNING)
        }
      }
      return {
        devices,
        hiddenDeviceCount: scene.hiddenDeviceCount,
        warnings
      }
    },

    async readAudio(): Promise<AudioSnapshot> {
      const stdout = await runScript(
        'audio.ps1',
        ['-Mode', 'list'],
        AUDIO_TIMEOUT_MS,
        '读取音频状态失败'
      )
      return { ...parseWindowsAudio(stdout), perDeviceSupported: true }
    },

    async setMasterVolume(volume: number): Promise<void> {
      await runScript(
        'audio.ps1',
        ['-Mode', 'set-master', '-Value', String(percentOf(volume))],
        AUDIO_TIMEOUT_MS,
        '设置主音量失败'
      )
    },

    async setOutputVolume(id: string, volume: number): Promise<void> {
      await runScript(
        'audio.ps1',
        ['-Mode', 'set-device', '-Id', id, '-Value', String(percentOf(volume))],
        AUDIO_TIMEOUT_MS,
        '设置输出设备音量失败'
      )
    },

    async setMuted(muted: boolean): Promise<void> {
      await runScript(
        'audio.ps1',
        ['-Mode', 'set-mute', '-Value', muted ? 'true' : 'false'],
        AUDIO_TIMEOUT_MS,
        '设置静音状态失败'
      )
    },

    async readPointer(): Promise<PointerSnapshot> {
      const stdout = await runScript(
        'pointer.ps1',
        ['-Mode', 'get'],
        POINTER_TIMEOUT_MS,
        '读取指针速度失败'
      )
      return {
        speed: parsePointerSpeed(stdout),
        min: POINTER_MIN,
        max: POINTER_MAX,
        step: 1,
        supported: true
      }
    },

    async setPointerSpeed(speed: number): Promise<void> {
      await runScript(
        'pointer.ps1',
        ['-Mode', 'set', '-Speed', String(pointerSpeedOf(speed))],
        POINTER_TIMEOUT_MS,
        '设置指针速度失败'
      )
    }
  }
}
