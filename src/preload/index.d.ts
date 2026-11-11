import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AlarmApi } from '../shared/types'
import type { MarketApi } from '../shared/market'
import type { GoldApi } from '../shared/gold'
import type { NoteApi } from '../shared/notes'
import type { UpdateApi } from '../shared/update'
import type { SettingsApi } from '../shared/settings'
import type { CalendarApi } from '../shared/calendar'
import type { NewsApi } from '../shared/news'
import type { WeatherApi } from '../shared/weather'
import type { FileSearchApi } from '../shared/files'
import type { QuickSiteApi } from '../shared/quick-sites'
import type { VideoApi } from '../shared/video'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      alarms: AlarmApi
      market: MarketApi
      gold: GoldApi
      update: UpdateApi
      notes: NoteApi
      calendar: CalendarApi
      settings: SettingsApi
      news: NewsApi
      weather: WeatherApi
      files: FileSearchApi
      quickSites: QuickSiteApi
      video: VideoApi
    }
  }
}
