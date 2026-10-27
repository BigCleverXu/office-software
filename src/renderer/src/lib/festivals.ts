import { Solar } from 'lunar-typescript'
import type { Lunar } from 'lunar-typescript'

/** 节日条目的来源类型 */
export type FestivalKind = 'solarTerm' | 'lunarFestival' | 'solarFestival'

/** 单条节日或节气信息 */
export interface FestivalEntry {
  /** 公历日期，格式 YYYY-MM-DD */
  date: string
  /** 条目名称，如「立春」「春节」 */
  name: string
  /** 条目来源 */
  kind: FestivalKind
  /** 农历标签，如「正月初一」 */
  lunarLabel: string
  /** 公历月份，1-12 */
  month: number
  /** 公历日号 */
  day: number
}

/** 24 节气，按一年内的先后顺序排列 */
export const SOLAR_TERM_NAMES: string[] = [
  '小寒',
  '大寒',
  '立春',
  '雨水',
  '惊蛰',
  '春分',
  '清明',
  '谷雨',
  '立夏',
  '小满',
  '芒种',
  '夏至',
  '小暑',
  '大暑',
  '立秋',
  '处暑',
  '白露',
  '秋分',
  '寒露',
  '霜降',
  '立冬',
  '小雪',
  '大雪',
  '冬至'
]

/**
 * 节气表中「冬至」键固定指向上一年冬至，
 * 本年的冬至存放在拼音别名键上，需要回退读取。
 */
const JIEQI_ALIASES: Record<string, string> = {
  冬至: 'DONG_ZHI'
}

/** 节日名称归一化表 */
const FESTIVAL_NAME_ALIASES: Record<string, string> = {
  元旦节: '元旦'
}

/** 同一天内各类条目的排序权重 */
const KIND_ORDER: Record<FestivalKind, number> = {
  solarTerm: 0,
  lunarFestival: 1,
  solarFestival: 2
}

/** 把公历对象格式化为 YYYY-MM-DD */
function formatDate(solar: Solar): string {
  const month = String(solar.getMonth()).padStart(2, '0')
  const day = String(solar.getDay()).padStart(2, '0')
  return `${solar.getYear()}-${month}-${day}`
}

/** 生成「正月初一」形式的农历标签 */
function formatLunarLabel(lunar: Lunar): string {
  return `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`
}

/** 节日名称归一化，其余名称原样保留 */
function normalizeFestivalName(name: string): string {
  return FESTIVAL_NAME_ALIASES[name] ?? name
}

/** 由公历对象生成统一结构的条目 */
function createEntry(
  solar: Solar,
  name: string,
  kind: FestivalKind
): FestivalEntry {
  const lunar = solar.getLunar()
  return {
    date: formatDate(solar),
    name,
    kind,
    lunarLabel: formatLunarLabel(lunar),
    month: solar.getMonth(),
    day: solar.getDay()
  }
}

/**
 * 取某公历年的全部节气与节日。
 * 非法年份返回空数组，结果按日期与来源排序且已去重。
 */
export function getYearFestivals(year: number): FestivalEntry[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return []
  }
  const entries: FestivalEntry[] = []
  const table = Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable()

  // 节气：按固定顺序取表，只保留落在本公历年的条目
  for (const name of SOLAR_TERM_NAMES) {
    let solar = table[name]
    if (!solar || solar.getYear() !== year) {
      const alias = JIEQI_ALIASES[name]
      solar = alias ? table[alias] : solar
    }
    if (!solar || solar.getYear() !== year) {
      continue
    }
    entries.push(createEntry(solar, name, 'solarTerm'))
  }

  // 节日：逐日扫描，分别收集农历节日与公历节日
  for (let month = 1; month <= 12; month += 1) {
    const days = new Date(year, month, 0).getDate()
    for (let day = 1; day <= days; day += 1) {
      const solar = Solar.fromYmd(year, month, day)
      const lunar = solar.getLunar()
      for (const name of lunar.getFestivals()) {
        const normalized = normalizeFestivalName(name)
        entries.push(createEntry(solar, normalized, 'lunarFestival'))
      }
      for (const name of solar.getFestivals()) {
        const normalized = normalizeFestivalName(name)
        entries.push(createEntry(solar, normalized, 'solarFestival'))
      }
    }
  }

  // 以「日期 + 名称」去重，保留首次出现的条目
  const seen = new Set<string>()
  const unique = entries.filter((entry) => {
    const key = `${entry.date}|${entry.name}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })

  // 先按日期升序，同一天按来源权重稳定排序
  return unique.sort((left, right) => {
    if (left.date !== right.date) {
      return left.date < right.date ? -1 : 1
    }
    return KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
  })
}
