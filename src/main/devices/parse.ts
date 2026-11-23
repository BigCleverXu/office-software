// 设备模块：平台输出的纯函数解析
// 不依赖 electron，任何非法输入都降级为空结果，不抛异常
import {
  clampVolume,
  type AudioOutputDevice,
  type DeviceConnection,
  type DeviceInfo,
  type DeviceKind
} from '../../shared/devices'

/** 名称关键词：耳机类 */
const HEADSET_PATTERN =
  /耳机|headset|headphone|airpods|buds|hands[- ]?free|handsfree|免提/i

/** 名称关键词：音箱类 */
const SPEAKER_PATTERN = /音箱|speaker/i

/** 名称关键词：手柄类 */
const GAMEPAD_PATTERN = /手柄|gamepad|controller|joystick/i

/** 名称关键词：鼠标 */
const MOUSE_PATTERN = /鼠标|mouse/i

/** 名称关键词：键盘 */
const KEYBOARD_PATTERN = /键盘|keyboard/i

/** 名称关键词：显示器 */
const DISPLAY_PATTERN = /显示器|monitor|display/i

/** 名称关键词：2.4G 无线接收器 */
const RECEIVER_PATTERN = /receiver|接收器|dongle|2\.4g|无线适配器|usb receiver/i

/** 蓝牙 HFP AudioGateway 服务节点（电量常挂在这里） */
const HFP_AUDIO_PATTERN = /^BTHENUM\\\{0000111[EF]-/i

/** 蓝牙 AVRCP 服务节点：不参与音频归并 */
const AVRCP_PATTERN = /^BTHENUM\\\{0000110[CE]-/i

/** macOS USB 外设关键词：只保留与外设相关的项 */
const USB_PERIPHERAL_PATTERN =
  /鼠标|键盘|接收器|receiver|wireless|2\.4g|dongle|mouse|keyboard/i

/** 设备类别排序：与共享类型声明顺序一致 */
const KIND_ORDER: readonly DeviceKind[] = [
  'mouse',
  'keyboard',
  'headset',
  'speaker',
  'display',
  'gamepad',
  'other'
]

/** 归并时用于挑选代表设备的类别优先级 */
const GROUP_KIND_PRIORITY: readonly DeviceKind[] = [
  'mouse',
  'keyboard',
  'headset',
  'speaker',
  'display',
  'gamepad'
]

/** 连接方式优先级：同一物理设备取「最具体」的连接方式 */
const CONNECTION_PRIORITY: readonly DeviceConnection[] = [
  'bluetooth',
  'wireless',
  'usb',
  'builtin',
  'unknown'
]

/** 通用名称：不能作为设备展示名 */
const GENERIC_NAME_PATTERN =
  /^(USB 输入设备|USB Input Device|HID-compliant mouse|HID Keyboard Device|HID-compliant device|USB Composite Device)$/i

/** 虚拟 / 内部设备的关键词（匹配实例 ID 或名称） */
const VIRTUAL_DEVICE_PATTERN =
  /VHF|虚拟|Virtual|HID_DEVICE_SYSTEM|符合\s*HID\s*标准|HID-compliant|Microsoft Input Configuration|Intel\(R\)\s*ISS|流服务代理|Root Enumerated/i

/** 内置设备名称关键词 */
const INTERNAL_DEVICE_PATTERN =
  /Integrated Monitor|内置|Internal|Trackpad|触控板/i

/** macOS 内部设备名称关键词 */
const MAC_INTERNAL_PATTERN =
  /Built-in|Internal|Apple Internal|Trackpad|iBridge|T2|Virtual|虚拟/i

/** 非法 / 兜底容器 GUID（全零与 root-enumerated 默认容器） */
const INVALID_CONTAINER_PATTERN =
  /^\{?(0{8}-0{4}-0{4}-0{4}-0{12}|00000000-0000-0000-ffff-ffffffffffff)\}?$/i

/** pnp-devices.ps1 输出的一条原始设备记录 */
export interface WindowsRawDevice {
  id: string
  name: string
  className: string
  instanceId: string
  vendor: string | null
  battery: number | null
  containerId: string | null
  busName: string | null
  /** 电量来源；缺省（旧数据）视为 'none' */
  batterySource?: BatterySource
  /** 测试夹具可直接提供 AEP 电量，解析时归一化到 battery */
  aepBattery?: number | null
  aepCharging?: number | null
}

/** 电量来源 */
export type BatterySource = 'pnp' | 'aep-battery' | 'aep-charging' | 'none'

/** 解析后的设备场景：可见设备 + 被隐藏的容器数 */
export interface ParsedDeviceScene {
  devices: DeviceInfo[]
  hiddenDeviceCount: number
}

/** 判断是否为普通对象（排除数组与 null） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 取字符串，非字符串返回空串 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 取去空白后的非空字符串，否则返回空串 */
function asTrimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 统一成数组：数组原样返回，单个值包成单元素数组，空值返回空数组 */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  if (value === null || value === undefined) {
    return []
  }
  return [value]
}

/** 解析 JSON 文本，空串 / 非法 JSON 返回 null */
function parseJsonText(text: unknown): unknown {
  if (typeof text !== 'string') {
    return null
  }
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (trimmed === '') {
    return null
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

/** 解析 JSON 文本或直接使用已解析的入参 */
function parseJsonInput(input: unknown): unknown {
  return typeof input === 'string' ? parseJsonText(input) : input
}

/**
 * 把字符串 / 数字形式的电量解析为 0–100 整数。
 * 支持 "85%"、"84"、84 等形式；无法解析或越界返回 null。
 */
function parsePercent(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return null
    }
    return Math.round(value)
  }
  if (typeof value !== 'string') {
    return null
  }
  const match = value.match(/-?\d+(?:\.\d+)?/)
  if (match === null) {
    return null
  }
  const parsed = Number(match[0])
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return null
  }
  return Math.round(parsed)
}

/** 按名称关键词推断设备类别（键盘优先于鼠标，避免键盘的鼠标集合误判） */
function kindFromName(name: string): DeviceKind {
  if (KEYBOARD_PATTERN.test(name)) {
    return 'keyboard'
  }
  if (MOUSE_PATTERN.test(name)) {
    return 'mouse'
  }
  if (HEADSET_PATTERN.test(name)) {
    return 'headset'
  }
  if (SPEAKER_PATTERN.test(name)) {
    return 'speaker'
  }
  if (DISPLAY_PATTERN.test(name)) {
    return 'display'
  }
  if (GAMEPAD_PATTERN.test(name)) {
    return 'gamepad'
  }
  return 'other'
}

/** 是否为蓝牙枚举节点（BTHENUM / BTHLE） */
function isBluetoothInstance(instanceId: string): boolean {
  return /^BTH(ENUM|LE)\\/i.test(instanceId.trim())
}

/** 是否为蓝牙音频节点（MEDIA / HFP / AEP / 同名 DEV 节点） */
function isBluetoothAudioRecord(record: WindowsRawDevice): boolean {
  const category = record.className.trim().toLowerCase()
  const id = record.instanceId.trim()
  if (category === 'bluetoothaep') {
    return true
  }
  if (AVRCP_PATTERN.test(id)) {
    return false
  }
  if (HFP_AUDIO_PATTERN.test(id)) {
    return true
  }
  if (category === 'media' && isBluetoothInstance(id)) {
    return true
  }
  return (
    /^BTHENUM\\DEV_/i.test(id) &&
    (HEADSET_PATTERN.test(record.name) || SPEAKER_PATTERN.test(record.name))
  )
}

/** 从数字或 "100;1" 等复合值中提取第一个 0–100 整数 */
function parseLoosePercent(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return null
    }
    return Math.round(value)
  }
  if (typeof value !== 'string') {
    return null
  }
  for (const match of value.match(/\d+/g) ?? []) {
    const parsed = Number(match)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      return parsed
    }
  }
  return null
}

/** 归一化电量来源，非法值返回 null */
function parseBatterySource(value: unknown): BatterySource | null {
  return value === 'pnp' ||
    value === 'aep-battery' ||
    value === 'aep-charging' ||
    value === 'none'
    ? value
    : null
}

/**
 * 蓝牙音频节点名称归一化。
 *
 * 去掉括号内容与 Stereo / Hands-Free AG Audio / 免提 / 麦克风 等后缀，
 * 让同一耳机的多个系统节点得到相同名称。
 */
export function normalizeBluetoothAudioName(name: string): string {
  if (typeof name !== 'string') {
    return ''
  }
  let text = name.trim()
  if (text === '') {
    return ''
  }
  text = text.replace(/\([^()]*\)/g, ' ').replace(/（[^（）]*）/g, ' ')
  const suffixes: readonly RegExp[] = [
    /Hands[- ]?Free\s*AG\s*Audio$/i,
    /Hands[- ]?Free\s*AG$/i,
    /Hands[- ]?Free$/i,
    /Stereo$/i,
    /AG\s*Audio$/i,
    /免提$/i,
    /麦克风$/i,
    /Microphone$/i,
    /(?:^|\s)(?:AG|Audio)$/i
  ]
  let changed = true
  while (changed) {
    changed = false
    const trimmed = text.replace(/[\s\-–—,:：]+$/g, '').trim()
    if (trimmed !== text) {
      text = trimmed
      changed = true
    }
    for (const pattern of suffixes) {
      const next = text.replace(pattern, '').trim()
      if (next !== text) {
        text = next
        changed = true
      }
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

/** 按 macOS 的 device_minorType 推断类别，无法识别返回 null */
function kindFromMinorType(minorType: string): DeviceKind | null {
  const value = minorType.trim().toLowerCase()
  if (value === 'mouse') {
    return 'mouse'
  }
  if (value === 'keyboard') {
    return 'keyboard'
  }
  if (
    value === 'headphones' ||
    value === 'headset' ||
    value === 'earbuds' ||
    value === 'earphone'
  ) {
    return 'headset'
  }
  if (value === 'speaker') {
    return 'speaker'
  }
  if (value === 'gamepad' || value === 'joystick' || value === 'controller') {
    return 'gamepad'
  }
  if (value === 'display' || value === 'monitor') {
    return 'display'
  }
  return null
}

/**
 * 推断 Windows 设备的连接方式。
 *
 * 蓝牙枚举前缀优先；名称含 receiver / 接收器 / dongle / 2.4G 等关键词视为
 * 2.4G 无线；其余 USB / HID 为有线；ACPI / ROOT / SWD 为内置，其它未知。
 * className 保留以兼容既有调用，连接方式不再依赖 PnP Class。
 */
export function classifyWindowsConnection(
  instanceId: string,
  className: string,
  name = ''
): DeviceConnection {
  void className
  const id = asTrimmedText(instanceId)
  const category = asTrimmedText(className).toLowerCase()
  if (category === 'bluetoothaep') {
    return 'bluetooth'
  }
  if (
    /^BTHENUM\\/i.test(id) ||
    /^BTHLE\\/i.test(id) ||
    /^BTHHFENUM\\/i.test(id)
  ) {
    return 'bluetooth'
  }
  if (RECEIVER_PATTERN.test(asTrimmedText(name))) {
    return 'wireless'
  }
  if (/^USB\\/i.test(id) || /^HID\\/i.test(id)) {
    return 'usb'
  }
  if (/^ACPI\\/i.test(id) || /^ROOT\\/i.test(id) || /^SWD\\/i.test(id)) {
    return 'builtin'
  }
  return 'unknown'
}

/**
 * 推断 Windows 设备的类别。
 *
 * 先按 PnP Class 判定鼠标 / 键盘 / 显示器与媒体设备；其余按名称关键词补判
 * 耳机、音箱、鼠标、键盘、手柄（通用名可借助 busName 归一化后归类）。
 */
export function classifyWindowsKind(
  className: string,
  name: string
): DeviceKind {
  const category = asTrimmedText(className).toLowerCase()
  const text = asTrimmedText(name)
  if (category === 'mouse') {
    return 'mouse'
  }
  if (category === 'keyboard') {
    return 'keyboard'
  }
  if (category === 'monitor') {
    return 'display'
  }
  if (category === 'media') {
    // 蓝牙音频节点按名称区分耳机 / 音箱；非蓝牙 MEDIA 会在过滤阶段剔除
    return SPEAKER_PATTERN.test(text) ? 'speaker' : 'headset'
  }
  if (HEADSET_PATTERN.test(text)) {
    return 'headset'
  }
  if (SPEAKER_PATTERN.test(text)) {
    return 'speaker'
  }
  if (MOUSE_PATTERN.test(text)) {
    return 'mouse'
  }
  if (KEYBOARD_PATTERN.test(text)) {
    return 'keyboard'
  }
  if (GAMEPAD_PATTERN.test(text)) {
    return 'gamepad'
  }
  return 'other'
}

/** 设备类别排序权重 */
function kindRank(kind: DeviceKind): number {
  const index = KIND_ORDER.indexOf(kind)
  return index === -1 ? KIND_ORDER.length : index
}

/** 归一化容器 id：空串、全零与 root 默认容器视为无容器 */
function normalizeContainerId(value: string): string | null {
  const text = value.trim()
  if (text === '' || INVALID_CONTAINER_PATTERN.test(text)) {
    return null
  }
  return text
}

/** 是否为不能作为展示名的通用名称 */
function isGenericName(name: string): boolean {
  return GENERIC_NAME_PATTERN.test(name.trim())
}

/**
 * 判断设备是否属于虚拟 / 内置 / 蓝牙适配器条目。
 *
 * 这些条目对用户不可感知：HID 集合、虚拟 HID 框架、系统输入设备、
 * ACPI / I2C 内置设备、以及以 USB 形式出现的蓝牙适配器本身。
 */
export function isVirtualOrInternalDevice(
  instanceId: string,
  name: string,
  className: string
): boolean {
  const id = asTrimmedText(instanceId)
  const text = asTrimmedText(name)
  const category = asTrimmedText(className).toLowerCase()
  const combined = `${id}\n${text}`
  if (category === 'bluetoothaep') {
    return false
  }
  // AVRCP / A/V Remote Control 只是服务节点，不作为设备展示
  if (AVRCP_PATTERN.test(id)) {
    return true
  }
  if (VIRTUAL_DEVICE_PATTERN.test(combined)) {
    return true
  }
  if (/^ACPI\\/i.test(id) || /I2C HID/i.test(combined)) {
    return true
  }
  if (INTERNAL_DEVICE_PATTERN.test(text)) {
    return true
  }
  if (category === 'media') {
    // 只保留蓝牙耳机 / 音箱节点，音频驱动与其它 MEDIA 一律隐藏
    if (!isBluetoothInstance(id)) {
      return true
    }
    if (!HEADSET_PATTERN.test(text) && !SPEAKER_PATTERN.test(text)) {
      return true
    }
  }
  if (category === 'bluetooth' && /^USB\\/i.test(id)) {
    return true
  }
  if (/^(SWD|ROOT)\\/i.test(id)) {
    return true
  }
  return false
}

/** 单个原始记录的类别：名称无法判定时借助 busName */
function recordKind(record: WindowsRawDevice): DeviceKind {
  const byName = classifyWindowsKind(record.className, record.name)
  if (byName !== 'other') {
    return byName
  }
  return record.busName === null
    ? 'other'
    : classifyWindowsKind(record.className, record.busName)
}

/** 组内类别：按固定优先级取第一个命中项，未命中为 other */
function groupKind(records: WindowsRawDevice[]): DeviceKind {
  for (const kind of GROUP_KIND_PRIORITY) {
    if (records.some((record) => recordKind(record) === kind)) {
      return kind
    }
  }
  return 'other'
}

/** 挑选代表项：有电量 > 类别优先级 > 名称更具体 */
function representativeOf(
  kept: WindowsRawDevice[],
  all: WindowsRawDevice[]
): WindowsRawDevice {
  const pool = kept.length > 0 ? kept : all
  let best = pool[0]
  let bestScore = -1
  for (const record of pool) {
    let score = 0
    if (record.battery !== null) {
      score += 100
    }
    const index = GROUP_KIND_PRIORITY.indexOf(recordKind(record))
    if (index !== -1) {
      score += (GROUP_KIND_PRIORITY.length - index) * 10
    }
    if (record.name !== '' && !isGenericName(record.name)) {
      score += 5
    }
    if (score > bestScore) {
      bestScore = score
      best = record
    }
  }
  return best
}

/** 展示名：busName > 最简洁的非通用名（蓝牙音频取归一化名）> 代表项 > 未命名设备 */
function displayNameOf(
  kept: WindowsRawDevice[],
  all: WindowsRawDevice[],
  representative: WindowsRawDevice
): string {
  const ordered = [...kept, ...all.filter((record) => !kept.includes(record))]
  const bluetoothAudio = ordered.some(isBluetoothAudioRecord)
  // 蓝牙音频的 busName 多为服务名（A2DP SNK Service 等），不能作为展示名
  if (!bluetoothAudio) {
    for (const record of ordered) {
      if (record.busName !== null && record.busName.trim() !== '') {
        return record.busName
      }
    }
  }
  const names = ordered
    .map((record) => record.name)
    .filter((name) => name !== '' && !isGenericName(name))
    .map((name) => (bluetoothAudio ? normalizeBluetoothAudioName(name) : name))
    .filter((name) => name !== '')
  if (names.length > 0) {
    // 蓝牙音频的多种节点名称归一化后可能相同，取最短的可读名称
    return bluetoothAudio
      ? names.reduce((best, current) =>
          current.length < best.length ? current : best
        )
      : names[0]
  }
  return representative.name !== '' ? representative.name : '未命名设备'
}

/** 连接方式取组内优先级最高的一项，名称取 busName 或展示名 */
function groupConnection(
  records: WindowsRawDevice[],
  displayName: string
): DeviceConnection {
  const connections = records.map((record) =>
    classifyWindowsConnection(
      record.instanceId,
      record.className,
      record.busName ?? displayName
    )
  )
  for (const connection of CONNECTION_PRIORITY) {
    if (connections.includes(connection)) {
      return connection
    }
  }
  return 'unknown'
}

/** 厂商取组内第一个非空值 */
function groupVendor(
  kept: WindowsRawDevice[],
  all: WindowsRawDevice[]
): string | null {
  for (const record of [...kept, ...all]) {
    if (record.vendor !== null && record.vendor !== '') {
      return record.vendor
    }
  }
  return null
}

/** 电量取组内第一个非 null 值 */
function groupBattery(
  records: WindowsRawDevice[]
): { percent: number; charging: boolean } | null {
  for (const record of records) {
    if (record.battery !== null) {
      return { percent: record.battery, charging: false }
    }
  }
  return null
}

/** 由一个归并组构建可见设备 */
function buildDeviceFromGroup(
  records: WindowsRawDevice[],
  kept: WindowsRawDevice[],
  representative: WindowsRawDevice,
  name: string,
  kind: DeviceKind
): DeviceInfo {
  return {
    id:
      representative.instanceId ||
      representative.id ||
      representative.name ||
      '未命名设备',
    name,
    kind,
    connection: groupConnection(records, name),
    vendor: groupVendor(kept, records),
    model: null,
    connected: true,
    battery: groupBattery(records)
  }
}

/** 解析一个归并组；没有任何可见设备时返回 null */
function resolveGroup(records: WindowsRawDevice[]): DeviceInfo | null {
  const kept = records.filter(
    (record) =>
      !isVirtualOrInternalDevice(
        record.instanceId,
        record.name,
        record.className
      )
  )
  if (kept.length === 0) {
    return null
  }
  const representative = representativeOf(kept, records)
  const name = displayNameOf(kept, records, representative)
  // 名称优先（避免键盘的鼠标集合把键盘判成鼠标），类别权重兜底
  const nameKind = kindFromName(name)
  const kind = nameKind !== 'other' ? nameKind : groupKind(records)
  if (kind === 'other') {
    return null
  }
  return buildDeviceFromGroup(records, kept, representative, name, kind)
}

/**
 * 归并键：蓝牙音频（含 AEP 合成行）优先用归一化名称，保证与同名 PnP 节点合并；
 * 其余按容器 id > 实例 id。
 */
function groupKeyOf(record: WindowsRawDevice): string {
  if (isBluetoothAudioRecord(record)) {
    const normalized = normalizeBluetoothAudioName(record.name).toLowerCase()
    if (normalized !== '') {
      return `btaudio:${normalized}`
    }
  }
  if (record.containerId !== null) {
    return `container:${record.containerId.toLowerCase()}`
  }
  const fallback = record.instanceId || record.id || record.name
  return `instance:${fallback.toLowerCase()}`
}

/**
 * 解析 pnp-devices.ps1 的 JSON 输出为原始记录。
 * 接受数组 / 单对象；空串与非法 JSON 返回空数组。
 */
export function parseWindowsRawDevices(stdout: string): WindowsRawDevice[] {
  const parsed = parseJsonText(stdout)
  if (parsed === null) {
    return []
  }
  const items: WindowsRawDevice[] = []
  for (const item of toArray(parsed)) {
    if (!isRecord(item)) {
      continue
    }
    if ('connected' in item && item.connected !== true) {
      continue
    }
    const instanceId = asTrimmedText(item.instanceId) || asTrimmedText(item.id)
    const name = asTrimmedText(item.name) || instanceId
    if (instanceId === '' && name === '') {
      continue
    }
    const batteryValue = item.battery
    const pnpBattery =
      typeof batteryValue === 'number' &&
      Number.isFinite(batteryValue) &&
      batteryValue >= 0 &&
      batteryValue <= 100
        ? batteryValue
        : null
    const aepBattery = parseLoosePercent(item.aepBattery)
    const aepCharging = parseLoosePercent(item.aepCharging)
    let battery = pnpBattery
    let batterySource: BatterySource = pnpBattery !== null ? 'pnp' : 'none'
    if (battery === null && aepBattery !== null) {
      battery = aepBattery
      batterySource = 'aep-battery'
    }
    if (battery === null && aepCharging !== null) {
      battery = aepCharging
      batterySource = 'aep-charging'
    }
    const declaredSource = parseBatterySource(item.batterySource)
    if (
      declaredSource !== null &&
      declaredSource !== 'none' &&
      battery !== null
    ) {
      batterySource = declaredSource
    }
    const vendor = asTrimmedText(item.vendor)
    const containerId = normalizeContainerId(asTrimmedText(item.containerId))
    const busName = asTrimmedText(item.busName)
    items.push({
      id: asTrimmedText(item.id) || instanceId,
      name,
      className: asTrimmedText(item.class) || asTrimmedText(item.className),
      instanceId,
      vendor: vendor === '' ? null : vendor,
      battery,
      containerId,
      busName: busName === '' ? null : busName,
      batterySource,
      aepBattery,
      aepCharging
    })
  }
  return items
}

/** 按容器归并原始记录，只返回可见设备 */
export function mergeByContainer(items: WindowsRawDevice[]): DeviceInfo[] {
  return buildWindowsDevices(items).devices
}

/**
 * 由原始记录构建设备场景。
 *
 * 先按容器分组（无容器按实例独立成组），过滤虚拟 / 内置条目；
 * 组内没有任何可见记录或类别为 other 时计入隐藏容器数。
 * 结果按类别顺序与名称本地化排序。
 */
export function buildWindowsDevices(
  raw: WindowsRawDevice[]
): ParsedDeviceScene {
  const groups = new Map<string, WindowsRawDevice[]>()
  for (const record of raw) {
    const key = groupKeyOf(record)
    const list = groups.get(key)
    if (list === undefined) {
      groups.set(key, [record])
    } else {
      list.push(record)
    }
  }
  const devices: DeviceInfo[] = []
  let hiddenDeviceCount = 0
  for (const records of groups.values()) {
    const device = resolveGroup(records)
    if (device === null) {
      hiddenDeviceCount += 1
      continue
    }
    devices.push(device)
  }
  devices.sort(
    (left, right) =>
      kindRank(left.kind) - kindRank(right.kind) ||
      left.name.localeCompare(right.name, 'zh-CN')
  )
  return { devices, hiddenDeviceCount }
}

/** 解析脚本输出并返回收敛后的设备场景 */
export function parseWindowsDevices(stdout: string): ParsedDeviceScene {
  return buildWindowsDevices(parseWindowsRawDevices(stdout))
}

/** 蓝牙条目：details 为设备字段，nameHint 为「以名称为键」时的键名 */
interface BluetoothEntry {
  details: Record<string, unknown>
  nameHint: string
}

/** 判断对象自身是否就是设备字段集合 */
function looksLikeBluetoothDevice(value: Record<string, unknown>): boolean {
  const keys = [
    '_name',
    'device_name',
    'device_address',
    'device_minorType',
    'device_batteryLevel',
    'device_batteryPercent'
  ]
  return keys.some((key) => key in value)
}

/**
 * 展开 device_connected。
 * macOS 不同版本可能输出对象数组、单个对象，或以设备名为键的字典，统一展开。
 */
function bluetoothEntries(raw: unknown): BluetoothEntry[] {
  const entries: BluetoothEntry[] = []
  for (const item of toArray(raw)) {
    if (!isRecord(item)) {
      continue
    }
    if (looksLikeBluetoothDevice(item)) {
      entries.push({ details: item, nameHint: '' })
      continue
    }
    for (const [key, value] of Object.entries(item)) {
      if (isRecord(value)) {
        entries.push({ details: value, nameHint: key })
      }
    }
  }
  return entries
}

/** 取蓝牙设备电量：取第一个可解析的电量字段，全都不可解析时为 null */
function bluetoothBattery(details: Record<string, unknown>): {
  percent: number | null
  charging: boolean
} | null {
  const candidates: unknown[] = [
    details.device_batteryPercent,
    details.device_batteryLevel,
    details.device_batteryLevelMain,
    details.device_batteryLevelLeft,
    details.device_batteryLevelRight,
    details.device_batteryLevelCase
  ]
  for (const candidate of candidates) {
    const percent = parsePercent(candidate)
    if (percent !== null) {
      return { percent, charging: false }
    }
  }
  return null
}

/** macOS 名称是否属于内置 / 虚拟设备 */
function isMacInternalDeviceName(name: string): boolean {
  return (
    MAC_INTERNAL_PATTERN.test(name) || isVirtualOrInternalDevice('', name, '')
  )
}

/**
 * 解析 `system_profiler SPBluetoothDataType -json`。
 * 只读取 device_connected；名称缺失时回退到字典键或设备地址；
 * 内置 / 虚拟设备被过滤并计入 hiddenDeviceCount。
 */
export function parseMacBluetoothDevices(json: unknown): ParsedDeviceScene {
  const root = parseJsonInput(json)
  if (!isRecord(root)) {
    return { devices: [], hiddenDeviceCount: 0 }
  }
  const devices: DeviceInfo[] = []
  let hiddenDeviceCount = 0
  for (const section of toArray(root.SPBluetoothDataType)) {
    if (!isRecord(section)) {
      continue
    }
    for (const entry of bluetoothEntries(section.device_connected)) {
      const details = entry.details
      const address = asTrimmedText(details.device_address)
      const name =
        asTrimmedText(details._name) ||
        asTrimmedText(details.device_name) ||
        entry.nameHint ||
        address
      if (name === '') {
        continue
      }
      if (isMacInternalDeviceName(name)) {
        hiddenDeviceCount += 1
        continue
      }
      const minorType = asTrimmedText(details.device_minorType)
      const vendor = asTrimmedText(details.device_manufacturer)
      devices.push({
        id: address === '' ? name : address,
        name,
        kind: kindFromMinorType(minorType) ?? kindFromName(name),
        connection: 'bluetooth',
        vendor: vendor === '' ? null : vendor,
        model: null,
        connected: true,
        battery: bluetoothBattery(details)
      })
    }
  }
  return { devices, hiddenDeviceCount }
}

/**
 * 解析 `system_profiler SPUSBDataType -json`。
 * 递归遍历 `_items`，只保留名称匹配鼠标 / 键盘 / 接收器 / Wireless / 2.4G / dongle 的项；
 * 内置 / 虚拟设备被过滤并计入 hiddenDeviceCount。
 */
export function parseMacUsbDevices(json: unknown): ParsedDeviceScene {
  const root = parseJsonInput(json)
  if (!isRecord(root)) {
    return { devices: [], hiddenDeviceCount: 0 }
  }
  const devices: DeviceInfo[] = []
  const seen = new Set<string>()
  let hiddenDeviceCount = 0
  const visit = (node: unknown): void => {
    if (!isRecord(node)) {
      return
    }
    const name = asTrimmedText(node._name)
    if (name !== '' && USB_PERIPHERAL_PATTERN.test(name)) {
      if (isMacInternalDeviceName(name)) {
        hiddenDeviceCount += 1
      } else {
        const serial = asTrimmedText(node.serial_num)
        const baseId = serial === '' ? name : serial
        let id = baseId
        let index = 1
        while (seen.has(id)) {
          id = `${baseId}#${index}`
          index += 1
        }
        seen.add(id)
        const vendor = asTrimmedText(node.manufacturer)
        devices.push({
          id,
          name,
          kind: kindFromName(name),
          connection: 'wireless',
          vendor: vendor === '' ? null : vendor,
          model: null,
          connected: true,
          battery: null
        })
      }
    }
    for (const child of toArray(node._items)) {
      visit(child)
    }
  }
  for (const section of toArray(root.SPUSBDataType)) {
    visit(section)
  }
  return { devices, hiddenDeviceCount }
}

/**
 * 解析 `system_profiler SPDisplaysDataType -json`。
 * 每个 GPU 条目的 `spdisplays_ndrvs` 下每台显示器一条；内置屏被过滤并计入隐藏数，
 * Pro Display / Studio Display 视为外接 USB，其余视为外接显示器。
 */
export function parseMacDisplays(json: unknown): ParsedDeviceScene {
  const root = parseJsonInput(json)
  if (!isRecord(root)) {
    return { devices: [], hiddenDeviceCount: 0 }
  }
  const devices: DeviceInfo[] = []
  const seen = new Map<string, number>()
  let hiddenDeviceCount = 0
  for (const gpu of toArray(root.SPDisplaysDataType)) {
    if (!isRecord(gpu)) {
      continue
    }
    for (const display of toArray(gpu.spdisplays_ndrvs)) {
      if (!isRecord(display)) {
        continue
      }
      const name = asTrimmedText(display._name)
      if (name === '') {
        continue
      }
      if (isMacInternalDeviceName(name)) {
        hiddenDeviceCount += 1
        continue
      }
      const serial = asTrimmedText(display['_spdisplays_display-serial-number'])
      const product = asTrimmedText(display['_spdisplays_display-product-id'])
      const baseId = serial || product || name
      const count = seen.get(baseId) ?? 0
      seen.set(baseId, count + 1)
      const vendor = asTrimmedText(display.spdisplays_vendor)
      devices.push({
        id: count === 0 ? baseId : `${baseId}#${count}`,
        name,
        kind: 'display',
        connection: /Pro Display|Studio Display/i.test(name)
          ? 'usb'
          : 'builtin',
        vendor: vendor === '' ? null : vendor,
        model: null,
        connected: true,
        battery: null
      })
    }
  }
  return { devices, hiddenDeviceCount }
}

/** 判断音频节点是否具备输出能力 */
function isAudioOutputNode(node: Record<string, unknown>): boolean {
  return (
    'coreaudio_output_source' in node ||
    node.coreaudio_default_audio_output_device === 'spaudio_yes' ||
    node.spaudio_default_output_device === 'spaudio_yes'
  )
}

/**
 * 解析 `system_profiler SPAudioDataType -json`。
 * 递归查找有输出能力的节点；带默认标记的项 isDefault=true，否则第一项为默认。
 */
export function parseMacAudioOutputs(json: unknown): AudioOutputDevice[] {
  const root = parseJsonInput(json)
  if (!isRecord(root)) {
    return []
  }
  const outputs: AudioOutputDevice[] = []
  const seen = new Set<string>()
  const visit = (node: unknown): void => {
    if (!isRecord(node)) {
      return
    }
    const name = asTrimmedText(node._name)
    const flaggedDefault =
      node.coreaudio_default_audio_output_device === 'spaudio_yes' ||
      node.spaudio_default_output_device === 'spaudio_yes'
    if (name !== '' && isAudioOutputNode(node) && !seen.has(name)) {
      seen.add(name)
      outputs.push({
        id: name,
        name,
        isDefault: flaggedDefault,
        volume: null,
        muted: false,
        controllable: false
      })
    }
    for (const child of toArray(node._items)) {
      visit(child)
    }
  }
  for (const section of toArray(root.SPAudioDataType)) {
    visit(section)
  }
  if (outputs.length > 0 && !outputs.some((item) => item.isDefault)) {
    outputs[0].isDefault = true
  }
  return outputs
}

/** 解析 `osascript -e 'get volume settings'` 的输出 */
export function parseMacVolumeSettings(stdout: string): {
  volume: number | null
  muted: boolean
} {
  if (typeof stdout !== 'string') {
    return { volume: null, muted: false }
  }
  const volumeMatch = /output volume:\s*([\d.]+)/i.exec(stdout)
  const mutedMatch = /output muted:\s*(true|false)/i.exec(stdout)
  return {
    volume: volumeMatch === null ? null : clampVolume(Number(volumeMatch[1])),
    muted: mutedMatch === null ? false : mutedMatch[1].toLowerCase() === 'true'
  }
}

/** 解析 `defaults` 输出的指针速度浮点数 */
export function parseMacPointerScaling(stdout: string): number | null {
  if (typeof stdout !== 'string') {
    return null
  }
  const trimmed = stdout.trim()
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return null
  }
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * 解析 audio.ps1 的输出。
 * JSON 非法或结构不符时降级为空结果；controllable 默认 true（Windows 支持逐设备音量）。
 */
export function parseWindowsAudio(stdout: string): {
  masterVolume: number | null
  masterMuted: boolean
  outputs: AudioOutputDevice[]
} {
  const parsed = parseJsonText(stdout)
  if (!isRecord(parsed)) {
    return { masterVolume: null, masterMuted: false, outputs: [] }
  }
  const outputs: AudioOutputDevice[] = []
  for (const item of toArray(parsed.outputs)) {
    if (!isRecord(item)) {
      continue
    }
    outputs.push({
      id: asText(item.id),
      name: asText(item.name),
      isDefault: item.isDefault === true,
      volume: clampVolume(item.volume),
      muted: item.muted === true,
      controllable: item.controllable !== false
    })
  }
  return {
    masterVolume: clampVolume(parsed.masterVolume),
    masterMuted: parsed.masterMuted === true,
    outputs
  }
}
