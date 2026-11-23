// 设备模块：Linux 及其他不受支持平台的降级后端
import {
  createEmptyAudioSnapshot,
  createEmptyPointerSnapshot,
  DEVICE_WARNING_UNSUPPORTED,
  type AudioSnapshot,
  type PointerSnapshot
} from '../../shared/devices'
import type {
  DeviceBackend,
  DeviceBackendContext,
  DeviceScene
} from './backend'

/** 写操作失败原因 */
const UNSUPPORTED_WRITE_ERROR = '当前平台暂不支持调节音量'

/** 指针写操作失败原因 */
const UNSUPPORTED_POINTER_ERROR = '当前平台暂不支持调节指针速度'

/** 创建不受支持平台的设备后端 */
export function createUnsupportedBackend(
  context: DeviceBackendContext
): DeviceBackend {
  return {
    platform: context.platform,
    supported: false,

    async scanDevices(): Promise<DeviceScene> {
      return {
        devices: [],
        hiddenDeviceCount: 0,
        warnings: [DEVICE_WARNING_UNSUPPORTED]
      }
    },

    async readAudio(): Promise<AudioSnapshot> {
      return createEmptyAudioSnapshot()
    },

    async setMasterVolume(): Promise<void> {
      throw new Error(UNSUPPORTED_WRITE_ERROR)
    },

    async setOutputVolume(): Promise<void> {
      throw new Error(UNSUPPORTED_WRITE_ERROR)
    },

    async setMuted(): Promise<void> {
      throw new Error(UNSUPPORTED_WRITE_ERROR)
    },

    async readPointer(): Promise<PointerSnapshot> {
      return createEmptyPointerSnapshot()
    },

    async setPointerSpeed(): Promise<void> {
      throw new Error(UNSUPPORTED_POINTER_ERROR)
    }
  }
}
