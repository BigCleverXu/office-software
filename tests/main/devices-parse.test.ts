import { describe, expect, it } from 'vitest'
import {
  classifyWindowsConnection,
  classifyWindowsKind,
  isVirtualOrInternalDevice,
  normalizeBluetoothAudioName,
  parseMacAudioOutputs,
  parseMacBluetoothDevices,
  parseMacDisplays,
  parseMacPointerScaling,
  parseMacUsbDevices,
  parseMacVolumeSettings,
  parseWindowsAudio,
  parseWindowsDevices,
  parseWindowsRawDevices
} from '../../src/main/devices/parse'

/** 构造一条 Windows PnP 设备记录 */
function windowsDevice(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'USB\\VID_046D&PID_C52B\\1',
    name: 'USB 接收器',
    class: 'Mouse',
    instanceId: 'USB\\VID_046D&PID_C52B\\1',
    vendor: 'Logitech',
    battery: null,
    containerId: null,
    busName: null,
    ...overrides
  }
}

/** 本机真实扫描样例（已精简，保留结构与名称） */
function realWorldSample(): Record<string, unknown>[] {
  const mouseContainerA = '{34491214-DE38-11F1-94AA-28A06B4DFC98}'
  const mouseContainerB = '{34491215-DE38-11F1-94AA-28A06B4DFC98}'
  const keyboardContainer = '{9288C0BE-1484-5558-B1CE-7721DE95BBCB}'
  const displayContainer = '{34491213-DE38-11F1-94AA-28A06B4DFC98}'
  const rootContainer = '{00000000-0000-0000-FFFF-FFFFFFFFFFFF}'
  return [
    {
      id: 'HID\\HID_DEVICE_SYSTEM_VHF\\1',
      name: '虚拟 HID 框架(VHF) HID 设备',
      class: 'HIDClass',
      instanceId: 'HID\\HID_DEVICE_SYSTEM_VHF\\1',
      containerId: rootContainer
    },
    {
      id: 'HID\\HID_DEVICE_SYSTEM_VHF&COL02\\2',
      name: '符合 HID 标准的用户控制设备',
      class: 'HIDClass',
      instanceId: 'HID\\HID_DEVICE_SYSTEM_VHF&COL02\\2',
      containerId: rootContainer
    },
    {
      id: '{DEA5AE2A-D1FD-438A-A091-CBD484788436}\\VID_8087&PID_0AC2\\1',
      name: 'Intel(R) ISS HID Device',
      class: 'HIDClass',
      instanceId:
        '{DEA5AE2A-D1FD-438A-A091-CBD484788436}\\VID_8087&PID_0AC2\\1',
      containerId: rootContainer,
      busName: 'Intel ISS HID Device - 00'
    },
    {
      id: 'USB\\VID_8087&PID_0033\\5&1B7437D6&0&10',
      name: 'Intel(R) Wireless Bluetooth(R)',
      class: 'Bluetooth',
      instanceId: 'USB\\VID_8087&PID_0033\\5&1B7437D6&0&10',
      containerId: rootContainer
    },
    {
      id: 'ACPI\\PNP030B\\4&970BA26&0',
      name: 'PC/AT 增强型 PS/2 键盘(101/102 键)',
      class: 'Keyboard',
      instanceId: 'ACPI\\PNP030B\\4&970BA26&0',
      vendor: '(标准键盘)'
    },
    {
      id: 'DISPLAY\\CSW1431\\4&6B5B5DE&0&UID8388688',
      name: 'Integrated Monitor (MNE007ZA3-2)',
      class: 'Monitor',
      instanceId: 'DISPLAY\\CSW1431\\4&6B5B5DE&0&UID8388688',
      vendor: '(标准监视器类型)'
    },
    {
      id: 'USB\\VID_413C&PID_301A\\6&9CC5BAB&0&1',
      name: 'USB 输入设备',
      class: 'HIDClass',
      instanceId: 'USB\\VID_413C&PID_301A\\6&9CC5BAB&0&1',
      vendor: '(标准系统设备)',
      containerId: mouseContainerA,
      busName: 'Dell MS116 USB Optical Mouse'
    },
    {
      id: 'HID\\VID_413C&PID_301A\\7&224003D0&0&0000',
      name: 'HID-compliant mouse',
      class: 'Mouse',
      instanceId: 'HID\\VID_413C&PID_301A\\7&224003D0&0&0000',
      vendor: 'Microsoft',
      containerId: mouseContainerA
    },
    {
      id: 'USB\\VID_413C&PID_301A\\6&9CC5BAB&0&2',
      name: 'USB 输入设备',
      class: 'HIDClass',
      instanceId: 'USB\\VID_413C&PID_301A\\6&9CC5BAB&0&2',
      vendor: '(标准系统设备)',
      containerId: mouseContainerB,
      busName: 'Dell MS116 USB Optical Mouse'
    },
    {
      id: 'HID\\VID_413C&PID_301A\\7&F86532B&0&0000',
      name: 'HID-compliant mouse',
      class: 'Mouse',
      instanceId: 'HID\\VID_413C&PID_301A\\7&F86532B&0&0000',
      vendor: 'Microsoft',
      containerId: mouseContainerB
    },
    {
      id: 'USB\\VID_276D&PID_2234&MI_00\\7&38E6F7C2&0&0000',
      name: 'USB 输入设备',
      class: 'HIDClass',
      instanceId: 'USB\\VID_276D&PID_2234&MI_00\\7&38E6F7C2&0&0000',
      vendor: '(标准系统设备)',
      containerId: keyboardContainer,
      busName: 'Hexgears Gaming Keyboard'
    },
    {
      id: 'HID\\VID_276D&PID_2234&MI_02&COL04\\8&2508A80&0&0003',
      name: 'HID-compliant mouse',
      class: 'Mouse',
      instanceId: 'HID\\VID_276D&PID_2234&MI_02&COL04\\8&2508A80&0&0003',
      vendor: 'Microsoft',
      containerId: keyboardContainer
    },
    {
      id: 'DISPLAY\\DELD082\\4&6B5B5DE&0&UID24647',
      name: 'Generic Monitor (DELL SE2416H)',
      class: 'Monitor',
      instanceId: 'DISPLAY\\DELD082\\4&6B5B5DE&0&UID24647',
      vendor: '(标准监视器类型)',
      containerId: displayContainer,
      busName: 'Generic Monitor (DELL SE2416H)'
    }
  ]
}

describe('classifyWindowsConnection', () => {
  it('识别蓝牙枚举前缀', () => {
    expect(
      classifyWindowsConnection(
        'BTHENUM\\{00001124-0000-1000-8000-00805F9B34FB}_LOCALMFG&0000',
        'Mouse'
      )
    ).toBe('bluetooth')
    expect(classifyWindowsConnection('BTHLE\\DEV_001122334455\\8&1', '')).toBe(
      'bluetooth'
    )
    expect(classifyWindowsConnection('BTHHFENUM\\BthHFEnum\\4&2', '')).toBe(
      'bluetooth'
    )
  })

  it('USB / HID 默认为有线，蓝牙前缀优先', () => {
    expect(
      classifyWindowsConnection('USB\\VID_046D&PID_C52B\\6&1', 'Mouse')
    ).toBe('usb')
    expect(
      classifyWindowsConnection('USB\\VID_046D&PID_C52B\\6&2', 'Keyboard')
    ).toBe('usb')
    expect(
      classifyWindowsConnection('USB\\VID_046D&PID_C52B\\6&3', 'HIDClass')
    ).toBe('usb')
    expect(
      classifyWindowsConnection('USB\\VID_0BDA&PID_8153\\6&5', 'Monitor')
    ).toBe('usb')
    expect(
      classifyWindowsConnection(
        'BTHENUM\\{0000}_LOCALMFG&0000',
        'HIDClass',
        'Bluetooth Receiver'
      )
    ).toBe('bluetooth')
  })

  it('名称含 Receiver / 接收器 / 2.4G 时判为无线', () => {
    expect(
      classifyWindowsConnection(
        'USB\\VID_046D&PID_C52B\\6&1',
        'HIDClass',
        'USB Receiver'
      )
    ).toBe('wireless')
    expect(
      classifyWindowsConnection(
        'USB\\VID_046D&PID_C52B\\6&1',
        'HIDClass',
        '无线接收器'
      )
    ).toBe('wireless')
    expect(
      classifyWindowsConnection(
        'USB\\VID_046D&PID_C52B\\6&1',
        'Mouse',
        '2.4G Wireless Mouse'
      )
    ).toBe('wireless')
    expect(
      classifyWindowsConnection(
        'USB\\VID_046D&PID_C52B\\6&1',
        'Mouse',
        'Dell MS116 USB Optical Mouse'
      )
    ).toBe('usb')
  })

  it('HID 为 USB，ACPI / ROOT / SWD 为内置，其余未知', () => {
    expect(
      classifyWindowsConnection('HID\\VID_046D&PID_C52B\\7&1', 'Mouse')
    ).toBe('usb')
    expect(classifyWindowsConnection('ACPI\\PNP0C0F\\0', '')).toBe('builtin')
    expect(classifyWindowsConnection('ROOT\\MSSMBIOS\\0000', '')).toBe(
      'builtin'
    )
    expect(classifyWindowsConnection('SWD\\WPDBUSENUM\\1', '')).toBe('builtin')
    expect(classifyWindowsConnection('DISPLAY\\DELD082\\4&1', 'Monitor')).toBe(
      'unknown'
    )
    expect(classifyWindowsConnection('PCI\\VEN_8086&DEV_1234', '')).toBe(
      'unknown'
    )
  })
})

describe('classifyWindowsKind', () => {
  it('按 PnP Class 判定常见类别', () => {
    expect(classifyWindowsKind('Mouse', 'HID-compliant mouse')).toBe('mouse')
    expect(classifyWindowsKind('Keyboard', '')).toBe('keyboard')
    expect(classifyWindowsKind('Monitor', 'DELL U2720Q')).toBe('display')
    expect(classifyWindowsKind('MEDIA', '任意识别名')).toBe('headset')
  })

  it('按名称关键词补判耳机 / 音箱 / 鼠标 / 键盘 / 手柄', () => {
    expect(classifyWindowsKind('AudioEndpoint', 'Sony Headphones')).toBe(
      'headset'
    )
    expect(classifyWindowsKind('AudioEndpoint', 'Buds 无线耳机')).toBe(
      'headset'
    )
    expect(classifyWindowsKind('AudioEndpoint', '客厅音箱')).toBe('speaker')
    expect(classifyWindowsKind('HIDClass', 'USB Optical Mouse')).toBe('mouse')
    expect(classifyWindowsKind('HIDClass', 'USB Keyboard')).toBe('keyboard')
    expect(classifyWindowsKind('HIDClass', 'Xbox 手柄')).toBe('gamepad')
    expect(classifyWindowsKind('HIDClass', 'USB Game Controller')).toBe(
      'gamepad'
    )
  })

  it('蓝牙类设备按名称再判，否则为 other', () => {
    expect(classifyWindowsKind('Bluetooth', '蓝牙鼠标')).toBe('mouse')
    expect(classifyWindowsKind('Bluetooth', 'Bluetooth Keyboard')).toBe(
      'keyboard'
    )
    expect(classifyWindowsKind('Bluetooth', 'AirPods Pro')).toBe('headset')
    expect(classifyWindowsKind('Bluetooth', '未知蓝牙设备')).toBe('other')
    expect(classifyWindowsKind('HIDClass', 'USB Receiver')).toBe('other')
  })
})

describe('isVirtualOrInternalDevice', () => {
  it('过滤虚拟 HID 与系统输入设备', () => {
    expect(
      isVirtualOrInternalDevice(
        'HID\\HID_DEVICE_SYSTEM_VHF\\1',
        '虚拟 HID 框架(VHF) HID 设备',
        'HIDClass'
      )
    ).toBe(true)
    expect(
      isVirtualOrInternalDevice(
        'HID\\VID_413C&PID_301A\\7&224003D0&0&0000',
        'HID-compliant mouse',
        'Mouse'
      )
    ).toBe(true)
    expect(
      isVirtualOrInternalDevice(
        '{DEA5AE2A-D1FD-438A-A091-CBD484788436}\\VID_8087&PID_0AC2\\1',
        'Intel(R) ISS HID Device',
        'HIDClass'
      )
    ).toBe(true)
    expect(
      isVirtualOrInternalDevice(
        'HID\\GXTP7300&COL03\\5&1010BEB1&0&0002',
        'Microsoft Input Configuration Device',
        'HIDClass'
      )
    ).toBe(true)
  })

  it('过滤内置设备与蓝牙适配器', () => {
    expect(
      isVirtualOrInternalDevice(
        'ACPI\\PNP030B\\4&970BA26&0',
        'PC/AT 增强型 PS/2 键盘(101/102 键)',
        'Keyboard'
      )
    ).toBe(true)
    expect(
      isVirtualOrInternalDevice(
        'ACPI\\GXTP7300\\4&28B9A386&0',
        'I2C HID 设备',
        'HIDClass'
      )
    ).toBe(true)
    expect(
      isVirtualOrInternalDevice(
        'DISPLAY\\CSW1431\\4&6B5B5DE&0&UID8388688',
        'Integrated Monitor (MNE007ZA3-2)',
        'Monitor'
      )
    ).toBe(true)
    expect(
      isVirtualOrInternalDevice(
        'USB\\VID_8087&PID_0033\\5&1B7437D6&0&10',
        'Intel(R) Wireless Bluetooth(R)',
        'Bluetooth'
      )
    ).toBe(true)
  })

  it('保留真实外设', () => {
    expect(
      isVirtualOrInternalDevice(
        'USB\\VID_413C&PID_301A\\6&9CC5BAB&0&1',
        'USB 输入设备',
        'HIDClass'
      )
    ).toBe(false)
    expect(
      isVirtualOrInternalDevice(
        'USB\\VID_413C&PID_301A\\6&9CC5BAB&0&1',
        'Dell MS116 USB Optical Mouse',
        'Mouse'
      )
    ).toBe(false)
    expect(
      isVirtualOrInternalDevice(
        'BTHENUM\\DEV_001122334455\\8&1',
        'MX Master 3',
        'Bluetooth'
      )
    ).toBe(false)
  })
})

describe('parseWindowsRawDevices', () => {
  it('映射脚本字段', () => {
    const raw = parseWindowsRawDevices(
      JSON.stringify(
        windowsDevice({
          class: 'HIDClass',
          vendor: '',
          battery: 85,
          containerId: '{11111111-2222-3333-4444-555555555555}',
          busName: 'Dell MS116 USB Optical Mouse'
        })
      )
    )

    expect(raw).toEqual([
      {
        id: 'USB\\VID_046D&PID_C52B\\1',
        name: 'USB 接收器',
        className: 'HIDClass',
        instanceId: 'USB\\VID_046D&PID_C52B\\1',
        vendor: null,
        battery: 85,
        containerId: '{11111111-2222-3333-4444-555555555555}',
        busName: 'Dell MS116 USB Optical Mouse',
        batterySource: 'pnp',
        aepBattery: null,
        aepCharging: null
      }
    ])
  })

  it('空串与非法 JSON 返回空数组', () => {
    expect(parseWindowsRawDevices('')).toEqual([])
    expect(parseWindowsRawDevices('not-json')).toEqual([])
  })
})

describe('parseWindowsDevices', () => {
  it('解析数组输出并按类别 / 名称排序', () => {
    const payload = [
      windowsDevice({
        id: 'kb',
        name: '键盘 B',
        class: 'Keyboard',
        instanceId: 'USB\\VID_0001&PID_0001\\1'
      }),
      windowsDevice({
        id: 'm-wire',
        name: '鼠标 B',
        class: 'Mouse',
        instanceId: 'USB\\VID_0001&PID_0002\\2'
      }),
      windowsDevice({
        id: 'm-bt',
        name: '鼠标 A',
        class: 'Mouse',
        instanceId: 'BTHENUM\\{0000}_LOCALMFG&0000'
      }),
      windowsDevice({
        id: 'm-usb',
        name: '鼠标 C',
        class: 'Mouse',
        instanceId: 'HID\\VID_0001&PID_0003\\3'
      }),
      windowsDevice({
        id: 'headset',
        name: '耳机',
        class: 'AudioEndpoint',
        instanceId: 'USB\\VID_0001&PID_0004\\4'
      })
    ]

    const scene = parseWindowsDevices(JSON.stringify(payload))

    expect(scene.devices.map((item) => item.id)).toEqual([
      'BTHENUM\\{0000}_LOCALMFG&0000',
      'USB\\VID_0001&PID_0002\\2',
      'HID\\VID_0001&PID_0003\\3',
      'USB\\VID_0001&PID_0001\\1',
      'USB\\VID_0001&PID_0004\\4'
    ])
    expect(scene.devices[0]).toMatchObject({
      id: 'BTHENUM\\{0000}_LOCALMFG&0000',
      name: '鼠标 A',
      kind: 'mouse',
      connection: 'bluetooth',
      model: null,
      connected: true
    })
    expect(scene.hiddenDeviceCount).toBe(0)
  })

  it('单对象输出也能解析', () => {
    const scene = parseWindowsDevices(
      JSON.stringify(windowsDevice({ id: 'single', name: '单设备' }))
    )

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      id: 'USB\\VID_046D&PID_C52B\\1',
      name: '单设备',
      kind: 'mouse',
      connection: 'usb',
      vendor: 'Logitech',
      model: null,
      connected: true,
      battery: null
    })
  })

  it('空串与非法 JSON 返回空场景', () => {
    const empty = { devices: [], hiddenDeviceCount: 0 }
    expect(parseWindowsDevices('')).toEqual(empty)
    expect(parseWindowsDevices('   ')).toEqual(empty)
    expect(parseWindowsDevices('not-json')).toEqual(empty)
    expect(parseWindowsDevices(null as unknown as string)).toEqual(empty)
  })

  it('电量越界或字符串时归一化为 null', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        windowsDevice({ id: 'ok', instanceId: 'USB\\A\\ok', battery: 85 }),
        windowsDevice({ id: 'high', instanceId: 'USB\\A\\high', battery: 150 }),
        windowsDevice({ id: 'low', instanceId: 'USB\\A\\low', battery: -1 }),
        windowsDevice({ id: 'string', instanceId: 'USB\\A\\s', battery: '85' }),
        windowsDevice({ id: 'none', instanceId: 'USB\\A\\none', battery: null })
      ])
    )
    const byId = new Map(scene.devices.map((item) => [item.id, item]))

    expect(byId.get('USB\\A\\ok')?.battery).toEqual({
      percent: 85,
      charging: false
    })
    expect(byId.get('USB\\A\\high')?.battery).toBeNull()
    expect(byId.get('USB\\A\\low')?.battery).toBeNull()
    expect(byId.get('USB\\A\\s')?.battery).toBeNull()
    expect(byId.get('USB\\A\\none')?.battery).toBeNull()
  })

  it('vendor 空串归一化为 null', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        windowsDevice({ id: 'empty', instanceId: 'USB\\A\\e', vendor: '' }),
        windowsDevice({ id: 'blank', instanceId: 'USB\\A\\b', vendor: '   ' }),
        windowsDevice({
          id: 'value',
          instanceId: 'USB\\A\\v',
          vendor: 'Logitech'
        })
      ])
    )
    const byId = new Map(scene.devices.map((item) => [item.id, item]))

    expect(byId.get('USB\\A\\e')?.vendor).toBeNull()
    expect(byId.get('USB\\A\\b')?.vendor).toBeNull()
    expect(byId.get('USB\\A\\v')?.vendor).toBe('Logitech')
  })

  it('过滤断开设备与 SWD / ROOT 实例', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        windowsDevice({ id: 'online', connected: true }),
        windowsDevice({
          id: 'offline',
          instanceId: 'USB\\VID_0001&PID_0002\\off',
          connected: false
        }),
        windowsDevice({
          id: 'swd',
          instanceId: 'SWD\\WPDBUSENUM\\1',
          connected: true
        }),
        windowsDevice({
          id: 'root',
          instanceId: 'ROOT\\MSSMBIOS\\0000',
          connected: true
        })
      ])
    )

    expect(scene.devices.map((item) => item.id)).toEqual([
      'USB\\VID_046D&PID_C52B\\1'
    ])
    expect(scene.hiddenDeviceCount).toBe(2)
  })

  it('真实样例：过滤虚拟 / 内置设备并按容器归并', () => {
    const sample = realWorldSample()
    const scene = parseWindowsDevices(JSON.stringify(sample))
    const names = scene.devices.map((item) => item.name)

    for (const hiddenName of [
      '虚拟 HID 框架(VHF) HID 设备',
      '符合 HID 标准的用户控制设备',
      'Intel(R) ISS HID Device',
      'Intel(R) Wireless Bluetooth(R)',
      'PC/AT 增强型 PS/2 键盘(101/102 键)',
      'Integrated Monitor (MNE007ZA3-2)'
    ]) {
      expect(names).not.toContain(hiddenName)
    }

    expect(scene.devices).toHaveLength(4)
    expect(scene.devices.map((item) => item.kind)).toEqual([
      'mouse',
      'mouse',
      'keyboard',
      'display'
    ])
    // 同一容器的 USB 输入设备 + HID-compliant mouse 合并为一条，取 busName
    expect(
      names.filter((name) => name === 'Dell MS116 USB Optical Mouse')
    ).toHaveLength(2)
    expect(names).toContain('Hexgears Gaming Keyboard')
    expect(names).toContain('Generic Monitor (DELL SE2416H)')

    const firstMouse = scene.devices.find(
      (item) => item.id === 'USB\\VID_413C&PID_301A\\6&9CC5BAB&0&1'
    )
    expect(firstMouse).toMatchObject({
      kind: 'mouse',
      connection: 'usb',
      vendor: '(标准系统设备)',
      battery: null
    })

    // 键盘容器虽含 HID 鼠标集合，但展示名关键词优先 → keyboard
    const keyboard = scene.devices.find(
      (item) => item.name === 'Hexgears Gaming Keyboard'
    )
    expect(keyboard).toMatchObject({ kind: 'keyboard', connection: 'usb' })

    // 被过滤条目按容器去重：不会等于原始条目数
    expect(scene.hiddenDeviceCount).toBeGreaterThan(0)
    expect(scene.hiddenDeviceCount).not.toBe(sample.length)
    expect(scene.hiddenDeviceCount).toBe(6)
  })

  it('两个不同 containerId 的同名鼠标保留两条', () => {
    const scene = parseWindowsDevices(JSON.stringify(realWorldSample()))
    const mice = scene.devices.filter((item) => item.kind === 'mouse')

    expect(mice).toHaveLength(2)
    const names = mice.map((item) => item.name)
    expect(
      names.filter((name) => name === 'Dell MS116 USB Optical Mouse')
    ).toHaveLength(2)
    expect(new Set(mice.map((item) => item.id)).size).toBe(2)
  })

  it('名称含 Receiver 的同容器设备判为 2.4G 无线', () => {
    const containerId = '{99999999-8888-7777-6666-555555555555}'
    const scene = parseWindowsDevices(
      JSON.stringify([
        windowsDevice({
          id: 'USB\\VID_046D&PID_C534\\1',
          instanceId: 'USB\\VID_046D&PID_C534\\1',
          name: 'USB Receiver',
          class: 'HIDClass',
          vendor: 'Logitech',
          containerId,
          busName: 'USB Receiver'
        }),
        windowsDevice({
          id: 'HID\\VID_046D&PID_C534\\2',
          instanceId: 'HID\\VID_046D&PID_C534\\2',
          name: 'HID-compliant mouse',
          class: 'Mouse',
          containerId
        })
      ])
    )

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      name: 'USB Receiver',
      kind: 'mouse',
      connection: 'wireless'
    })
  })
})

describe('parseWindowsAudio', () => {
  it('解析正常 JSON 输出', () => {
    const result = parseWindowsAudio(
      JSON.stringify({
        masterVolume: 55,
        masterMuted: true,
        outputs: [
          {
            id: 'o1',
            name: '扬声器',
            isDefault: true,
            volume: 55,
            muted: false
          }
        ]
      })
    )

    expect(result.masterVolume).toBe(55)
    expect(result.masterMuted).toBe(true)
    expect(result.outputs).toEqual([
      {
        id: 'o1',
        name: '扬声器',
        isDefault: true,
        volume: 55,
        muted: false,
        controllable: true
      }
    ])
  })

  it('masterVolume 为 null 时保持 null', () => {
    const result = parseWindowsAudio(
      JSON.stringify({ masterVolume: null, masterMuted: false, outputs: [] })
    )

    expect(result).toEqual({
      masterVolume: null,
      masterMuted: false,
      outputs: []
    })
  })

  it('outputs 缺失时降级为空数组', () => {
    const result = parseWindowsAudio(JSON.stringify({ masterVolume: '55' }))

    expect(result.masterVolume).toBeNull()
    expect(result.outputs).toEqual([])
  })

  it('空串与非法 JSON 返回空结果', () => {
    expect(parseWindowsAudio('')).toEqual({
      masterVolume: null,
      masterMuted: false,
      outputs: []
    })
    expect(parseWindowsAudio('oops')).toEqual({
      masterVolume: null,
      masterMuted: false,
      outputs: []
    })
  })
})

describe('parseMacBluetoothDevices', () => {
  it('device_connected 为数组且以设备名为键时仍能解析', () => {
    const payload = {
      SPBluetoothDataType: [
        {
          device_connected: [
            {
              'MX Master 3': {
                device_address: 'aa-bb-cc-dd',
                device_minorType: 'mouse',
                device_manufacturer: 'Logitech',
                device_batteryPercent: 85
              }
            }
          ]
        }
      ]
    }

    expect(parseMacBluetoothDevices(payload)).toEqual({
      devices: [
        {
          id: 'aa-bb-cc-dd',
          name: 'MX Master 3',
          kind: 'mouse',
          connection: 'bluetooth',
          vendor: 'Logitech',
          model: null,
          connected: true,
          battery: { percent: 85, charging: false }
        }
      ],
      hiddenDeviceCount: 0
    })
  })

  it('device_connected 为单个对象时解析 "85%" 电量', () => {
    const payload = {
      SPBluetoothDataType: [
        {
          device_connected: {
            device_address: '11-22-33',
            _name: 'Magic Keyboard',
            device_minorType: 'keyboard',
            device_batteryLevel: '85%'
          }
        }
      ]
    }

    const scene = parseMacBluetoothDevices(payload)

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      id: '11-22-33',
      name: 'Magic Keyboard',
      kind: 'keyboard',
      vendor: null,
      battery: { percent: 85, charging: false }
    })
  })

  it('从 device_batteryLevelLeft / Right / Case 取电量', () => {
    const payload = {
      SPBluetoothDataType: [
        {
          device_connected: [
            {
              _name: 'AirPods Pro',
              device_minorType: 'headphones',
              device_batteryLevelLeft: '80%',
              device_batteryLevelRight: 60,
              device_batteryLevelCase: '95%'
            }
          ]
        }
      ]
    }

    const scene = parseMacBluetoothDevices(payload)

    expect(scene.devices[0].kind).toBe('headset')
    expect(scene.devices[0].battery).toEqual({ percent: 80, charging: false })
  })

  it('无电量字段时 battery 为 null', () => {
    const payload = {
      SPBluetoothDataType: [
        {
          device_connected: [{ _name: 'MX Keys', device_minorType: 'keyboard' }]
        }
      ]
    }

    expect(parseMacBluetoothDevices(payload).devices[0].battery).toBeNull()
  })

  it('过滤内置 / 虚拟设备并计入隐藏数', () => {
    const payload = {
      SPBluetoothDataType: [
        {
          device_connected: [
            {
              'MX Master 3': {
                device_address: 'aa-bb-cc-dd',
                device_minorType: 'mouse'
              }
            },
            { _name: 'iBridge' },
            { _name: 'Trackpad' }
          ]
        }
      ]
    }

    const scene = parseMacBluetoothDevices(payload)

    expect(scene.devices.map((item) => item.name)).toEqual(['MX Master 3'])
    expect(scene.hiddenDeviceCount).toBe(2)
  })
})

describe('parseMacUsbDevices', () => {
  it('递归 _items 且只保留外设', () => {
    const payload = {
      SPUSBDataType: [
        {
          _name: 'USB 3.1 Bus',
          _items: [
            {
              _name: 'USB Receiver',
              manufacturer: 'Logitech',
              serial_num: 'SN123'
            },
            {
              _name: 'Mass Storage Device',
              manufacturer: 'Generic',
              serial_num: 'DISK1'
            },
            {
              _name: 'Hub',
              _items: [
                {
                  _name: '2.4G Wireless Mouse',
                  manufacturer: 'Dell',
                  serial_num: ''
                }
              ]
            }
          ]
        }
      ]
    }

    expect(parseMacUsbDevices(payload)).toEqual({
      devices: [
        {
          id: 'SN123',
          name: 'USB Receiver',
          kind: 'other',
          connection: 'wireless',
          vendor: 'Logitech',
          model: null,
          connected: true,
          battery: null
        },
        {
          id: '2.4G Wireless Mouse',
          name: '2.4G Wireless Mouse',
          kind: 'mouse',
          connection: 'wireless',
          vendor: 'Dell',
          model: null,
          connected: true,
          battery: null
        }
      ],
      hiddenDeviceCount: 0
    })
  })

  it('过滤内置键盘 / 触控板并计入隐藏数', () => {
    const payload = {
      SPUSBDataType: [
        {
          _name: 'USB 3.1 Bus',
          _items: [
            {
              _name: 'Apple Internal Keyboard / Trackpad',
              manufacturer: 'Apple Inc.',
              serial_num: 'INT-1'
            },
            {
              _name: 'USB Receiver',
              manufacturer: 'Logitech',
              serial_num: 'SN123'
            }
          ]
        }
      ]
    }

    const scene = parseMacUsbDevices(payload)

    expect(scene.devices.map((item) => item.name)).toEqual(['USB Receiver'])
    expect(scene.hiddenDeviceCount).toBe(1)
  })
})

describe('parseMacDisplays', () => {
  it('过滤内置屏，外接屏每条一条', () => {
    const payload = {
      SPDisplaysDataType: [
        {
          _name: 'Apple M3',
          spdisplays_ndrvs: [
            { _name: 'Built-in Retina Display' },
            {
              _name: 'Studio Display',
              '_spdisplays_display-serial-number': 'SD-1'
            }
          ]
        }
      ]
    }

    const scene = parseMacDisplays(payload)

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      id: 'SD-1',
      name: 'Studio Display',
      kind: 'display',
      connection: 'usb'
    })
    expect(scene.hiddenDeviceCount).toBe(1)
  })
})

describe('parseMacAudioOutputs', () => {
  it('只取有输出能力的项并标记默认设备', () => {
    const payload = {
      SPAudioDataType: [
        {
          _name: '音频',
          _items: [
            {
              _name: 'MacBook Pro 扬声器',
              coreaudio_output_source: 'spaudio_yes',
              coreaudio_default_audio_output_device: 'spaudio_yes'
            },
            {
              _name: 'AirPods Pro',
              coreaudio_output_source: 'spaudio_yes'
            },
            {
              _name: 'MacBook Pro 麦克风',
              coreaudio_input_source: 'spaudio_yes'
            }
          ]
        }
      ]
    }

    const outputs = parseMacAudioOutputs(payload)

    expect(outputs).toHaveLength(2)
    expect(outputs[0]).toEqual({
      id: 'MacBook Pro 扬声器',
      name: 'MacBook Pro 扬声器',
      isDefault: true,
      volume: null,
      muted: false,
      controllable: false
    })
    expect(outputs[1].isDefault).toBe(false)
  })
})

describe('parseMacVolumeSettings', () => {
  it('解析音量与静音', () => {
    expect(
      parseMacVolumeSettings(
        'output volume:55, input volume:100, alert volume:100, output muted:false'
      )
    ).toEqual({ volume: 55, muted: false })
    expect(
      parseMacVolumeSettings('output volume:0, output muted:true')
    ).toEqual({ volume: 0, muted: true })
  })

  it('空串与乱文本返回空结果，越界音量被钳制', () => {
    expect(parseMacVolumeSettings('')).toEqual({ volume: null, muted: false })
    expect(parseMacVolumeSettings('oops')).toEqual({
      volume: null,
      muted: false
    })
    expect(parseMacVolumeSettings('output volume:120')).toEqual({
      volume: 100,
      muted: false
    })
  })
})

describe('parseMacPointerScaling', () => {
  it('解析浮点数', () => {
    expect(parseMacPointerScaling('0.6875')).toBe(0.6875)
    expect(parseMacPointerScaling(' 1 ')).toBe(1)
    expect(parseMacPointerScaling('2')).toBe(2)
  })

  it('空串与乱文本返回 null', () => {
    expect(parseMacPointerScaling('')).toBeNull()
    expect(
      parseMacPointerScaling(
        'The domain/default pair of (com.apple.mouse.scaling) does not exist'
      )
    ).toBeNull()
  })
})

describe('解析函数对空值容错', () => {
  const junkInputs: unknown[] = [null, undefined, '']

  it('设备类解析不抛异常且返回空场景', () => {
    for (const input of junkInputs) {
      expect(parseMacBluetoothDevices(input)).toEqual({
        devices: [],
        hiddenDeviceCount: 0
      })
      expect(parseMacUsbDevices(input)).toEqual({
        devices: [],
        hiddenDeviceCount: 0
      })
      expect(parseMacDisplays(input)).toEqual({
        devices: [],
        hiddenDeviceCount: 0
      })
      expect(parseMacAudioOutputs(input)).toEqual([])
    }
  })

  it('文本类解析不抛异常并返回空结果', () => {
    for (const input of junkInputs) {
      expect(parseWindowsDevices(input as string)).toEqual({
        devices: [],
        hiddenDeviceCount: 0
      })
      expect(parseWindowsAudio(input as string)).toEqual({
        masterVolume: null,
        masterMuted: false,
        outputs: []
      })
      expect(parseMacVolumeSettings(input as string)).toEqual({
        volume: null,
        muted: false
      })
      expect(parseMacPointerScaling(input as string)).toBeNull()
    }
  })
})

/** 构造一条蓝牙音频 MEDIA 节点 */
function bluetoothAudioDevice(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'BTHENUM\\{0000110B-0000-1000-8000-00805F9B34FB}_LOCALMFG&0000',
    name: 'HUAWEI FreeBuds Pro',
    class: 'MEDIA',
    instanceId: 'BTHENUM\\{0000110B-0000-1000-8000-00805F9B34FB}_LOCALMFG&0000',
    vendor: 'HUAWEI',
    battery: null,
    containerId: null,
    busName: null,
    batterySource: 'none',
    ...overrides
  }
}

describe('normalizeBluetoothAudioName', () => {
  it('去掉 Stereo / Hands-Free / 括号与多余空格', () => {
    expect(normalizeBluetoothAudioName('HUAWEI FreeBuds Pro Stereo')).toBe(
      'HUAWEI FreeBuds Pro'
    )
    expect(
      normalizeBluetoothAudioName('HUAWEI FreeBuds Pro Hands-Free AG Audio')
    ).toBe('HUAWEI FreeBuds Pro')
    expect(normalizeBluetoothAudioName('HUAWEI FreeBuds Pro 免提')).toBe(
      'HUAWEI FreeBuds Pro'
    )
    expect(normalizeBluetoothAudioName('HUAWEI FreeBuds Pro（麦克风）')).toBe(
      'HUAWEI FreeBuds Pro'
    )
    expect(normalizeBluetoothAudioName('  HUAWEI   FreeBuds Pro  ')).toBe(
      'HUAWEI FreeBuds Pro'
    )
    expect(normalizeBluetoothAudioName('')).toBe('')
    expect(normalizeBluetoothAudioName(null as unknown as string)).toBe('')
  })
})

describe('蓝牙音频设备归并', () => {
  it('同名多节点合并为一条并保留电量', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        bluetoothAudioDevice({
          id: 'BTHENUM\\A',
          instanceId: 'BTHENUM\\A',
          battery: 100,
          batterySource: 'pnp'
        }),
        bluetoothAudioDevice({
          id: 'BTHENUM\\B',
          instanceId: 'BTHENUM\\B',
          name: 'HUAWEI FreeBuds Pro Stereo'
        }),
        bluetoothAudioDevice({
          id: 'BTHENUM\\C',
          instanceId: 'BTHENUM\\C',
          name: 'HUAWEI FreeBuds Pro Hands-Free AG Audio'
        })
      ])
    )

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      name: 'HUAWEI FreeBuds Pro',
      kind: 'headset',
      connection: 'bluetooth',
      battery: { percent: 100, charging: false }
    })
    expect(scene.devices[0].name).not.toMatch(/Stereo|Hands-Free/i)
    expect(scene.hiddenDeviceCount).toBe(0)
  })

  it('不同型号的蓝牙音频设备不会误合并', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        bluetoothAudioDevice({ id: 'BTHENUM\\H', instanceId: 'BTHENUM\\H' }),
        bluetoothAudioDevice({
          id: 'BTHENUM\\S',
          instanceId: 'BTHENUM\\S',
          name: 'Sony Headphones WH-1000XM5'
        })
      ])
    )

    expect(scene.devices).toHaveLength(2)
    expect(scene.devices.map((item) => item.kind)).toEqual([
      'headset',
      'headset'
    ])
  })

  it('仅 AEP BatteryLife 时取 85 且来源正确', () => {
    const payload = bluetoothAudioDevice({
      battery: null,
      aepBattery: 85
    })
    const raw = parseWindowsRawDevices(JSON.stringify(payload))

    expect(raw[0].battery).toBe(85)
    expect(raw[0].batterySource).toBe('aep-battery')

    const scene = parseWindowsDevices(JSON.stringify(payload))
    expect(scene.devices[0].battery).toEqual({
      percent: 85,
      charging: false
    })
  })

  it('仅 AEP BatteryPlusCharging "85;1" 时取 85 且来源正确', () => {
    const payload = bluetoothAudioDevice({
      battery: null,
      aepCharging: '85;1'
    })
    const raw = parseWindowsRawDevices(JSON.stringify(payload))

    expect(raw[0].battery).toBe(85)
    expect(raw[0].batterySource).toBe('aep-charging')

    const scene = parseWindowsDevices(JSON.stringify(payload))
    expect(scene.devices[0].battery).toEqual({
      percent: 85,
      charging: false
    })
  })

  it('三个电量源都缺失时 battery 为 null', () => {
    const payload = bluetoothAudioDevice({
      battery: null,
      aepBattery: null,
      aepCharging: null
    })
    const raw = parseWindowsRawDevices(JSON.stringify(payload))

    expect(raw[0].battery).toBeNull()
    expect(raw[0].batterySource).toBe('none')
    expect(
      parseWindowsDevices(JSON.stringify(payload)).devices[0].battery
    ).toBeNull()
  })

  it('INTELAUDIO 的 MEDIA 驱动被过滤并计入隐藏', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        bluetoothAudioDevice({
          id: 'INTELAUDIO\\FUNC_01&VEN_8086',
          instanceId: 'INTELAUDIO\\FUNC_01&VEN_8086',
          name: 'Intel® Smart Sound Technology for Bluetooth® LE Audio',
          class: 'MEDIA',
          vendor: 'Intel'
        })
      ])
    )

    expect(scene.devices).toEqual([])
    expect(scene.hiddenDeviceCount).toBe(1)
  })
})

/** 构造一条 WinRT AEP 合成行 */
function aepDevice(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'AEP\\00:11:22:33:44:55',
    name: 'HUAWEI FreeBuds Pro',
    class: 'BluetoothAep',
    instanceId: 'AEP\\00:11:22:33:44:55',
    vendor: null,
    battery: 100,
    containerId: null,
    busName: null,
    batterySource: 'aep-battery',
    ...overrides
  }
}

describe('WinRT AEP 合成行', () => {
  it('仅 AEP 行时展示为蓝牙耳机并保留电量', () => {
    const scene = parseWindowsDevices(JSON.stringify([aepDevice()]))

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      name: 'HUAWEI FreeBuds Pro',
      kind: 'headset',
      connection: 'bluetooth',
      battery: { percent: 100, charging: false }
    })
    expect(scene.hiddenDeviceCount).toBe(0)
  })

  it('AEP 行与同名 BTHENUM/MEDIA 节点合并为一条', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        bluetoothAudioDevice({
          id: 'BTHENUM\\A',
          instanceId: 'BTHENUM\\A',
          name: 'HUAWEI FreeBuds Pro Stereo',
          containerId: '{aaaaaaaa-1111-2222-3333-444444444444}'
        }),
        bluetoothAudioDevice({
          id: 'BTHENUM\\B',
          instanceId: 'BTHENUM\\B',
          name: 'HUAWEI FreeBuds Pro Hands-Free AG Audio',
          containerId: '{aaaaaaaa-1111-2222-3333-444444444444}'
        }),
        aepDevice()
      ])
    )

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      name: 'HUAWEI FreeBuds Pro',
      kind: 'headset',
      connection: 'bluetooth',
      battery: { percent: 100, charging: false }
    })
    expect(scene.devices[0].name).not.toMatch(/Stereo|Hands-Free/i)
    expect(scene.hiddenDeviceCount).toBe(0)
  })

  it('AEP 无电量但名称为耳机时保留设备', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([aepDevice({ battery: null, batterySource: 'none' })])
    )

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      kind: 'headset',
      connection: 'bluetooth',
      battery: null
    })
  })

  it('AEP 名称为手机等其它设备时被过滤并计入隐藏', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        aepDevice({
          id: 'AEP\\AA:BB',
          instanceId: 'AEP\\AA:BB',
          name: 'HUAWEI P40',
          battery: 80
        })
      ])
    )

    expect(scene.devices).toEqual([])
    expect(scene.hiddenDeviceCount).toBe(1)
  })
})

const FREEBUDS_CONTAINER = '{e1767d5d-9345-5a1f-b05d-d1bb4fd156f7}'

/** 构造一条蓝牙 HFP AudioGateway 服务节点（电量常挂在这里） */
function hfpDevice(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const instanceId =
    'BTHENUM\\{0000111E-0000-1000-8000-00805F9B34FB}_HCIBYPASS_LOCALMFG&0002\\7&A22F447&2&9098380A8DCE_C00000000'
  return {
    id: instanceId,
    name: 'HUAWEI FreeBuds Pro Hands-Free AG',
    class: 'System',
    instanceId,
    vendor: 'HUAWEI',
    battery: 70,
    containerId: FREEBUDS_CONTAINER,
    busName: null,
    batterySource: 'pnp',
    ...overrides
  }
}

/** 构造蓝牙 A2DP / DEV / AVRCP 节点 */
function bluetoothNode(
  instanceId: string,
  name: string,
  className: string,
  busName: string | null = null
): Record<string, unknown> {
  return {
    id: instanceId,
    name,
    class: className,
    instanceId,
    vendor: 'HUAWEI',
    battery: null,
    containerId: FREEBUDS_CONTAINER,
    busName,
    batterySource: 'none'
  }
}

describe('蓝牙 HFP 节点电量', () => {
  it('HFP + A2DP + DEV + AEP 合并为一条并保留 70% 电量', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        hfpDevice(),
        bluetoothNode(
          'BTHENUM\\{0000110B-0000-1000-8000-00805F9B34FB}_LOCALMFG&0002\\7&A22F447&2&9098380A8DCE_C00000000',
          'HUAWEI FreeBuds Pro',
          'MEDIA',
          'A2DP SNK Service'
        ),
        bluetoothNode(
          'BTHENUM\\DEV_9098380A8DCE\\7&A22F447&2&BLUETOOTHDEVICE_9098380A8DCE',
          'HUAWEI FreeBuds Pro',
          'Bluetooth',
          'HUAWEI FreeBuds Pro'
        ),
        aepDevice({ battery: null, batterySource: 'none' })
      ])
    )

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      name: 'HUAWEI FreeBuds Pro',
      kind: 'headset',
      connection: 'bluetooth',
      battery: { percent: 70, charging: false }
    })
    expect(scene.hiddenDeviceCount).toBe(0)
  })

  it('只有 HFP 节点时也能产出耳机与电量', () => {
    const scene = parseWindowsDevices(JSON.stringify([hfpDevice()]))

    expect(scene.devices).toHaveLength(1)
    expect(scene.devices[0]).toMatchObject({
      name: 'HUAWEI FreeBuds Pro',
      kind: 'headset',
      connection: 'bluetooth',
      battery: { percent: 70, charging: false }
    })
  })

  it('AVRCP 节点单独出现时不产出设备', () => {
    const scene = parseWindowsDevices(
      JSON.stringify([
        bluetoothNode(
          'BTHENUM\\{0000110C-0000-1000-8000-00805F9B34FB}_LOCALMFG&0002\\7&A22F447&2&9098380A8DCE_C00000000',
          'HUAWEI FreeBuds Pro Avrcp 传输',
          'Bluetooth',
          'A/V Remote Control Target'
        )
      ])
    )

    expect(scene.devices).toEqual([])
    expect(scene.hiddenDeviceCount).toBe(1)
  })
})
