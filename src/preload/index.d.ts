import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AlarmApi } from '../shared/types'
import type { MarketApi } from '../shared/market'
import type { NoteApi } from '../shared/notes'
import type { UpdateApi } from '../shared/update'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      alarms: AlarmApi
      market: MarketApi
      update: UpdateApi
      notes: NoteApi
    }
  }
}
