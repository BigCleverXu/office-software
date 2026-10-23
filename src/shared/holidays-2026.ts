// 2026 年节假日内置数据（离线兜底）
// 数据来源：https://timor.tech/api/holiday/year/2026（2026-10 抓取）
// 用途：日历视图在无网络 / 无缓存时展示法定休假与调休补班

import type { HolidayEntry } from './calendar'

/** 2026 年节假日与调休补班，按日期升序 */
export const BUILTIN_HOLIDAYS_2026: readonly HolidayEntry[] = [
  { date: '2026-01-01', name: '元旦', type: 'holiday' },
  { date: '2026-01-02', name: '元旦', type: 'holiday' },
  { date: '2026-01-03', name: '元旦', type: 'holiday' },
  { date: '2026-01-04', name: '元旦后补班', type: 'workday' },
  { date: '2026-02-14', name: '春节前补班', type: 'workday' },
  { date: '2026-02-15', name: '春节', type: 'holiday' },
  { date: '2026-02-16', name: '除夕', type: 'holiday' },
  { date: '2026-02-17', name: '初一', type: 'holiday' },
  { date: '2026-02-18', name: '初二', type: 'holiday' },
  { date: '2026-02-19', name: '初三', type: 'holiday' },
  { date: '2026-02-20', name: '初四', type: 'holiday' },
  { date: '2026-02-21', name: '初五', type: 'holiday' },
  { date: '2026-02-22', name: '初六', type: 'holiday' },
  { date: '2026-02-23', name: '初七', type: 'holiday' },
  { date: '2026-02-28', name: '春节后补班', type: 'workday' },
  { date: '2026-04-04', name: '清明节', type: 'holiday' },
  { date: '2026-04-05', name: '清明节', type: 'holiday' },
  { date: '2026-04-06', name: '清明节', type: 'holiday' },
  { date: '2026-05-01', name: '劳动节', type: 'holiday' },
  { date: '2026-05-02', name: '劳动节', type: 'holiday' },
  { date: '2026-05-03', name: '劳动节', type: 'holiday' },
  { date: '2026-05-04', name: '劳动节', type: 'holiday' },
  { date: '2026-05-05', name: '劳动节', type: 'holiday' },
  { date: '2026-05-09', name: '劳动节后补班', type: 'workday' },
  { date: '2026-06-19', name: '端午节', type: 'holiday' },
  { date: '2026-06-20', name: '端午节', type: 'holiday' },
  { date: '2026-06-21', name: '端午节', type: 'holiday' },
  { date: '2026-09-20', name: '中秋节前补班', type: 'workday' },
  { date: '2026-09-25', name: '中秋节', type: 'holiday' },
  { date: '2026-09-26', name: '中秋节', type: 'holiday' },
  { date: '2026-09-27', name: '中秋节', type: 'holiday' },
  { date: '2026-10-01', name: '国庆节', type: 'holiday' },
  { date: '2026-10-02', name: '国庆节', type: 'holiday' },
  { date: '2026-10-03', name: '国庆节', type: 'holiday' },
  { date: '2026-10-04', name: '国庆节', type: 'holiday' },
  { date: '2026-10-05', name: '国庆节', type: 'holiday' },
  { date: '2026-10-06', name: '国庆节', type: 'holiday' },
  { date: '2026-10-07', name: '国庆节', type: 'holiday' },
  { date: '2026-10-10', name: '国庆节后补班', type: 'workday' }
]

/** 取指定年份的内置节假日：2026 返回浅拷贝，其他年份返回空数组 */
export function getBuiltinHolidays(year: number): HolidayEntry[] {
  if (year !== 2026) {
    return []
  }
  return BUILTIN_HOLIDAYS_2026.map((entry) => ({ ...entry }))
}
