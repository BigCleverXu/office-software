// 设备模块：主进程平台后端统一契约与工厂
// 各平台实现分别位于 windows.ts / macos.ts / unsupported.ts
import type {
  AudioSnapshot,
  DeviceInfo,
  PointerSnapshot
} from '../../shared/devices'
import { createShellRunner, type ShellRunner } from './shell-run'
import { createWindowsBackend } from './windows'
import { createMacBackend } from './macos'
import { createUnsupportedBackend } from './unsupported'

/** 一次设备扫描结果 */
export interface DeviceScene {
  devices: DeviceInfo[]
  /** 本次扫描被过滤掉的内部 / 虚拟设备容器数 */
  hiddenDeviceCount: number
  warnings: string[]
}

/** 平台后端：读操作失败抛错，由服务层把对应片段降级 */
export interface DeviceBackend {
  readonly platform: string
  readonly supported: boolean
  scanDevices(): Promise<DeviceScene>
  readAudio(): Promise<AudioSnapshot>
  setMasterVolume(volume: number): Promise<void>
  setOutputVolume(id: string, volume: number): Promise<void>
  setMuted(muted: boolean): Promise<void>
  readPointer(): Promise<PointerSnapshot>
  setPointerSpeed(speed: number): Promise<void>
}

/** 后端依赖，可在测试中注入平台与命令执行器 */
export interface DeviceBackendOptions {
  platform?: NodeJS.Platform
  /** 资源根目录，例如 <repo>/resources；脚本位于其 devices 子目录 */
  resourcesDir: string
  runner?: ShellRunner
}

/** 平台实现共用的上下文 */
export interface DeviceBackendContext {
  platform: string
  resourcesDir: string
  runner: ShellRunner
}

/**
 * 按平台创建设备后端。
 * 未识别的平台返回不支持实现：读取返回空快照，写入抛出中文原因。
 */
export function createDeviceBackend(
  options: DeviceBackendOptions
): DeviceBackend {
  const platform = options.platform ?? process.platform
  const context: DeviceBackendContext = {
    platform,
    resourcesDir: options.resourcesDir,
    runner: options.runner ?? createShellRunner()
  }
  if (platform === 'win32') {
    return createWindowsBackend(context)
  }
  if (platform === 'darwin') {
    return createMacBackend(context)
  }
  return createUnsupportedBackend(context)
}
