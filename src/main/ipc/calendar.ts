import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { CALENDAR_CHANNELS } from '../../shared/calendar'
import type {
  Countdown,
  CountdownDraft,
  HolidayYear
} from '../../shared/calendar'
import type { CountdownStore } from '../countdown-store'
import type { CalendarEventStore } from '../calendar-event-store'
import type { HolidayService } from '../holiday-service'

export interface CalendarIpcDeps {
  countdownStore: CountdownStore
  holidayService: HolidayService
  eventStore: CalendarEventStore
  getWindow: () => BrowserWindow | null
}

/**
 * 注册日历与倒计日相关的 IPC 通道。倒计日每次变更后把最新列表广播给渲染进程。
 *
 * 节假日读取走 HolidayService 的同步缓存（含内置数据），后台刷新成功后
 * 由 holidayService 的 onUpdated 回调推送，因此这里不 await 网络请求。
 * 日程事件只提供按区间查询，变更广播由喝水 IPC 经 main/index.ts 统一发送。
 */
export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  const { countdownStore, holidayService, eventStore, getWindow } = deps

  const broadcastCountdowns = (): void => {
    getWindow()?.webContents.send(
      CALENDAR_CHANNELS.countdownsChanged,
      countdownStore.getAll()
    )
  }

  ipcMain.handle(CALENDAR_CHANNELS.listCountdowns, () =>
    countdownStore.getAll()
  )

  ipcMain.handle(
    CALENDAR_CHANNELS.createCountdown,
    (_event: Electron.IpcMainInvokeEvent, draft: CountdownDraft): Countdown => {
      const created = countdownStore.create(draft)
      broadcastCountdowns()
      return created
    }
  )

  ipcMain.handle(
    CALENDAR_CHANNELS.updateCountdown,
    (
      _event: Electron.IpcMainInvokeEvent,
      id: string,
      draft: CountdownDraft
    ): Countdown | null => {
      const updated = countdownStore.update(id, draft)
      broadcastCountdowns()
      return updated
    }
  )

  ipcMain.handle(
    CALENDAR_CHANNELS.removeCountdown,
    (_event: Electron.IpcMainInvokeEvent, id: string) => {
      countdownStore.remove(id)
      broadcastCountdowns()
    }
  )

  // 同步返回缓存 / 内置数据；getYear 内部会按需触发后台刷新
  ipcMain.handle(
    CALENDAR_CHANNELS.getHolidays,
    (_event: Electron.IpcMainInvokeEvent, year: number): HolidayYear =>
      holidayService.getYear(year)
  )

  // 按日期闭区间读取应用内日程事件，非法区间由 store 兜底为空数组
  ipcMain.handle(
    CALENDAR_CHANNELS.listEvents,
    (_event: Electron.IpcMainInvokeEvent, from: unknown, to: unknown) =>
      eventStore.listByDateRange(
        typeof from === 'string' ? from : '',
        typeof to === 'string' ? to : ''
      )
  )
}
