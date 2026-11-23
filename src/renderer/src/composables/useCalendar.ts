import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type {
  CalendarEvent,
  Countdown,
  CountdownDraft,
  HolidayEntry,
  HolidayYearSource
} from '@shared/calendar'
import { sortCountdowns } from '@shared/calendar'

interface UseCalendar {
  countdowns: Ref<Countdown[]>
  sortedCountdowns: Ref<Countdown[]>
  holidays: Ref<HolidayEntry[]>
  holidaySource: Ref<HolidayYearSource>
  holidayLoading: Ref<boolean>
  events: Ref<CalendarEvent[]>
  refresh: () => Promise<void>
  create: (draft: CountdownDraft) => Promise<Countdown>
  update: (id: string, draft: CountdownDraft) => Promise<Countdown | null>
  remove: (id: string) => Promise<void>
  loadHolidays: (year: number) => Promise<void>
  loadEvents: (from: string, to: string) => Promise<void>
}

/**
 * 日历数据 composable：封装倒计日的 IPC 交互与节假日按年加载。
 * 挂载时拉取倒计日并订阅主进程推送的变更。
 */
export function useCalendar(): UseCalendar {
  const countdowns = ref<Countdown[]>([])
  const holidays = ref<HolidayEntry[]>([])
  const holidaySource = ref<HolidayYearSource>('none')
  const holidayLoading = ref(false)

  /** 当前可见区间内的日程事件（如喝水同步事件） */
  const events = ref<CalendarEvent[]>([])

  /** 最近一次请求的事件区间，事件变更推送时按此区间重新加载 */
  let lastEventRange: { from: string; to: string } | null = null

  /** 当前展示的节假日年份，用于过滤后台刷新推送 */
  const currentYear = ref(new Date().getFullYear())

  /** 节假日请求序号：快速切换年份时只接受最后一次结果 */
  let holidayRequestSeq = 0

  /** 事件请求序号：快速切换月份时只接受最后一次结果 */
  let eventRequestSeq = 0

  let unsubscribeCountdowns: (() => void) | null = null
  let unsubscribeHolidays: (() => void) | null = null
  let unsubscribeEvents: (() => void) | null = null

  /** 按共享排序规则生成展示列表 */
  const sortedCountdowns = computed<Countdown[]>(() =>
    sortCountdowns(countdowns.value)
  )

  const refresh = async (): Promise<void> => {
    countdowns.value = await window.api.calendar.listCountdowns()
  }

  const create = (draft: CountdownDraft): Promise<Countdown> =>
    window.api.calendar.createCountdown(draft)

  const update = (
    id: string,
    draft: CountdownDraft
  ): Promise<Countdown | null> => window.api.calendar.updateCountdown(id, draft)

  const remove = (id: string): Promise<void> =>
    window.api.calendar.removeCountdown(id)

  /** 加载指定年份的节假日，竞态时以最后一次请求为准 */
  const loadHolidays = async (year: number): Promise<void> => {
    currentYear.value = year
    const seq = holidayRequestSeq + 1
    holidayRequestSeq = seq
    holidayLoading.value = true
    try {
      const data = await window.api.calendar.getHolidays(year)
      if (seq !== holidayRequestSeq || data.year !== currentYear.value) {
        return
      }
      holidays.value = data.entries
      holidaySource.value = data.source
    } catch {
      if (seq === holidayRequestSeq) {
        holidays.value = []
        holidaySource.value = 'none'
      }
    } finally {
      if (seq === holidayRequestSeq) {
        holidayLoading.value = false
      }
    }
  }

  /** 按日期区间加载日程事件，竞态时以最后一次请求为准 */
  const loadEvents = async (from: string, to: string): Promise<void> => {
    lastEventRange = { from, to }
    const seq = eventRequestSeq + 1
    eventRequestSeq = seq
    try {
      const items = await window.api.calendar.listEvents(from, to)
      if (seq !== eventRequestSeq) {
        return
      }
      events.value = items
    } catch {
      if (seq === eventRequestSeq) {
        events.value = []
      }
    }
  }

  onMounted(async () => {
    // 先订阅，避免加载完成后错过主进程的推送
    unsubscribeCountdowns = window.api.calendar.onCountdownsChanged((items) => {
      countdowns.value = items
    })
    unsubscribeHolidays = window.api.calendar.onHolidaysChanged((data) => {
      // 只接受当前年份的后台刷新结果
      if (data.year !== currentYear.value) return
      holidays.value = data.entries
      holidaySource.value = data.source
    })
    unsubscribeEvents = window.api.calendar.onEventsChanged(() => {
      // 事件变更后按最近一次区间重新加载
      if (lastEventRange) {
        void loadEvents(lastEventRange.from, lastEventRange.to)
      }
    })
    await refresh()
  })

  onUnmounted(() => {
    unsubscribeCountdowns?.()
    unsubscribeHolidays?.()
    unsubscribeEvents?.()
  })

  return {
    countdowns,
    sortedCountdowns,
    holidays,
    holidaySource,
    holidayLoading,
    events,
    refresh,
    create,
    update,
    remove,
    loadHolidays,
    loadEvents
  }
}
