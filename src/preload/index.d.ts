import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AlarmApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      alarms: AlarmApi
    }
  }
}
