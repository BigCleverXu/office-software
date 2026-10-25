import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AlarmApi } from '../shared/types'
import type { MarketApi } from '../shared/market'
import type { NoteApi } from '../shared/notes'
import type { UpdateApi } from '../shared/update'
import type { SettingsApi } from '../shared/settings'
import type { CalendarApi } from '../shared/calendar'
import type { NewsApi } from '../shared/news'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      alarms: AlarmApi
      market: MarketApi
      update: UpdateApi
      notes: NoteApi
      calendar: CalendarApi
      settings: SettingsApi
      news: NewsApi
    }
  }
}
