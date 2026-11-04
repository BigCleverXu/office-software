import { describe, expect, it, vi } from 'vitest'
import {
  SYSTEM_BROWSER_ID,
  type DetectedBrowser,
  type QuickSite,
  type QuickSiteGroup
} from '../shared/quick-sites'
import type { BatchOpenResult } from './quick-site-launcher'
import {
  openQuickSiteGroup,
  type GroupOpenDeps
} from './quick-site-group-opener'
import type { QuickSiteStore } from './quick-site-store'

/** 构造一个站点 */
function makeSite(overrides: Partial<QuickSite> = {}): QuickSite {
  return {
    id: 's1',
    name: '站点',
    url: 'https://a.com/',
    browserId: SYSTEM_BROWSER_ID,
    profileId: '',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
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

/** 构造依赖，默认所有可执行文件均存在 */
function makeDeps(
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

describe('openQuickSiteGroup', () => {
  it('按浏览器与角色归并，每组只调用一次批量启动', async () => {
    const sites = [
      makeSite({
        id: 's1',
        url: 'https://a.com/',
        browserId: 'chrome',
        profileId: 'p1'
      }),
      makeSite({
        id: 's2',
        url: 'https://b.com/',
        browserId: 'chrome',
        profileId: 'p1'
      }),
      makeSite({
        id: 's3',
        url: 'https://c.com/',
        browserId: 'chrome',
        profileId: 'p2'
      }),
      makeSite({ id: 's4', url: 'https://d.com/' })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeDeps(sites, [systemBrowser, chromeBrowser], launchMock)

    const result = await openQuickSiteGroup(
      makeGroup(['s1', 's2', 's3', 's4']),
      deps
    )

    const calls = launchMock.mock.calls as [DetectedBrowser, string, string[]][]
    expect(calls).toHaveLength(3)
    expect(calls[0][0].id).toBe('chrome')
    expect(calls[0][1]).toBe('p1')
    expect(calls[0][2]).toEqual(['https://a.com/', 'https://b.com/'])
    expect(calls[1][1]).toBe('p2')
    expect(calls[1][2]).toEqual(['https://c.com/'])
    expect(calls[2][0].id).toBe(SYSTEM_BROWSER_ID)
    expect(calls[2][2]).toEqual(['https://d.com/'])
    expect(result).toEqual({
      ok: true,
      opened: 4,
      fallback: 0,
      failed: 0
    })
  })

  it('浏览器缺失时该组网址回退系统浏览器并累加 fallback', async () => {
    const sites = [
      makeSite({
        id: 's1',
        url: 'https://a.com/',
        browserId: 'firefox',
        profileId: '/p1'
      }),
      makeSite({
        id: 's2',
        url: 'https://b.com/',
        browserId: 'firefox',
        profileId: '/p2'
      })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeDeps(sites, [systemBrowser], launchMock)

    const result = await openQuickSiteGroup(makeGroup(['s1', 's2']), deps)

    const calls = launchMock.mock.calls as [DetectedBrowser, string, string[]][]
    expect(calls).toHaveLength(1)
    expect(calls[0][0].id).toBe(SYSTEM_BROWSER_ID)
    expect(calls[0][2]).toEqual(['https://a.com/', 'https://b.com/'])
    expect(result).toEqual({
      ok: true,
      opened: 2,
      fallback: 2,
      failed: 0
    })
  })

  it('可执行文件缺失时同样回退系统浏览器', async () => {
    const sites = [
      makeSite({
        id: 's1',
        url: 'https://a.com/',
        browserId: 'chrome',
        profileId: 'p1'
      }),
      makeSite({ id: 's2', url: 'https://b.com/' })
    ]
    const launchMock = makeLaunchMock()
    const deps = makeDeps(
      sites,
      [systemBrowser, chromeBrowser],
      launchMock,
      () => false
    )

    const result = await openQuickSiteGroup(makeGroup(['s1', 's2']), deps)

    const calls = launchMock.mock.calls as [DetectedBrowser, string, string[]][]
    expect(calls).toHaveLength(1)
    expect(calls[0][0].id).toBe(SYSTEM_BROWSER_ID)
    expect(calls[0][2]).toEqual(['https://a.com/', 'https://b.com/'])
    expect(result).toEqual({
      ok: true,
      opened: 2,
      fallback: 1,
      failed: 0
    })
  })

  it('累加各组失败数并去重收集错误提示', async () => {
    const sites = [
      makeSite({
        id: 's1',
        url: 'https://a.com/',
        browserId: 'chrome',
        profileId: 'p1'
      }),
      makeSite({
        id: 's2',
        url: 'https://b.com/',
        browserId: 'chrome',
        profileId: 'p2'
      }),
      makeSite({ id: 's3', url: 'https://c.com/' })
    ]
    const launchMock = makeLaunchMock((browser) =>
      browser.id === SYSTEM_BROWSER_ID
        ? { ok: true, opened: 1, failed: 0 }
        : { ok: false, opened: 0, failed: 1, error: '打开浏览器失败' }
    )
    const deps = makeDeps(sites, [systemBrowser, chromeBrowser], launchMock)

    const result = await openQuickSiteGroup(makeGroup(['s1', 's2', 's3']), deps)

    expect(result).toEqual({
      ok: true,
      opened: 1,
      fallback: 0,
      failed: 2,
      errors: ['打开浏览器失败']
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

  it('全部失败时 ok 为 false', async () => {
    const sites = [
      makeSite({
        id: 's1',
        url: 'https://a.com/',
        browserId: 'chrome',
        profileId: 'p1'
      })
    ]
    const launchMock = makeLaunchMock(() => ({
      ok: false,
      opened: 0,
      failed: 1,
      error: '打开浏览器失败'
    }))
    const deps = makeDeps(sites, [systemBrowser, chromeBrowser], launchMock)

    const result = await openQuickSiteGroup(makeGroup(['s1']), deps)

    expect(result).toEqual({
      ok: false,
      opened: 0,
      fallback: 0,
      failed: 1,
      errors: ['打开浏览器失败']
    })
  })
})
