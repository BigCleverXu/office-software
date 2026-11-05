import { describe, expect, it } from 'vitest'
import type {
  DetectedBrowser,
  QuickSite,
  QuickSiteTarget
} from '../../../src/shared/quick-sites'
import {
  BROWSER_LABELS,
  QUICK_SITE_PRESETS,
  resolveSiteTargetLabel,
  siteAccent,
  siteInitials,
  siteOpenAriaLabel,
  siteTargetBadge,
  siteTargetLabels
} from '../../../src/renderer/src/lib/site-visuals'

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

/** 最小浏览器样本：chrome 有两个角色，edge 无角色 */
const browsers: DetectedBrowser[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    kind: 'chromium',
    executable: '/chrome',
    profiles: [
      { id: 'default', name: '默认' },
      { id: 'work', name: '工作' }
    ]
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    kind: 'chromium',
    executable: '/edge',
    profiles: []
  }
]

/** 最小站点样本 */
const makeSite = (targets: QuickSiteTarget[], name = 'GitHub'): QuickSite => ({
  id: 'site-1',
  name,
  url: 'https://github.com/',
  targets,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0
})

describe('resolveSiteTargetLabel', () => {
  it('系统默认浏览器直接使用固定文案', () => {
    expect(
      resolveSiteTargetLabel({ browserId: 'system', profileId: '' }, browsers)
    ).toEqual({ text: BROWSER_LABELS.system, warn: false })
  })

  it('浏览器缺失时标注不可用并告警', () => {
    expect(
      resolveSiteTargetLabel({ browserId: 'firefox', profileId: '' }, browsers)
    ).toEqual({ text: 'Mozilla Firefox（不可用）', warn: true })
  })

  it('空角色 id 表示默认角色', () => {
    expect(
      resolveSiteTargetLabel({ browserId: 'chrome', profileId: '' }, browsers)
    ).toEqual({ text: 'Google Chrome · 默认角色', warn: false })
  })

  it('角色缺失时标注不可用并告警', () => {
    expect(
      resolveSiteTargetLabel(
        { browserId: 'chrome', profileId: 'ghost' },
        browsers
      )
    ).toEqual({ text: 'Google Chrome · 角色（不可用）', warn: true })
  })

  it('角色存在时拼接浏览器与角色名称', () => {
    expect(
      resolveSiteTargetLabel(
        { browserId: 'chrome', profileId: 'work' },
        browsers
      )
    ).toEqual({ text: 'Google Chrome · 工作', warn: false })
  })
})

describe('siteTargetLabels', () => {
  it('按打开方式顺序解析全部标签', () => {
    const site = makeSite([
      { browserId: 'system', profileId: '' },
      { browserId: 'chrome', profileId: 'work' },
      { browserId: 'firefox', profileId: '' }
    ])
    expect(siteTargetLabels(site, browsers)).toEqual([
      { text: BROWSER_LABELS.system, warn: false },
      { text: 'Google Chrome · 工作', warn: false },
      { text: 'Mozilla Firefox（不可用）', warn: true }
    ])
  })
})

describe('siteTargetBadge', () => {
  it('单目标直接展示标签全文', () => {
    const site = makeSite([{ browserId: 'chrome', profileId: 'work' }])
    expect(siteTargetBadge(site, browsers)).toEqual({
      text: 'Google Chrome · 工作',
      title: 'Google Chrome · 工作',
      warn: false
    })
  })

  it('单目标不可用时保留告警', () => {
    const site = makeSite([{ browserId: 'firefox', profileId: '' }])
    expect(siteTargetBadge(site, browsers)).toEqual({
      text: 'Mozilla Firefox（不可用）',
      title: 'Mozilla Firefox（不可用）',
      warn: true
    })
  })

  it('多目标显示数量并用顿号拼接标题', () => {
    const site = makeSite([
      { browserId: 'system', profileId: '' },
      { browserId: 'chrome', profileId: '' },
      { browserId: 'edge', profileId: '' }
    ])
    expect(siteTargetBadge(site, browsers)).toEqual({
      text: '3 个打开方式',
      title:
        '系统默认浏览器、Google Chrome · 默认角色、Microsoft Edge · 默认角色',
      warn: false
    })
  })

  it('多目标中任一不可用即告警', () => {
    const site = makeSite([
      { browserId: 'chrome', profileId: 'work' },
      { browserId: 'chrome', profileId: 'ghost' }
    ])
    expect(siteTargetBadge(site, browsers).warn).toBe(true)
  })
})

describe('siteOpenAriaLabel', () => {
  it('单目标列出打开方式与站点名', () => {
    const site = makeSite([{ browserId: 'chrome', profileId: 'work' }])
    expect(siteOpenAriaLabel(site, browsers)).toBe(
      '用 Google Chrome · 工作 打开 GitHub'
    )
  })

  it('单目标系统默认浏览器同样列出标签', () => {
    const site = makeSite([{ browserId: 'system', profileId: '' }])
    expect(siteOpenAriaLabel(site, browsers)).toBe(
      `用 ${BROWSER_LABELS.system} 打开 GitHub`
    )
  })

  it('多目标只提示数量', () => {
    const site = makeSite([
      { browserId: 'chrome', profileId: '' },
      { browserId: 'edge', profileId: '' }
    ])
    expect(siteOpenAriaLabel(site, browsers)).toBe('用 2 个打开方式打开 GitHub')
  })
})
