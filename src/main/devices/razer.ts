// 设备模块：雷蛇 2.4G 外设电量解析（纯函数，不依赖 electron）
// 协议参考：90 字节 feature report，command class 0x07 / id 0x80 读取电量

import type { DeviceInfo } from '../../shared/devices'

/** 单条命令的原始响应 */
export interface RazerAttempt {
  commandClass: number
  commandId: number
  protocolType: number
  ok: boolean
  responseHex: string
  error: string | null
}

/** 单个雷蛇 HID 接口的查询结果 */
export interface RazerInterfaceResult {
  instanceId: string
  containerId: string | null
  product: string
  usagePage: number
  usage: number
  attempts: RazerAttempt[]
}

/** 解析出的电量 */
export interface RazerBattery {
  percent: number
  charging: boolean
  commandClass: number
  commandId: number
}

/** 协议帧长度 */
const FRAME_LENGTH = 90

/** 电量响应至少需要的字节数 */
const MIN_RESPONSE_LENGTH = 12

/** 把十六进制响应解析为字节数组 */
export function parseRazerResponse(
  responseHex: string
): { ok: true; responseBytes: number[] } | { ok: false; reason: string } {
  if (typeof responseHex !== 'string' || responseHex.trim() === '') {
    return { ok: false, reason: '空响应' }
  }
  const text = responseHex.trim()
  if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) {
    return { ok: false, reason: '非法的十六进制响应' }
  }
  const responseBytes: number[] = []
  for (let index = 0; index < text.length; index += 2) {
    responseBytes.push(Number.parseInt(text.slice(index, index + 2), 16))
  }
  return { ok: true, responseBytes }
}

/**
 * 计算帧校验：字节 2–87 的 XOR。
 *
 * 传入不足 88 字节的数组时只计算到末尾，便于单测直接验证中间片段。
 */
export function razerChecksum(bytes: number[]): number {
  let checksum = 0
  const end = Math.min(88, bytes.length)
  for (let index = 2; index < end; index += 1) {
    checksum ^= bytes[index] & 0xff
  }
  return checksum & 0xff
}

/** 构造 90 字节请求帧 */
export function buildRazerFrame(input: {
  transactionId: number
  dataSize: number
  commandClass: number
  commandId: number
  arguments: number[]
  protocolType?: number
}): Uint8Array {
  const frame = new Uint8Array(FRAME_LENGTH)
  frame[0] = 0
  frame[1] = input.transactionId & 0xff
  frame[4] = (input.protocolType ?? 0) & 0xff
  frame[5] = input.dataSize & 0xff
  frame[6] = input.commandClass & 0xff
  frame[7] = input.commandId & 0xff
  const args = input.arguments
  for (let index = 0; index < args.length && 8 + index < 88; index += 1) {
    frame[8 + index] = args[index] & 0xff
  }
  frame[88] = razerChecksum(Array.from(frame))
  frame[89] = 0
  return frame
}

/**
 * 归一化响应的 Report ID 前缀。
 *
 * Windows 的 HidD_GetFeature 返回 91 字节时，首字节为 Report ID（0x00），
 * 真正的 Razer 帧从第 2 字节开始；无前缀的 90 字节响应原样返回。
 */
export function normalizeRazerFrame(bytes: number[]): number[] {
  if (bytes.length >= 91 && bytes[0] === 0x00 && bytes[1] === 0x02) {
    return bytes.slice(1)
  }
  if (bytes.length >= 90 && bytes[0] === 0x02) {
    return bytes
  }
  return bytes
}

/**
 * 从响应中解析电量。
 *
 * 先去掉可能的 Report ID；status 必须为 0x02。电量原始值为 0–255：
 * ≤ 100 视为百分比，> 100 按 value / 255 * 100 换算；非 0 表示充电中。
 */
export function parseRazerBattery(responseHex: string): RazerBattery | null {
  const parsed = parseRazerResponse(responseHex)
  if (!parsed.ok) {
    return null
  }
  const bytes = normalizeRazerFrame(parsed.responseBytes)
  if (bytes.length < MIN_RESPONSE_LENGTH) {
    return null
  }
  if (bytes[0] !== 0x02) {
    return null
  }
  const raw = bytes[9]
  if (!Number.isInteger(raw) || raw < 0 || raw > 255) {
    return null
  }
  const percent = raw <= 100 ? raw : Math.round((raw / 255) * 100)
  return {
    percent,
    charging: bytes[10] !== 0,
    commandClass: bytes[6],
    commandId: bytes[7]
  }
}

/** 按命令矩阵顺序选择第一个解析成功的响应 */
export function selectRazerBattery(
  attempts: RazerAttempt[]
): RazerBattery | null {
  for (const attempt of attempts) {
    const battery = parseRazerBattery(attempt.responseHex)
    if (battery) {
      return {
        percent: battery.percent,
        charging: battery.charging,
        commandClass: attempt.commandClass,
        commandId: attempt.commandId
      }
    }
  }
  return null
}

/** 数字字段归一化 */
function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 解析 razer-battery.ps1 输出（数组 / 单对象 / 空串 / 非法 JSON 均容错） */
export function parseRazerOutput(stdout: string): RazerInterfaceResult[] {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  const items = Array.isArray(parsed) ? parsed : [parsed]
  const results: RazerInterfaceResult[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const source = item as Record<string, unknown>
    const instanceId =
      typeof source.instanceId === 'string' ? source.instanceId : ''
    if (instanceId === '') {
      continue
    }
    const attempts: RazerAttempt[] = []
    if (Array.isArray(source.attempts)) {
      for (const raw of source.attempts) {
        if (!raw || typeof raw !== 'object') {
          continue
        }
        const attempt = raw as Record<string, unknown>
        attempts.push({
          commandClass: asNumber(attempt.commandClass),
          commandId: asNumber(attempt.commandId),
          protocolType: asNumber(attempt.protocolType),
          ok: attempt.ok === true,
          responseHex:
            typeof attempt.responseHex === 'string' ? attempt.responseHex : '',
          error: typeof attempt.error === 'string' ? attempt.error : null
        })
      }
    }
    const containerId =
      typeof source.containerId === 'string' && source.containerId.trim() !== ''
        ? source.containerId
        : null
    results.push({
      instanceId,
      containerId,
      product: typeof source.product === 'string' ? source.product : '',
      usagePage: asNumber(source.usagePage),
      usage: asNumber(source.usage),
      attempts
    })
  }
  return results
}

/**
 * 把雷蛇电量合并到设备列表。
 *
 * 按 containerId（不区分大小写）或 instanceId 匹配 DeviceInfo.id；
 * 仅在原电量缺失时写入，已有电量不覆盖，名称 / 类型 / 隐藏计数不变。
 */
export function applyRazerBatteries(
  devices: DeviceInfo[],
  results: RazerInterfaceResult[]
): DeviceInfo[] {
  const byKey = new Map<string, RazerBattery>()
  for (const result of results) {
    const battery = selectRazerBattery(result.attempts)
    if (!battery) {
      continue
    }
    const keys = [result.instanceId, result.containerId ?? '']
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== '')
    for (const key of keys) {
      if (!byKey.has(key)) {
        byKey.set(key, battery)
      }
    }
  }
  return devices.map((device) => {
    if (device.battery && device.battery.percent !== null) {
      return device
    }
    const battery = byKey.get(device.id.trim().toLowerCase())
    if (!battery) {
      return device
    }
    return {
      ...device,
      battery: { percent: battery.percent, charging: battery.charging }
    }
  })
}
