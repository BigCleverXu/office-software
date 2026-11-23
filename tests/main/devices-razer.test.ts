import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '../../src/shared/devices'
import {
  applyRazerBatteries,
  buildRazerFrame,
  normalizeRazerFrame,
  parseRazerBattery,
  parseRazerOutput,
  razerChecksum,
  selectRazerBattery,
  type RazerAttempt,
  type RazerInterfaceResult
} from '../../src/main/devices/razer'

/** 构造 90 字节响应并转成十六进制 */
function responseHex(overrides: Record<number, number> = {}): string {
  const bytes = new Array<number>(90).fill(0)
  bytes[0] = 0x02
  bytes[6] = 0x07
  bytes[7] = 0x80
  bytes[9] = 85
  bytes[10] = 0
  for (const [index, value] of Object.entries(overrides)) {
    bytes[Number(index)] = value
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function attempt(overrides: Partial<RazerAttempt> = {}): RazerAttempt {
  return {
    commandClass: 7,
    commandId: 0x80,
    protocolType: 0,
    ok: true,
    responseHex: responseHex(),
    error: null,
    ...overrides
  }
}

/** 构造真机 91 字节响应（首字节为 Report ID 0x00） */
function realResponseBytes(): number[] {
  const bytes = new Array<number>(91).fill(0)
  bytes[0] = 0x00
  bytes[1] = 0x02
  bytes[2] = 0x01
  bytes[7] = 0x07
  bytes[8] = 0x80
  bytes[10] = 0xd3
  bytes[89] = 0x56
  bytes[90] = 0x61
  return bytes
}

function toHex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function interfaceResult(
  overrides: Partial<RazerInterfaceResult> = {}
): RazerInterfaceResult {
  return {
    instanceId: 'HID\\VID_1532&PID_00A5&MI_02&COL01\\7&1&0&0000',
    containerId: '{11111111-2222-3333-4444-555555555555}',
    product: 'Razer Viper',
    usagePage: 1,
    usage: 2,
    attempts: [attempt()],
    ...overrides
  }
}

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: 'HID\\VID_1532&PID_00A5&MI_02&COL01\\7&1&0&0000',
    name: 'Razer Viper',
    kind: 'mouse',
    connection: 'wireless',
    vendor: 'Razer',
    model: null,
    connected: true,
    battery: null,
    ...overrides
  }
}

describe('buildRazerFrame', () => {
  it('按协议布局写入字段并计算 CRC', () => {
    const frame = buildRazerFrame({
      transactionId: 1,
      dataSize: 2,
      commandClass: 7,
      commandId: 0x80,
      arguments: [0, 0]
    })

    expect(frame).toHaveLength(90)
    expect(frame[0]).toBe(0x00)
    expect(frame[1]).toBe(0x01)
    expect(frame[2]).toBe(0x00)
    expect(frame[3]).toBe(0x00)
    expect(frame[4]).toBe(0x00)
    expect(frame[5]).toBe(0x02)
    expect(frame[6]).toBe(0x07)
    expect(frame[7]).toBe(0x80)
    expect(frame[8]).toBe(0x00)
    expect(frame[9]).toBe(0x00)
    expect(frame[88]).toBe(razerChecksum(Array.from(frame)))
    expect(frame[88]).toBe(2 ^ 7 ^ 0x80)
    expect(frame[89]).toBe(0x00)
  })

  it('支持自定义协议类型、事务号与参数', () => {
    const frame = buildRazerFrame({
      transactionId: 257,
      dataSize: 2,
      commandClass: 0x3f,
      commandId: 0x80,
      arguments: [1, 2, 3],
      protocolType: 2
    })

    expect(frame[1]).toBe(1)
    expect(frame[4]).toBe(2)
    expect(frame[6]).toBe(0x3f)
    expect(frame[8]).toBe(1)
    expect(frame[9]).toBe(2)
    expect(frame[10]).toBe(3)
    expect(frame[88]).toBe(razerChecksum(Array.from(frame)))
  })
})

describe('parseRazerBattery', () => {
  it('解析出电量与充电状态', () => {
    expect(parseRazerBattery(responseHex())).toEqual({
      percent: 85,
      charging: false,
      commandClass: 0x07,
      commandId: 0x80
    })
  })

  it('支持 100% 与充电中', () => {
    expect(parseRazerBattery(responseHex({ 9: 100, 10: 1 }))).toMatchObject({
      percent: 100,
      charging: true
    })
  })

  it('状态码非成功时返回 null', () => {
    expect(parseRazerBattery(responseHex({ 0: 0x03 }))).toBeNull()
    expect(parseRazerBattery(responseHex({ 0: 0x05 }))).toBeNull()
  })

  it('电量原始值超出 0–255 时返回 null', () => {
    expect(parseRazerBattery(responseHex({ 9: 300 }))).toBeNull()
  })

  it('电量原始值 0xFF 换算为 100%', () => {
    expect(parseRazerBattery(responseHex({ 9: 0xff }))).toMatchObject({
      percent: 100
    })
  })

  it('空串、过短、非十六进制均返回 null', () => {
    expect(parseRazerBattery('')).toBeNull()
    expect(parseRazerBattery('0200')).toBeNull()
    expect(parseRazerBattery('zzzz')).toBeNull()
  })
})

describe('真实响应与 Report ID 归一化', () => {
  it('解析 91 字节真机响应（Report ID 前缀）', () => {
    expect(parseRazerBattery(toHex(realResponseBytes()))).toEqual({
      percent: 83,
      charging: false,
      commandClass: 0x07,
      commandId: 0x80
    })
  })

  it('解析去掉 Report ID 的 90 字节版本', () => {
    const frame = realResponseBytes().slice(1)
    expect(parseRazerBattery(toHex(frame))).toEqual({
      percent: 83,
      charging: false,
      commandClass: 0x07,
      commandId: 0x80
    })
  })

  it('normalizeRazerFrame 去掉 Report ID 或保持无前缀帧', () => {
    const withReportId = realResponseBytes()
    expect(normalizeRazerFrame(withReportId)).toHaveLength(90)
    expect(normalizeRazerFrame(withReportId)[0]).toBe(0x02)

    const withoutReportId = withReportId.slice(1)
    expect(normalizeRazerFrame(withoutReportId)).toEqual(withoutReportId)

    const invalid = [0x00, 0x01, 0x02]
    expect(normalizeRazerFrame(invalid)).toEqual(invalid)
    expect(normalizeRazerFrame([])).toEqual([])
  })
})

describe('selectRazerBattery', () => {
  it('跳过失败项并选择第一个成功项', () => {
    const battery = selectRazerBattery([
      attempt({ commandId: 0x80, responseHex: responseHex({ 0: 0x03 }) }),
      attempt({
        commandClass: 0x07,
        commandId: 0x00,
        responseHex: responseHex({ 9: 42 })
      })
    ])

    expect(battery).toEqual({
      percent: 42,
      charging: false,
      commandClass: 0x07,
      commandId: 0x00
    })
  })

  it('全部失败时返回 null', () => {
    expect(selectRazerBattery([attempt({ responseHex: '' })])).toBeNull()
  })
})

describe('parseRazerOutput', () => {
  it('解析数组形式的脚本输出', () => {
    const stdout = JSON.stringify([
      {
        instanceId: 'HID\\VID_1532&PID_00A5\\1',
        containerId: '{abc}',
        product: 'Razer Viper',
        usagePage: 1,
        usage: 2,
        attempts: [
          {
            commandClass: 7,
            commandId: 128,
            protocolType: 0,
            ok: true,
            responseHex: '02',
            error: null
          }
        ]
      }
    ])

    const results = parseRazerOutput(stdout)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      instanceId: 'HID\\VID_1532&PID_00A5\\1',
      containerId: '{abc}',
      product: 'Razer Viper',
      usagePage: 1,
      usage: 2
    })
    expect(results[0].attempts).toHaveLength(1)
  })

  it('兼容单对象形式', () => {
    const results = parseRazerOutput(
      JSON.stringify({
        instanceId: 'HID\\VID_1532&PID_00A5\\1',
        attempts: []
      })
    )
    expect(results).toHaveLength(1)
    expect(results[0].containerId).toBeNull()
  })

  it('空串与非法 JSON 返回空数组', () => {
    expect(parseRazerOutput('')).toEqual([])
    expect(parseRazerOutput('not-json')).toEqual([])
  })
})

describe('applyRazerBatteries', () => {
  it('按 containerId 匹配并写入电量', () => {
    const results = [
      interfaceResult({
        containerId: '{ABCDEF00-0000-0000-0000-000000000001}'
      })
    ]
    const devices = [
      device({
        id: '{abcdef00-0000-0000-0000-000000000001}',
        battery: null
      })
    ]

    const merged = applyRazerBatteries(devices, results)
    expect(merged[0].battery).toEqual({ percent: 85, charging: false })
    expect(merged[0].name).toBe('Razer Viper')
    expect(merged[0].kind).toBe('mouse')
  })

  it('按 instanceId 匹配并写入电量', () => {
    const merged = applyRazerBatteries([device()], [interfaceResult()])
    expect(merged[0].battery).toEqual({ percent: 85, charging: false })
  })

  it('已有电量时不覆盖', () => {
    const merged = applyRazerBatteries(
      [device({ battery: { percent: 50, charging: true } })],
      [interfaceResult()]
    )
    expect(merged[0].battery).toEqual({ percent: 50, charging: true })
  })

  it('未匹配的设备保持原样', () => {
    const devices = [device({ id: 'HID\\VID_046D&PID_C52B\\1' })]
    const merged = applyRazerBatteries(devices, [interfaceResult()])
    expect(merged[0]).toEqual(devices[0])
    expect(merged[0].battery).toBeNull()
  })

  it('没有可用响应时不写入电量', () => {
    const merged = applyRazerBatteries(
      [device()],
      [interfaceResult({ attempts: [attempt({ responseHex: '' })] })]
    )
    expect(merged[0].battery).toBeNull()
  })
})
