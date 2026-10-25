import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NEWS_PLATFORMS,
  NEWS_PLATFORMS,
  isNewsPlatformId,
  normalizeNewsPlatforms
} from './news'

describe('isNewsPlatformId', () => {
  it('合法平台代码返回 true', () => {
    expect(isNewsPlatformId('baidu')).toBe(true)
    expect(isNewsPlatformId('sina_finance')).toBe(true)
    expect(isNewsPlatformId('hackernews')).toBe(true)
  })

  it('非法字符串返回 false', () => {
    expect(isNewsPlatformId('not-a-platform')).toBe(false)
    expect(isNewsPlatformId('')).toBe(false)
    expect(isNewsPlatformId('baidu ')).toBe(false)
  })

  it('数字与 null 返回 false', () => {
    expect(isNewsPlatformId(123)).toBe(false)
    expect(isNewsPlatformId(null)).toBe(false)
    expect(isNewsPlatformId(undefined)).toBe(false)
    expect(isNewsPlatformId({ id: 'baidu' })).toBe(false)
  })
})

describe('normalizeNewsPlatforms', () => {
  it('非数组回退默认值', () => {
    const defaults = [...DEFAULT_NEWS_PLATFORMS]
    expect(normalizeNewsPlatforms('baidu')).toEqual(defaults)
    expect(normalizeNewsPlatforms(null)).toEqual([...DEFAULT_NEWS_PLATFORMS])
    expect(normalizeNewsPlatforms(undefined)).toEqual([
      ...DEFAULT_NEWS_PLATFORMS
    ])
    expect(normalizeNewsPlatforms(42)).toEqual([...DEFAULT_NEWS_PLATFORMS])
  })

  it('过滤非法项', () => {
    expect(
      normalizeNewsPlatforms(['baidu', 'nope', 123, null, 'weibo'])
    ).toEqual(['baidu', 'weibo'])
  })

  it('去重相同平台', () => {
    expect(normalizeNewsPlatforms(['zhihu', 'zhihu', 'zhihu'])).toEqual([
      'zhihu'
    ])
  })

  it('输出顺序遵循 NEWS_PLATFORMS', () => {
    expect(normalizeNewsPlatforms(['36kr', 'baidu'])).toEqual(['baidu', '36kr'])
    expect(normalizeNewsPlatforms(['cls', 'weibo', 'baidu', 'zhihu'])).toEqual([
      'baidu',
      'weibo',
      'zhihu',
      'cls'
    ])
  })

  it('空数组与全非法数组回退默认值', () => {
    expect(normalizeNewsPlatforms([])).toEqual([...DEFAULT_NEWS_PLATFORMS])
    expect(normalizeNewsPlatforms(['nope', 1])).toEqual([
      ...DEFAULT_NEWS_PLATFORMS
    ])
  })

  it('返回新数组，修改结果不影响默认值', () => {
    const result = normalizeNewsPlatforms([])
    expect(result).not.toBe(DEFAULT_NEWS_PLATFORMS)
    result.push('baidu')
    expect(DEFAULT_NEWS_PLATFORMS).toEqual(['baidu', 'weibo', 'zhihu', '36kr'])
    expect(DEFAULT_NEWS_PLATFORMS).toHaveLength(4)
  })
})

describe('NEWS_PLATFORMS', () => {
  it('恰好包含 22 个平台', () => {
    expect(NEWS_PLATFORMS).toHaveLength(22)
  })

  it('平台 id 无重复', () => {
    const ids = NEWS_PLATFORMS.map((platform) => platform.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('平台名称均非空', () => {
    for (const platform of NEWS_PLATFORMS) {
      expect(typeof platform.name).toBe('string')
      expect(platform.name.trim().length).toBeGreaterThan(0)
    }
  })
})
