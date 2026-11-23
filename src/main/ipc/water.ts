// 主进程喝水 IPC：读取今日状态、记录 / 撤销 / 配置容量、同步到应用日历
import { ipcMain } from 'electron'
import {
  WATER_CHANNELS,
  computeWaterSummary,
  localDayRange,
  type WaterRecord,
  type WaterState,
  type WaterSyncResult
} from '../../shared/water'
import type { CalendarEventStore } from '../calendar-event-store'
import type { WaterStore } from '../water-store'

export interface WaterIpcDeps {
  store: WaterStore
  calendarEvents: CalendarEventStore
  notifyCalendarEvents: () => void
}

/** 注册喝水相关的 IPC 通道 */
export function registerWaterIpc(deps: WaterIpcDeps): void {
  const { store, calendarEvents, notifyCalendarEvents } = deps

  /** 读取今日记录（本地自然日区间，按饮水时间倒序） */
  const listToday = (now = Date.now()): WaterRecord[] => {
    const { from, to } = localDayRange(now)
    return store.listRecords(from, to)
  }

  /** 组装渲染层需要的完整状态 */
  const buildState = (now = Date.now()): WaterState => {
    const records = listToday(now)
    const summary = computeWaterSummary(records)
    return {
      settings: store.getSettings(),
      records,
      todayCount: summary.count,
      todayTotalMl: summary.totalMl
    }
  }

  ipcMain.handle(WATER_CHANNELS.getState, (): WaterState => buildState())

  ipcMain.handle(WATER_CHANNELS.addCup, (): WaterState => {
    // 按当前杯容量记录一杯；写入失败也返回最新状态，不向渲染层抛错
    store.addCup(store.getSettings().cupMl)
    return buildState()
  })

  ipcMain.handle(
    WATER_CHANNELS.setCup,
    (
      _event: Electron.IpcMainInvokeEvent,
      cupMl: unknown
    ): WaterState | null => {
      const saved = store.setCupMl(cupMl)
      if (!saved) {
        return null
      }
      return buildState()
    }
  )

  ipcMain.handle(WATER_CHANNELS.removeLast, (): WaterState => {
    const removed = store.removeLast()
    // 已同步的记录在撤销时同步删除对应事件，并通知日历刷新
    if (removed) {
      calendarEvents.removeBySourceIds([removed.id])
      notifyCalendarEvents()
    }
    return buildState()
  })

  ipcMain.handle(WATER_CHANNELS.syncCalendar, (): WaterSyncResult => {
    const records = listToday()
    if (records.length === 0) {
      return { ok: true, eventCount: 0, message: '今日没有可同步的记录' }
    }
    // 按来源记录 id 去重，重复同步不会产生重复事件
    const created = calendarEvents.upsertWaterRecords(records)
    store.markSynced(records.map((record) => record.id))
    notifyCalendarEvents()
    return {
      ok: true,
      eventCount: created,
      message:
        created > 0
          ? `已同步 ${created} 条记录到应用日历`
          : '今日记录已同步到应用日历'
    }
  })
}
