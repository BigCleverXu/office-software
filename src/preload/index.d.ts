import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AlarmApi } from '../shared/types'
import type { MarketApi } from '../shared/market'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      alarms: AlarmApi
      market: MarketApi
    }
  }
}
