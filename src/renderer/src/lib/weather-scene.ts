// 天气场景映射：WMO 天气码 + 昼夜 + 降水量 → 场景类型 / 强度 / 粒子数量

/** 场景类型 */
export type WeatherSceneKind =
  | 'sun'
  | 'moon'
  | 'partly'
  | 'partly-night'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder'

/** 强度等级：1 弱 / 2 中 / 3 强 */
export type WeatherLevel = 1 | 2 | 3

/** 场景配置：类型、强度与粒子数量 */
export interface WeatherScene {
  kind: WeatherSceneKind
  level: WeatherLevel
  /** 雨滴数量，仅雨 / 毛毛雨 / 雷雨非 0 */
  drops: number
  /** 雪花数量，仅雪非 0 */
  flakes: number
  /** 云层数量 */
  clouds: number
  /** 星星数量，仅夜间晴朗 / 夜间多云非 0 */
  stars: number
}

/** 毛毛雨类天气码 */
const DRIZZLE_CODES = [51, 53, 55, 56, 57]

/** 降雨类天气码 */
const RAIN_CODES = [61, 63, 65, 66, 67, 80, 81, 82]

/** 降雪类天气码 */
const SNOW_CODES = [71, 73, 75, 77, 85, 86]

/** 雷雨类天气码 */
const THUNDER_CODES = [95, 96, 99]

/** 天气码自带的中等等级 */
const LEVEL_TWO_CODES = [55, 57, 63, 73, 81, 86]

/** 天气码自带的强等级 */
const LEVEL_THREE_CODES = [65, 67, 75, 82, 95, 96, 99]

/** 天气码 → 场景类型，未知码回退为阴天 */
function resolveKind(code: number, isDay: boolean): WeatherSceneKind {
  switch (code) {
    case 0:
      return isDay ? 'sun' : 'moon'
    case 1:
    case 2:
      return isDay ? 'partly' : 'partly-night'
    case 3:
      return 'cloud'
    case 45:
    case 48:
      return 'fog'
  }
  if (DRIZZLE_CODES.includes(code)) return 'drizzle'
  if (RAIN_CODES.includes(code)) return 'rain'
  if (SNOW_CODES.includes(code)) return 'snow'
  if (THUNDER_CODES.includes(code)) return 'thunder'
  return 'cloud'
}

/** 降水类场景才参与强度计算 */
function isPrecipitationKind(kind: WeatherSceneKind): boolean {
  return (
    kind === 'drizzle' ||
    kind === 'rain' ||
    kind === 'snow' ||
    kind === 'thunder'
  )
}

/** 天气码自带的基础等级 */
function baseLevel(code: number): WeatherLevel {
  if (LEVEL_THREE_CODES.includes(code)) return 3
  if (LEVEL_TWO_CODES.includes(code)) return 2
  return 1
}

/** 降水量对应的最低等级，非法值按 0 处理 */
function precipitationLevel(precipitation: number): WeatherLevel {
  const value =
    Number.isFinite(precipitation) && precipitation > 0 ? precipitation : 0
  if (value >= 8) return 3
  if (value >= 2.5) return 2
  return 1
}

/** 雨滴数量 */
function resolveDrops(kind: WeatherSceneKind, level: WeatherLevel): number {
  if (kind === 'drizzle' || kind === 'rain' || kind === 'thunder') {
    if (level === 1) return 12
    if (level === 2) return 20
    return 30
  }
  return 0
}

/** 雪花数量 */
function resolveFlakes(kind: WeatherSceneKind, level: WeatherLevel): number {
  if (kind !== 'snow') return 0
  if (level === 1) return 10
  if (level === 2) return 16
  return 22
}

/** 云层数量 */
function resolveClouds(kind: WeatherSceneKind): number {
  if (kind === 'cloud') return 4
  if (kind === 'fog') return 3
  if (kind === 'partly' || kind === 'partly-night') return 2
  if (kind === 'sun' || kind === 'moon') return 1
  return 2
}

/** 星星数量 */
function resolveStars(kind: WeatherSceneKind): number {
  if (kind === 'moon' || kind === 'partly-night') return 14
  return 0
}

/** 按天气码、昼夜与降水量生成动态场景配置 */
export function weatherScene(
  code: number,
  isDay: boolean,
  precipitation: number
): WeatherScene {
  const kind = resolveKind(code, isDay)
  const codeLevel = baseLevel(code)
  const rainLevel = precipitationLevel(precipitation)
  const level: WeatherLevel = isPrecipitationKind(kind)
    ? (Math.max(codeLevel, rainLevel) as WeatherLevel)
    : 1

  return {
    kind,
    level,
    drops: resolveDrops(kind, level),
    flakes: resolveFlakes(kind, level),
    clouds: resolveClouds(kind),
    stars: resolveStars(kind)
  }
}
