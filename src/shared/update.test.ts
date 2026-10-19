import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isNewerVersion,
  normalizeVersion,
  parseRelease,
  releasePageUrl
} from './update'

describe('normalizeVersion', () => {
  it('去掉前导 v / V 与首尾空白', () => {
    expect(normalizeVersion('v1.0.0')).toBe('1.0.0')
    expect(normalizeVersion('V2.1')).toBe('2.1')
    expect(normalizeVersion(' 1.0.0 ')).toBe('1.0.0')
    expect(normalizeVersion('1.0.0')).toBe('1.0.0')
  })
})

describe('compareVersions', () => {
  it('相等返回 0', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('更高返回 1、更低返回 -1', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1)
  })

  it('段数不同时缺失段按 0 处理', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
  })

  it('纯数字段按数值比较而非字典序', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1)
  })

  it('前导 v 会被忽略', () => {
    expect(compareVersions('v1.2.0', '1.1.9')).toBe(1)
  })

  it('非数字段退化为字典序，结果稳定', () => {
    // '0-beta' 与 '0' 并非纯数字段，按字典序比较：
    // '0' 是 '0-beta' 的严格前缀，因此 '0-beta' 更大，结果为 1
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(1)
  })
})

describe('isNewerVersion', () => {
  it('更新为 true、不更新与相等为 false', () => {
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
  })
})

describe('releasePageUrl', () => {
  it('拼出 Gitee 发行版页面地址', () => {
    expect(releasePageUrl('xuyijie_xu', 'office-software', 'v1.0.0')).toBe(
      'https://gitee.com/xuyijie_xu/office-software/releases/tag/v1.0.0'
    )
  })
})

describe('parseRelease', () => {
  it('完整对象解析出各字段并规范化版本', () => {
    const result = parseRelease(
      {
        tag_name: 'v1.2.0',
        name: '第二版',
        body: '更新说明',
        created_at: '2026-01-01T00:00:00+08:00'
      },
      'xuyijie_xu',
      'office-software'
    )
    expect(result).toEqual({
      version: '1.2.0',
      tag: 'v1.2.0',
      title: '第二版',
      notes: '更新说明',
      publishedAt: '2026-01-01T00:00:00+08:00',
      pageUrl:
        'https://gitee.com/xuyijie_xu/office-software/releases/tag/v1.2.0'
    })
  })

  it('缺 name 时 title 回退为 tag', () => {
    const result = parseRelease(
      { tag_name: 'v1.0.0' },
      'xuyijie_xu',
      'office-software'
    )
    expect(result?.title).toBe('v1.0.0')
  })

  it('缺 body 时 notes 为空字符串', () => {
    const result = parseRelease(
      { tag_name: 'v1.0.0' },
      'xuyijie_xu',
      'office-software'
    )
    expect(result?.notes).toBe('')
  })

  it('缺 created_at 时 publishedAt 为 null', () => {
    const result = parseRelease(
      { tag_name: 'v1.0.0' },
      'xuyijie_xu',
      'office-software'
    )
    expect(result?.publishedAt).toBeNull()
  })

  it('缺 tag_name 时返回 null', () => {
    expect(
      parseRelease({ name: 'x' }, 'xuyijie_xu', 'office-software')
    ).toBeNull()
  })

  it('传入 null / 字符串 / 数字时返回 null', () => {
    expect(parseRelease(null, 'xuyijie_xu', 'office-software')).toBeNull()
    expect(parseRelease('text', 'xuyijie_xu', 'office-software')).toBeNull()
    expect(parseRelease(123, 'xuyijie_xu', 'office-software')).toBeNull()
  })
})
