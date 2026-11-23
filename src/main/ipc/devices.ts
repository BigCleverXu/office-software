// 主进程设备 IPC：读取快照、刷新与各类调节操作
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  DEVICE_CHANNELS,
  type DeviceActionResult,
  type DeviceState
} from '../../shared/devices'
import type { DeviceService } from '../devices/service'

export interface DevicesIpcDeps {
  service: DeviceService
  getWindow: () => BrowserWindow | null
}

/** 数值入参收敛：非 number 一律传 NaN，由服务层拒绝 */
function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : NaN
}

/** 字符串入参收敛：非字符串一律传空串，由服务层拒绝 */
function toId(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 注册设备相关的 IPC 通道。
 * 广播由装配处基于 DeviceService.onSnapshot 完成，本模块不额外推送。
 */
export function registerDevicesIpc(deps: DevicesIpcDeps): void {
  const { service } = deps

  const buildState = (): DeviceState => ({ snapshot: service.getSnapshot() })

  ipcMain.handle(DEVICE_CHANNELS.getState, () => buildState())

  ipcMain.handle(DEVICE_CHANNELS.refresh, async (): Promise<DeviceState> => {
    const snapshot = await service.refresh()
    return { snapshot }
  })

  ipcMain.handle(
    DEVICE_CHANNELS.setMasterVolume,
    (
      _event: Electron.IpcMainInvokeEvent,
      volume: unknown
    ): Promise<DeviceActionResult> => service.setMasterVolume(toNumber(volume))
  )

  ipcMain.handle(
    DEVICE_CHANNELS.setOutputVolume,
    (
      _event: Electron.IpcMainInvokeEvent,
      id: unknown,
      volume: unknown
    ): Promise<DeviceActionResult> =>
      service.setOutputVolume(toId(id), toNumber(volume))
  )

  ipcMain.handle(
    DEVICE_CHANNELS.setMuted,
    (
      _event: Electron.IpcMainInvokeEvent,
      muted: unknown
    ): Promise<DeviceActionResult> =>
      service.setMuted(typeof muted === 'boolean' ? muted : false)
  )

  ipcMain.handle(
    DEVICE_CHANNELS.setPointerSpeed,
    (
      _event: Electron.IpcMainInvokeEvent,
      speed: unknown
    ): Promise<DeviceActionResult> => service.setPointerSpeed(toNumber(speed))
  )

  ipcMain.handle(DEVICE_CHANNELS.reset, (): Promise<DeviceActionResult> =>
    service.resetToBaseline()
  )
}
