import { Solar } from 'lunar-typescript'
import type { Lunar } from 'lunar-typescript'

/** ISO 周计算中单日的毫秒数 */
const DAY_MS = 86_400_000
/** 匹配 YYYY-MM-DD 的日期字符串 */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 单日黄历信息 */
export interface DayAlmanac {
  /** 入参日期，原样保留 YYYY-MM-DD */
  date: string
  /** 公历日号 */
  day: number
  /** 星期文案，如「周日」 */
  weekdayLabel: string
  /** 农历全称，如「二〇二六年九月十六」 */
  lunarFull: string
  /** 干支年，如「丙午」 */
  ganZhiYear: string
  /** 生肖，如「马」 */
  zodiac: string
  /** 年份文案，如「丙午(马)年」 */
  yearLabel: string
  /** ISO 周数，周一为首日 */
  weekOfYear: number
  /** 本年第几天 */
  dayOfYear: number
  /** 生肖 */
  shengXiao: string
  /** 星座 */
  xingZuo: string
  /** 宜 */
  yi: string[]
  /** 忌 */
  ji: string[]
  /** 月相 */
  yueXiang: string
  /** 候，如「霜降 初候」 */
  hou: string
  /** 五神方位 */
  positions: {
    xi: string
    yangGui: string
    yinGui: string
    fu: string
    cai: string
  }
}

/** 补全 lunar-typescript 类型声明中缺失的宜忌方法 */
interface LunarDayYiJi {
  getDayYi(): string[]
  getDayJi(): string[]
}

/** 拆分后的公历年月日 */
interface ParsedDate {
  year: number
  month: number
  day: number
}

/** 按 ISO 8601 计算周数（周一为首日，含跨年修正） */
function getIsoWeek({ year, month, day }: ParsedDate): number {
  const target = Date.UTC(year, month - 1, day)
  const weekday = new Date(target).getUTCDay()
  const mondayOffset = (weekday + 6) % 7
  const thursday = target - mondayOffset * DAY_MS + 3 * DAY_MS
  const thursdayYear = new Date(thursday).getUTCFullYear()
  const jan4 = Date.UTC(thursdayYear, 0, 4)
  const jan4Offset = (new Date(jan4).getUTCDay() + 6) % 7
  const firstThursday = jan4 - jan4Offset * DAY_MS + 3 * DAY_MS
  return 1 + Math.round((thursday - firstThursday) / (7 * DAY_MS))
}

/** 计算本年第几天 */
function getDayOfYear({ year, month, day }: ParsedDate): number {
  const start = Date.UTC(year, 0, 1)
  const target = Date.UTC(year, month - 1, day)
  return Math.round((target - start) / DAY_MS) + 1
}

/** 自行拆分 YYYY-MM-DD，并校验年月日合法性 */
function parseDate(value: string): ParsedDate | null {
  const matched = DATE_PATTERN.exec(value)
  if (!matched) {
    return null
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  // 用本地年月日构造，避免 new Date('YYYY-MM-DD') 的时区偏移
  const date = new Date(year, month - 1, day)
  const valid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  return valid ? { year, month, day } : null
}

/**
 * 取日历格上的农历短标签。
 * 优先级：节气 > 农历传统节日 > 初一月份名 > 农历日。
 */
export function getLunarLabel(date: string): string {
  const parsed = parseDate(date)
  if (!parsed) {
    return ''
  }
  const solar = Solar.fromDate(
    new Date(parsed.year, parsed.month - 1, parsed.day)
  )
  const lunar = solar.getLunar()
  const jieQi = lunar.getJieQi()
  if (jieQi) {
    return jieQi
  }
  const festival = lunar.getFestivals()[0]
  if (festival) {
    return festival
  }
  if (lunar.getDay() === 1) {
    return `${lunar.getMonthInChinese()}月`
  }
  return lunar.getDayInChinese()
}

/** 取某一天的黄历信息，非法日期返回 null */
export function getDayAlmanac(date: string): DayAlmanac | null {
  const parsed = parseDate(date)
  if (!parsed) {
    return null
  }
  const { year, month, day } = parsed
  const solar = Solar.fromDate(new Date(year, month - 1, day))
  const lunar = solar.getLunar()
  const lunarDay = lunar as unknown as Lunar & LunarDayYiJi
  const ganZhiYear = lunar.getYearInGanZhi()
  const zodiac = lunar.getYearShengXiao()
  return {
    date,
    day,
    weekdayLabel: `周${solar.getWeekInChinese()}`,
    lunarFull:
      `${lunar.getYearInChinese()}年` +
      `${lunar.getMonthInChinese()}月` +
      `${lunar.getDayInChinese()}`,
    ganZhiYear,
    zodiac,
    yearLabel: `${ganZhiYear}(${zodiac})年`,
    weekOfYear: getIsoWeek(parsed),
    dayOfYear: getDayOfYear(parsed),
    shengXiao: zodiac,
    xingZuo: solar.getXingZuo(),
    yi: lunarDay.getDayYi(),
    ji: lunarDay.getDayJi(),
    yueXiang: lunar.getYueXiang(),
    hou: lunar.getHou(),
    positions: {
      xi: lunar.getDayPositionXiDesc(),
      yangGui: lunar.getDayPositionYangGuiDesc(),
      yinGui: lunar.getDayPositionYinGuiDesc(),
      fu: lunar.getDayPositionFuDesc(),
      cai: lunar.getDayPositionCaiDesc()
    }
  }
}
