// 设备模块共享契约：类型 + 常量 + 纯函数
// 主进程 / preload / 渲染层共用，仅依赖语言内置能力与 ./market 的 formatClockTime

import { formatClockTime } from './market'

/** 设备类别 */
export type DeviceKind =
  | 'mouse'
  | 'keyboard'
  | 'headset'
  | 'speaker'
  | 'display'
  | 'gamepad'
  | 'other'

/** 设备连接方式 */
export type DeviceConnection =
  | 'bluetooth'
  | 'wireless'
  | 'usb'
  | 'builtin'
  | 'unknown'

/** 电池分级 */
export type BatteryTier = 'critical' | 'low' | 'medium' | 'high' | 'unknown'

/** 单个设备的电量信息 */
export interface DeviceBattery {
  /** 电量百分比 0–100；不支持上报时为 null */
  percent: number | null
  /** 是否正在充电 */
  charging: boolean
}

/** 单个设备信息 */
export interface DeviceInfo {
  id: string
  name: string
  kind: DeviceKind
  connection: DeviceConnection
  /** 厂商；未知时为 null */
  vendor: string | null
  /** 型号；未知时为 null */
  model: string | null
  connected: boolean
  /** 电池信息；不支持或未读取到时为 null */
  battery: DeviceBattery | null
}

/** 音频输出设备 */
export interface AudioOutputDevice {
  id: string
  name: string
  isDefault: boolean
  /** 音量百分比；不可读取时为 null */
  volume: number | null
  muted: boolean
  /** 是否支持单独调节音量 */
  controllable: boolean
}

/** 音频状态快照 */
export interface AudioSnapshot {
  /** 系统主音量百分比；不可读取时为 null */
  masterVolume: number | null
  masterMuted: boolean
  outputs: AudioOutputDevice[]
  /** 平台是否支持逐设备音量调节 */
  perDeviceSupported: boolean
}

/** 指针速度快照 */
export interface PointerSnapshot {
  /** 当前指针速度；不可读取时为 null */
  speed: number | null
  min: number
  max: number
  step: number
  /** 平台是否支持调节指针速度 */
  supported: boolean
}

/** 设备页整体状态 */
export type DeviceStatus =
  | 'loading' // 首次加载且无数据
  | 'ready' // 全部数据就绪
  | 'partial' // 部分数据缺失或不可读
  | 'failed' // 读取失败

/** 推送给渲染层的完整快照 */
export interface DeviceSnapshot {
  platform: string
  supported: boolean
  status: DeviceStatus
  devices: DeviceInfo[]
  /** 本次扫描被过滤掉的内部 / 虚拟设备容器数 */
  hiddenDeviceCount: number
  audio: AudioSnapshot
  pointer: PointerSnapshot
  /** 本次读取的告警信息（平台限制等） */
  warnings: string[]
  /** 最近一次成功刷新的时间戳（毫秒） */
  updatedAt: number | null
  /** 'HH:mm:ss'；无则为 null */
  updatedAtLabel: string | null
}

export interface DeviceState {
  snapshot: DeviceSnapshot
}

export interface DeviceActionResult {
  ok: boolean
  error?: string
  snapshot: DeviceSnapshot
}

/** IPC 通道 */
export const DEVICE_CHANNELS = {
  getState: 'devices:get-state',
  refresh: 'devices:refresh',
  setMasterVolume: 'devices:set-master-volume',
  setOutputVolume: 'devices:set-output-volume',
  setMuted: 'devices:set-muted',
  setPointerSpeed: 'devices:set-pointer-speed',
  reset: 'devices:reset',
  stateChanged: 'devices:state-changed'
} as const

/** 设备类别名称映射 */
export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  mouse: '鼠标',
  keyboard: '键盘',
  headset: '耳机音箱',
  speaker: '音箱',
  display: '显示器',
  gamepad: '手柄',
  other: '其他'
}

/** 设备连接方式名称映射 */
export const DEVICE_CONNECTION_LABELS: Record<DeviceConnection, string> = {
  bluetooth: '蓝牙',
  wireless: '2.4G 无线',
  usb: 'USB',
  builtin: '内置',
  unknown: '未知'
}

/** 电池分级名称映射 */
export const BATTERY_TIER_LABELS: Record<BatteryTier, string> = {
  critical: '电量严重不足',
  low: '电量偏低',
  medium: '电量正常',
  high: '电量充足',
  unknown: '不支持电量上报'
}

/** 电量严重不足的百分比上限（含） */
export const BATTERY_CRITICAL_MAX = 10
/** 电量偏低的百分比上限（含） */
export const BATTERY_LOW_MAX = 20
/** 电量正常的百分比上限（含） */
export const BATTERY_MEDIUM_MAX = 60

/** Windows 指针速度区间 */
export const POINTER_MIN_WINDOWS = 1
export const POINTER_MAX_WINDOWS = 20
/** macOS 指针速度区间 */
export const POINTER_MIN_MAC = 0
export const POINTER_MAX_MAC = 3

/** 主音量默认值（百分比） */
export const DEFAULT_MASTER_VOLUME = 100

/** 设备状态轮询间隔 */
export const DEVICE_REFRESH_INTERVAL_MS = 10000

/** macOS 不支持逐设备音量的提示文案 */
export const DEVICE_WARNING_MAC_VOLUME =
  'macOS 不支持单独调节每个输出设备的音量，仅可调节系统主音量'
/** macOS 指针速度需重新登录生效的提示文案 */
export const DEVICE_WARNING_MAC_POINTER =
  'macOS 的指针速度设置可能需要重新登录后才会生效'
/** 平台不支持设备管理的提示文案 */
export const DEVICE_WARNING_UNSUPPORTED = '当前平台暂不支持设备管理'

/** 合法状态白名单，用于归一化校验 */
const DEVICE_STATUSES: readonly DeviceStatus[] = [
  'loading',
  'ready',
  'partial',
  'failed'
]

/** preload 暴露给渲染层的设备 API */
export interface DeviceApi {
  getState(): Promise<DeviceState>
  refresh(): Promise<DeviceState>
  setMasterVolume(volume: number): Promise<DeviceActionResult>
  setOutputVolume(id: string, volume: number): Promise<DeviceActionResult>
  setMuted(muted: boolean): Promise<DeviceActionResult>
  setPointerSpeed(speed: number): Promise<DeviceActionResult>
  reset(): Promise<DeviceActionResult>
  onStateChanged(callback: (state: DeviceState) => void): () => void
}

/**
 * 电池分级。
 *
 * battery 为 null 或 percent 非有限数时返回 'unknown'；percent 为负值按 0 处理，
 * 因此 0 一定落在 'critical'（不因假值判断走 unknown）；上限含等号：
 * ≤ 10 为 critical，≤ 20 为 low，≤ 60 为 medium，> 60 为 high。
 */
export function batteryTierOf(battery: DeviceBattery | null): BatteryTier {
  if (!battery) {
    return 'unknown'
  }
  const percent = battery.percent
  if (percent === null || !Number.isFinite(percent)) {
    return 'unknown'
  }
  const value = Math.max(0, percent)
  if (value <= BATTERY_CRITICAL_MAX) {
    return 'critical'
  }
  if (value <= BATTERY_LOW_MAX) {
    return 'low'
  }
  if (value <= BATTERY_MEDIUM_MAX) {
    return 'medium'
  }
  return 'high'
}

/**
 * 电池分级文案。
 *
 * critical / low 额外给出行动建议；medium / high / unknown 直接复用分级名称。
 */
export function batteryHintOf(tier: BatteryTier): string {
  switch (tier) {
    case 'critical':
      return '电量严重不足，请立即充电或更换电池'
    case 'low':
      return '电量偏低，建议尽快充电'
    case 'medium':
    case 'high':
    case 'unknown':
      return BATTERY_TIER_LABELS[tier]
  }
}

/**
 * 音量归一化：非有限数（含非 number 类型）返回 null；
 * 其余四舍五入后限制在 0–100。
 */
export function clampVolume(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** 指针速度校验：必须为有限数且大于 0（用于主进程入参校验） */
export function isValidPointerSpeed(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * 指针速度转百分比。
 *
 * speed 为 null / 非有限数，或区间非法（min / max 非有限数、max ≤ min）时返回 null；
 * 结果先限制在 0–100，再四舍五入为整数。
 */
export function pointerSpeedToPercent(
  speed: number | null,
  min: number,
  max: number
): number | null {
  if (speed === null || !Number.isFinite(speed)) {
    return null
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null
  }
  const ratio = ((speed - min) / (max - min)) * 100
  return Math.round(Math.min(100, Math.max(0, ratio)))
}

/**
 * 指针百分比转速度。
 *
 * percent / min / max / step 非有限数，或区间非法（max ≤ min）、step ≤ 0 时返回 null；
 * 百分比先限制在 0–100，换算后按 step 对齐到最近的整数倍并限制在 [min, max]。
 * step ≥ 1（Windows）返回整数，step < 1（macOS 0.01）保留两位小数。
 */
export function pointerPercentToSpeed(
  percent: number,
  min: number,
  max: number,
  step: number
): number | null {
  if (!Number.isFinite(percent)) {
    return null
  }
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    !Number.isFinite(step) ||
    max <= min ||
    step <= 0
  ) {
    return null
  }
  const ratio = Math.min(100, Math.max(0, percent)) / 100
  const raw = min + ratio * (max - min)
  const totalSteps = Math.floor((max - min) / step + 1e-9)
  const index = Math.min(totalSteps, Math.max(0, Math.round((raw - min) / step)))
  const value = min + index * step
  return step >= 1 ? Math.round(value) : Math.round(value * 100) / 100
}

/** 空音频快照：主音量与输出列表均不可读 */
export function createEmptyAudioSnapshot(): AudioSnapshot {
  return {
    masterVolume: null,
    masterMuted: false,
    outputs: [],
    perDeviceSupported: false
  }
}

/** 空指针快照：默认按 Windows 区间展示，标记为不支持调节 */
export function createEmptyPointerSnapshot(): PointerSnapshot {
  return {
    speed: null,
    min: POINTER_MIN_WINDOWS,
    max: POINTER_MAX_WINDOWS,
    step: 1,
    supported: false
  }
}

/** 空设备快照：supported 默认为 true，时间戳为 null */
export function createEmptyDeviceSnapshot(
  platform: string,
  status: DeviceStatus = 'loading'
): DeviceSnapshot {
  return {
    platform,
    supported: true,
    status,
    devices: [],
    hiddenDeviceCount: 0,
    audio: createEmptyAudioSnapshot(),
    pointer: createEmptyPointerSnapshot(),
    warnings: [],
    updatedAt: null,
    updatedAtLabel: null
  }
}

/** 时间戳转本机时间 'HH:mm:ss'；null 或非有限数返回 null */
export function formatDeviceUpdatedLabel(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) {
    return null
  }
  return formatClockTime(ms)
}

/** 字符串字段归一化：非字符串回退为 fallback */
function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 可空字符串字段归一化：非字符串回退为 null */
function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** 布尔字段归一化：非布尔回退为 false */
function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

/** 设备类别归一化：非法值回退为 'other' */
function asDeviceKind(value: unknown): DeviceKind {
  return typeof value === 'string' && value in DEVICE_KIND_LABELS
    ? (value as DeviceKind)
    : 'other'
}

/** 连接方式归一化：非法值回退为 'unknown' */
function asDeviceConnection(value: unknown): DeviceConnection {
  return typeof value === 'string' && value in DEVICE_CONNECTION_LABELS
    ? (value as DeviceConnection)
    : 'unknown'
}

/** 状态归一化：仅接受四个合法值，否则回退为 'failed' */
function asDeviceStatus(value: unknown): DeviceStatus {
  return typeof value === 'string' &&
    (DEVICE_STATUSES as readonly string[]).includes(value)
    ? (value as DeviceStatus)
    : 'failed'
}

/** 电量归一化：percent 仅接受 0–100 的有限数，其余（含 null）保持 null */
function normalizeBattery(raw: unknown): DeviceBattery | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const source = raw as Partial<DeviceBattery>
  const percent =
    typeof source.percent === 'number' &&
    Number.isFinite(source.percent) &&
    source.percent >= 0 &&
    source.percent <= 100
      ? source.percent
      : null
  return { percent, charging: asBoolean(source.charging) }
}

/** 单个设备归一化：非对象元素返回 null（由调用方过滤） */
function normalizeDeviceInfo(raw: unknown): DeviceInfo | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const source = raw as Partial<Record<keyof DeviceInfo, unknown>>
  return {
    id: asString(source.id),
    name: asString(source.name),
    kind: asDeviceKind(source.kind),
    connection: asDeviceConnection(source.connection),
    vendor: asNullableString(source.vendor),
    model: asNullableString(source.model),
    connected: asBoolean(source.connected),
    battery: normalizeBattery(source.battery)
  }
}

/** 输出设备归一化：非对象元素返回 null（由调用方过滤） */
function normalizeAudioOutput(raw: unknown): AudioOutputDevice | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const source = raw as Partial<Record<keyof AudioOutputDevice, unknown>>
  return {
    id: asString(source.id),
    name: asString(source.name),
    isDefault: asBoolean(source.isDefault),
    volume: clampVolume(source.volume),
    muted: asBoolean(source.muted),
    controllable: asBoolean(source.controllable)
  }
}

/** 音频快照归一化：非法输入回退为空快照 */
function normalizeAudioSnapshot(raw: unknown): AudioSnapshot {
  if (!raw || typeof raw !== 'object') {
    return createEmptyAudioSnapshot()
  }
  const source = raw as Partial<Record<keyof AudioSnapshot, unknown>>
  const outputs: AudioOutputDevice[] = []
  if (Array.isArray(source.outputs)) {
    for (const item of source.outputs) {
      const output = normalizeAudioOutput(item)
      if (output) {
        outputs.push(output)
      }
    }
  }
  return {
    masterVolume: clampVolume(source.masterVolume),
    masterMuted: asBoolean(source.masterMuted),
    outputs,
    perDeviceSupported: asBoolean(source.perDeviceSupported)
  }
}

/** 指针快照归一化：区间非法时回退为 Windows 默认区间 */
function normalizePointerSnapshot(raw: unknown): PointerSnapshot {
  if (!raw || typeof raw !== 'object') {
    return createEmptyPointerSnapshot()
  }
  const source = raw as Partial<Record<keyof PointerSnapshot, unknown>>
  const speed = isValidPointerSpeed(source.speed)
    ? (source.speed as number)
    : null
  const min =
    typeof source.min === 'number' && Number.isFinite(source.min)
      ? source.min
      : POINTER_MIN_WINDOWS
  const max =
    typeof source.max === 'number' && Number.isFinite(source.max)
      ? source.max
      : POINTER_MAX_WINDOWS
  const step =
    typeof source.step === 'number' && Number.isFinite(source.step)
      ? source.step
      : 1
  if (!(min >= 0 && max > min && step > 0)) {
    return {
      speed,
      min: POINTER_MIN_WINDOWS,
      max: POINTER_MAX_WINDOWS,
      step: 1,
      supported: asBoolean(source.supported)
    }
  }
  return { speed, min, max, step, supported: asBoolean(source.supported) }
}

/**
 * 设备快照防御式归一化（渲染层兜底）。
 *
 * 非对象输入返回 createEmptyDeviceSnapshot(platform, 'failed')；其余字段逐个校验：
 * 字符串字段非字符串回退为 ''（vendor / model 回退为 null），布尔字段非布尔回退为
 * false，devices / warnings 仅在数组时保留（warnings 额外过滤非字符串），
 * hiddenDeviceCount 仅接受非负有限数并向下取整，其余回退 0，
 * updatedAt 非正数或非有限数回退为 null 并由 formatClockTime 重新计算标签，
 * status 非法回退为 'failed'。platform 优先取原始数据中的非空字符串，否则用入参。
 */
export function normalizeDeviceSnapshot(
  raw: unknown,
  platform: string
): DeviceSnapshot {
  if (!raw || typeof raw !== 'object') {
    return createEmptyDeviceSnapshot(platform, 'failed')
  }
  const source = raw as Partial<Record<keyof DeviceSnapshot, unknown>>
  const platformValue = asString(source.platform)
  const devices: DeviceInfo[] = []
  if (Array.isArray(source.devices)) {
    for (const item of source.devices) {
      const device = normalizeDeviceInfo(item)
      if (device) {
        devices.push(device)
      }
    }
  }
  const warnings: string[] = []
  if (Array.isArray(source.warnings)) {
    for (const item of source.warnings) {
      if (typeof item === 'string') {
        warnings.push(item)
      }
    }
  }
  const updatedAt =
    typeof source.updatedAt === 'number' &&
    Number.isFinite(source.updatedAt) &&
    source.updatedAt > 0
      ? source.updatedAt
      : null
  const hiddenDeviceCount =
    typeof source.hiddenDeviceCount === 'number' &&
    Number.isFinite(source.hiddenDeviceCount) &&
    source.hiddenDeviceCount >= 0
      ? Math.floor(source.hiddenDeviceCount)
      : 0
  return {
    platform: platformValue.length > 0 ? platformValue : platform,
    supported: asBoolean(source.supported),
    status: asDeviceStatus(source.status),
    devices,
    hiddenDeviceCount,
    audio: normalizeAudioSnapshot(source.audio),
    pointer: normalizePointerSnapshot(source.pointer),
    warnings,
    updatedAt,
    updatedAtLabel: formatDeviceUpdatedLabel(updatedAt)
  }
}
