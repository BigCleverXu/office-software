import { describe, expect, it } from 'vitest'
import {
  BROWSER_LABELS,
  QUICK_SITE_PRESETS,
  siteAccent,
  siteInitials
} from './site-visuals'

describe('siteInitials', () => {
  it('英文取前两个单词首字母并大写', () => {
    expect(siteInitials('GitHub')).toBe('GH')
    expect(siteInitials('Google Translate')).toBe('GT')
    expect(siteInitials('you tube')).toBe('YT')
  })

  it('单个英文单词取首字母', () => {
    expect(siteInitials('Google')).toBe('G')
  })

  it('中文取前两个字符', () => {
    expect(siteInitials('哔哩哔哩')).toBe('哔哩')
    expect(siteInitials('知乎')).toBe('知乎')
    expect(siteInitials('微博')).toBe('微博')
  })

  it('空名称回退为占位符', () => {
    expect(siteInitials('')).toBe('?')
    expect(siteInitials('   ')).toBe('?')
  })
})

describe('siteAccent', () => {
  it('同一个 seed 返回稳定样式', () => {
    expect(siteAccent('https://github.com/')).toBe(
      siteAccent('https://github.com/')
    )
    expect(siteAccent('https://www.bilibili.com/')).toBe(
      siteAccent('https://www.bilibili.com/')
    )
  })

  it('不同 seed 可区分出多组配色', () => {
    const seeds = [
      'https://github.com/',
      'https://www.bilibili.com/',
      'https://www.zhihu.com/',
      'https://weibo.com/',
      'https://www.youtube.com/',
      'https://www.google.com/'
    ]
    const accents = seeds.map((seed) => siteAccent(seed))
    expect(new Set(accents).size).toBeGreaterThan(1)
  })

  it('返回的样式包含完整类名，可直接被 Tailwind 扫描', () => {
    const accent = siteAccent('https://example.com/')
    expect(accent).toContain('ring-1')
    expect(accent).toMatch(/bg-\w+-500\/10/)
    expect(accent).not.toContain(' + ')
  })
})

describe('BROWSER_LABELS', () => {
  it('覆盖系统默认浏览器与全部可选浏览器', () => {
    expect(BROWSER_LABELS.system).toBe('系统默认浏览器')
    expect(BROWSER_LABELS.chrome).toBe('Google Chrome')
    expect(BROWSER_LABELS.edge).toBe('Microsoft Edge')
    expect(BROWSER_LABELS.firefox).toBe('Mozilla Firefox')
    expect(BROWSER_LABELS.safari).toBe('Safari')
  })
})

describe('QUICK_SITE_PRESETS', () => {
  it('包含空状态推荐的常用站点', () => {
    const names = QUICK_SITE_PRESETS.map((preset) => preset.name)
    expect(names).toContain('GitHub')
    expect(names).toContain('哔哩哔哩')
    expect(names).toContain('知乎')
    expect(names).toContain('微博')
    expect(names).toContain('YouTube')
    expect(names).toContain('Google')
  })
})
