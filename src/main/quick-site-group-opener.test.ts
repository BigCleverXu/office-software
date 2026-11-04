import { describe, expect, it, vi } from 'vitest'
import {
  SYSTEM_BROWSER_ID,
  type DetectedBrowser,
  type QuickSite,
  type QuickSiteGroup,
  type QuickSiteTarget
} from '../shared/quick-sites'
import type { BatchOpenResult } from './quick-site-launcher'
import {
  openQuickSiteGroup,
  openSitesInBrowsers,
  type GroupOpenDeps,
  type SiteOpenDeps
} from './quick-site-group-opener'
import type { QuickSiteStore } from './quick-site-store'

/** 构造一个站点 */
function makeSite(overrides: Partial<QuickSite> = {}): QuickSite {
  return {
    id: 's1',
    name: '站点',
    url: 'https://a.com/',
    targets: [{ browserId: SYSTEM_BROWSER_ID, profileId: '' }],
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

/** 构造一个目标 */
function makeTarget(
  browserId: QuickSiteTarget['browserId'],
  profileId = ''
): QuickSiteTarget {
  return { browserId, profileId }
}

/** 用内存 map 模拟站点存储 */
function makeSiteStore(sites: QuickSite[]): QuickSiteStore {
  const map = new Map(sites.map((site) => [site.id, site]))
  return {
    getById: (id: string): QuickSite | null => map.get(id) ?? null
  } as unknown as QuickSiteStore
}

/** 构造一个编组 */
function makeGroup(siteIds: string[]): QuickSiteGroup {
  return {
    id: 'g1',
    name: '编组',
    siteIds,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0
  }
}

/** 系统默认浏览器 */
const systemBrowser: DetectedBrowser = {
  id: SYSTEM_BROWSER_ID,
  name: '系统默认浏览器',
  kind: 'system',
  executable: '',
  profiles: []
}

/** Chromium 内核浏览器 */
const chromeBrowser: DetectedBrowser = {
  id: 'chrome',
  name: 'Google Chrome',
  kind: 'chromium',
  executable: '/usr/bin/google-chrome',
  profiles: []
}

/** 构造批量启动 mock，默认按网址数量计成功 */
function makeLaunchMock(
  handler: (
    browser: DetectedBrowser,
    profileId: string,
    urls: string[]
  ) => BatchOpenResult = (_browser, _profileId, urls) => ({
    ok: true,
    opened: urls.length,
    failed: 0
  })
): ReturnType<typeof vi.fn> {
  return vi.fn(
    async (browser: DetectedBrowser, profileId: string, urls: string[]) =>
      handler(browser, profileId, urls)
  )
}

/** 构造站点打开依赖，默认所有可执行文件均存在 */
function makeDeps(
  browsers: DetectedBrowser[],
  launchMock: ReturnType<typeof vi.fn>,
  exists: (path: string) => boolean = () => true
): SiteOpenDeps {
  return {
    detect: () => browsers,
    launchBatch: launchMock as unknown as SiteOpenDeps['launchBatch'],
    exists
  }
}

/** 构造编组依赖 */
function makeGroupDeps(
  sites: QuickSite[],
  browsers: DetectedBrowser[],
  launchMock: ReturnType<typeof vi.fn>,
  exists: (path: string) => boolean = () => true
): GroupOpenDeps {
  return {
    siteStore: makeSiteStore(sites),
    detect: () => browsers,
    launchBatch: launchMock as unknown as GroupOpenDeps['launchBatch'],
    exists
  }
}

describe('openSitesInBrowsers', () => {
  it('同一站点的多个目标各启动一次并合并计数', async () => {
    const sites = [
      makeSite({
        targets: [makeTarget('chrome', 'p1'), makeTarget('chrome', 'p2')]
      })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeDeps([systemBrowser, chromeBrowser], launchMock)

    const result = await openSitesInBrowsers(sites, deps)

    const calls = launchMock.mock.calls as [DetectedBrowser, string, string[]][]
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toBe('p1')
    expect(calls[0][2]).toEqual(['https://a.com/'])
    expect(calls[1][1]).toBe('p2')
    expect(calls[1][2]).toEqual(['https://a.com/'])
    expect(result).toEqual({
      ok: true,
      opened: 2,
      fallback: 0,
      failed: 0,
      browserNames: ['Google Chrome']
    })
  })

  it('跨站点、跨目标的同浏览器角色合并为一次启动', async () => {
    const sites = [
      makeSite({
        id: 's1',
        url: 'https://a.com/',
        targets: [makeTarget('chrome', 'p1'), makeTarget('system')]
      }),
      makeSite({
        id: 's2',
        url: 'https://b.com/',
        targets: [makeTarget('chrome', 'p1')]
      })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeDeps([systemBrowser, chromeBrowser], launchMock)

    const result = await openSitesInBrowsers(sites, deps)

    const calls = launchMock.mock.calls as [DetectedBrowser, string, string[]][]
    expect(calls).toHaveLength(2)
    expect(calls[0][0].id).toBe('chrome')
    expect(calls[0][1]).toBe('p1')
    expect(calls[0][2]).toEqual(['https://a.com/', 'https://b.com/'])
    expect(calls[1][0].id).toBe(SYSTEM_BROWSER_ID)
    expect(calls[1][2]).toEqual(['https://a.com/'])
    expect(result).toEqual({
      ok: true,
      opened: 3,
      fallback: 0,
      failed: 0,
      browserNames: ['Google Chrome', '系统默认浏览器']
    })
  })

  it('浏览器缺失时逐目标回退系统并累加 fallback', async () => {
    const sites = [
      makeSite({
        targets: [makeTarget('firefox', '/p1'), makeTarget('chrome', 'p1')]
      })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeDeps([systemBrowser, chromeBrowser], launchMock)

    const result = await openSitesInBrowsers(sites, deps)

    const calls = launchMock.mock.calls as [DetectedBrowser, string, string[]][]
    expect(calls).toHaveLength(2)
    expect(calls[0][0].id).toBe(SYSTEM_BROWSER_ID)
    expect(calls[1][0].id).toBe('chrome')
    expect(calls[1][2]).toEqual(['https://a.com/'])
    expect(result).toEqual({
      ok: true,
      opened: 2,
      fallback: 1,
      failed: 0,
      browserNames: ['系统默认浏览器', 'Google Chrome']
    })
  })

  it('可执行文件缺失时同样逐目标回退系统', async () => {
    const sites = [
      makeSite({
        targets: [makeTarget('chrome', 'p1'), makeTarget('system')]
      })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeDeps(
      [systemBrowser, chromeBrowser],
      launchMock,
      () => false
    )

    const result = await openSitesInBrowsers(sites, deps)

    const calls = launchMock.mock.calls as [DetectedBrowser, string, string[]][]
    expect(calls).toHaveLength(1)
    expect(calls[0][0].id).toBe(SYSTEM_BROWSER_ID)
    expect(calls[0][2]).toEqual(['https://a.com/', 'https://a.com/'])
    expect(result).toEqual({
      ok: true,
      opened: 2,
      fallback: 1,
      failed: 0,
      browserNames: ['系统默认浏览器']
    })
  })

  it('browserNames 去重保序且系统回退批次使用系统浏览器名称', async () => {
    const sites = [
      makeSite({
        targets: [
          makeTarget('system'),
          makeTarget('chrome', 'p1'),
          makeTarget('chrome', 'p2')
        ]
      })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeDeps([systemBrowser, chromeBrowser], launchMock)

    const result = await openSitesInBrowsers(sites, deps)

    expect(result.browserNames).toEqual(['系统默认浏览器', 'Google Chrome'])
  })

  it('累加失败数并去重收集错误提示', async () => {
    const sites = [
      makeSite({
        targets: [makeTarget('chrome', 'p1'), makeTarget('chrome', 'p2')]
      }),
      makeSite({
        id: 's2',
        url: 'https://b.com/',
        targets: [makeTarget('system')]
      })
    ]
    const launchMock = makeLaunchMock((browser) =>
      browser.id === SYSTEM_BROWSER_ID
        ? { ok: true, opened: 1, failed: 0 }
        : { ok: false, opened: 0, failed: 1, error: '打开浏览器失败' }
    )
    const deps = makeDeps([systemBrowser, chromeBrowser], launchMock)

    const result = await openSitesInBrowsers(sites, deps)

    expect(result).toEqual({
      ok: true,
      opened: 1,
      fallback: 0,
      failed: 2,
      browserNames: ['Google Chrome', '系统默认浏览器'],
      errors: ['打开浏览器失败']
    })
  })

  it('没有任何可打开目标时返回可读错误且不探测浏览器', async () => {
    const launchMock = makeLaunchMock()
    const detect = vi.fn(() => [systemBrowser])
    const deps: SiteOpenDeps = {
      detect,
      launchBatch: launchMock as unknown as SiteOpenDeps['launchBatch']
    }

    const result = await openSitesInBrowsers([makeSite({ targets: [] })], deps)

    expect(result).toEqual({
      ok: false,
      opened: 0,
      fallback: 0,
      failed: 0,
      browserNames: [],
      errors: ['没有可用的打开方式']
    })
    expect(detect).not.toHaveBeenCalled()
    expect(launchMock).not.toHaveBeenCalled()
  })

  it('全部失败时 ok 为 false', async () => {
    const sites = [makeSite({ targets: [makeTarget('chrome', 'p1')] })]
    const launchMock = makeLaunchMock(() => ({
      ok: false,
      opened: 0,
      failed: 1,
      error: '打开浏览器失败'
    }))
    const deps = makeDeps([systemBrowser, chromeBrowser], launchMock)

    const result = await openSitesInBrowsers(sites, deps)

    expect(result).toEqual({
      ok: false,
      opened: 0,
      fallback: 0,
      failed: 1,
      browserNames: ['Google Chrome'],
      errors: ['打开浏览器失败']
    })
  })
})

describe('openQuickSiteGroup', () => {
  it('解析多目标站点后交给通用打开逻辑并汇总结果', async () => {
    const sites = [
      makeSite({
        id: 's1',
        url: 'https://a.com/',
        targets: [makeTarget('chrome', 'p1'), makeTarget('system')]
      })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeGroupDeps(
      sites,
      [systemBrowser, chromeBrowser],
      launchMock
    )

    const result = await openQuickSiteGroup(makeGroup(['s1']), deps)

    expect(result).toEqual({
      ok: true,
      opened: 2,
      fallback: 0,
      failed: 0
    })
  })

  it('编组内没有可打开的网站时返回可读错误', async () => {
    const launchMock = makeLaunchMock()
    const detect = vi.fn(() => [systemBrowser])
    const deps: GroupOpenDeps = {
      siteStore: makeSiteStore([]),
      detect,
      launchBatch: launchMock as unknown as GroupOpenDeps['launchBatch']
    }

    const result = await openQuickSiteGroup(makeGroup(['missing']), deps)

    expect(result).toEqual({
      ok: false,
      opened: 0,
      fallback: 0,
      failed: 0,
      errors: ['编组内没有可打开的网站']
    })
    expect(detect).not.toHaveBeenCalled()
    expect(launchMock).not.toHaveBeenCalled()
  })

  it('编组入口保留逐目标回退与错误提示', async () => {
    const sites = [
      makeSite({
        id: 's1',
        targets: [makeTarget('firefox', '/p1'), makeTarget('chrome', 'p1')]
      })
    ]
    const launchMock = makeLaunchMock((browser) =>
      browser.id === SYSTEM_BROWSER_ID
        ? { ok: true, opened: 1, failed: 0 }
        : { ok: false, opened: 0, failed: 1, error: '打开浏览器失败' }
    )
    const deps = makeGroupDeps(
      sites,
      [systemBrowser, chromeBrowser],
      launchMock
    )

    const result = await openQuickSiteGroup(makeGroup(['s1']), deps)

    expect(result).toEqual({
      ok: true,
      opened: 1,
      fallback: 1,
      failed: 1,
      errors: ['打开浏览器失败']
    })
  })
})
