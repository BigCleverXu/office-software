import { describe, expect, it } from 'vitest'
import {
  decodeKuaishouInitState,
  decodeKuaishouState,
  findKuaishouPhoto
} from '../../src/main/video/kuaishou-state'

/** 作品 ID：与分享页短链一致的口径 */
const PHOTO_ID = '3x3pk285r7w5qpi'

/** 对可打印 ASCII 做 +1 位移，模拟快手 INIT_STATE 编码 */
function shiftText(text: string): string {
  let result = ''
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code >= 1 && code <= 126) {
      result += String.fromCharCode(code === 126 ? 1 : code + 1)
    } else {
      result += char
    }
  }
  return result
}

/** 递归编码：键名与字符串整体 +1，嵌套 JSON 字符串保持整体位移 */
function encodeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return shiftText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[shiftText(key)] = encodeValue(item)
    }
    return result
  }
  return value
}

/** 合成最小编码状态：根对象、作品实体与嵌套 manifest JSON 字符串 */
function encodedStateText(): string {
  const manifest = JSON.stringify({
    adaptationSet: [
      {
        representation: [
          {
            url: 'https://k0u73ydfy.djvod.ndcimgs.com/a.mp4',
            backupUrl: ['https://v23-3.kwaicdn.com/a.mp4'],
            width: 1080,
            height: 1920,
            avgBitrate: 2000000,
            qualityLabel: '1080p'
          }
        ]
      }
    ]
  })
  const state = {
    result: 1,
    photo: {
      photoId: PHOTO_ID,
      caption: '移动端快手标题',
      userName: '快手作者',
      duration: 8000,
      manifest
    }
  }
  return JSON.stringify(encodeValue(state))
}

describe('快手 INIT_STATE 解码', () => {
  it('自动选择位移并还原作品实体与嵌套 manifest', () => {
    const state = decodeKuaishouInitState(encodedStateText())
    expect(state).not.toBeNull()

    const photo = findKuaishouPhoto(state, PHOTO_ID)
    expect(photo).not.toBeNull()
    expect(photo?.caption).toBe('移动端快手标题')
    expect(photo?.userName).toBe('快手作者')
    expect(photo?.duration).toBe(8000)

    // 嵌套 JSON 字符串解码后已成为对象，供 buildResource 直接读取
    const manifest = photo?.manifest as
      | {
          adaptationSet?: Array<{
            representation?: Array<{ url?: string; backupUrl?: string[] }>
          }>
        }
      | undefined
    const representation = manifest?.adaptationSet?.[0]?.representation?.[0]
    expect(representation?.url).toBe(
      'https://k0u73ydfy.djvod.ndcimgs.com/a.mp4'
    )
    expect(representation?.backupUrl).toEqual([
      'https://v23-3.kwaicdn.com/a.mp4'
    ])
  })

  it('状态中没有作品时返回 null', () => {
    const state = decodeKuaishouState({ result: 2, error_msg: null })
    expect(findKuaishouPhoto(state, PHOTO_ID)).toBeNull()
  })

  it('非法 JSON 文本返回 null', () => {
    expect(decodeKuaishouInitState('')).toBeNull()
    expect(decodeKuaishouInitState('{"result":2')).toBeNull()
    expect(decodeKuaishouInitState('window.INIT_STATE')).toBeNull()
  })

  it('深度超限与循环引用不抛异常', () => {
    const circular: Record<string, unknown> = { caption: '循环' }
    circular.self = circular

    expect(() => decodeKuaishouState(circular)).not.toThrow()
    expect(findKuaishouPhoto(circular, PHOTO_ID)).toBeNull()

    let nested: Record<string, unknown> = { leaf: '值' }
    for (let index = 0; index < 20; index += 1) {
      nested = { child: nested }
    }
    expect(() => decodeKuaishouState(nested)).not.toThrow()
  })
})
