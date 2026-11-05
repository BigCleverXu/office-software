import { existsSync } from 'node:fs'
import {
  SYSTEM_BROWSER_ID,
  targetKeyOf,
  type DetectedBrowser,
  type OpenQuickSiteGroupResult,
  type OpenQuickSiteResult,
  type QuickSite,
  type QuickSiteGroup
} from '../shared/quick-sites'
import { openUrlsInBrowser } from './quick-site-launcher'
import type { QuickSiteStore } from './quick-site-store'

/** 探测结果缺失系统默认浏览器时的兜底项 */
export const SYSTEM_FALLBACK_BROWSER: DetectedBrowser = {
  id: SYSTEM_BROWSER_ID,
  name: '系统默认浏览器',
  kind: 'system',
  executable: '',
  profiles: []
}

/** 站点批量打开依赖，可在测试中注入 */
export interface SiteOpenDeps {
  detect: () => DetectedBrowser[]
  launchBatch?: typeof openUrlsInBrowser
  exists?: (path: string) => boolean
}

/** 编组打开依赖，在站点依赖之上额外提供站点存储 */
export interface GroupOpenDeps extends SiteOpenDeps {
  siteStore: QuickSiteStore
}

/** 同一浏览器与角色下待打开的网址 */
interface BrowserBatch {
  browser: DetectedBrowser
  profileId: string
  urls: string[]
}

/**
 * 按站点的全部打开方式批量打开网址。
 *
 * 系统目标进入系统批次；其余目标在浏览器存在且可执行文件存在时按
 * 「浏览器 + 角色」入桶，否则计入 fallback 并改投系统默认批次。
 * 同一浏览器与角色跨站点、跨目标合并为一次启动；各批次的成功 / 失败
 * 数量汇总后返回，浏览器名称与失败提示均去重，绝不抛出异常。
 */
export async function openSitesInBrowsers(
  sites: QuickSite[],
  deps: SiteOpenDeps
): Promise<OpenQuickSiteResult> {
  if (sites.every((site) => site.targets.length === 0)) {
    return {
      ok: false,
      opened: 0,
      fallback: 0,
      failed: 0,
      browserNames: [],
      errors: ['没有可用的打开方式']
    }
  }

  const launchBatch = deps.launchBatch ?? openUrlsInBrowser
  const fileExists = deps.exists ?? existsSync
  const browsers = deps.detect()
  const systemBrowser =
    browsers.find((browser) => browser.id === SYSTEM_BROWSER_ID) ??
    SYSTEM_FALLBACK_BROWSER

  const batches = new Map<string, BrowserBatch>()
  let fallback = 0

  const addUrl = (
    key: string,
    browser: DetectedBrowser,
    profileId: string,
    url: string
  ): void => {
    const batch = batches.get(key)
    if (batch !== undefined) {
      batch.urls.push(url)
    } else {
      batches.set(key, { browser, profileId, urls: [url] })
    }
  }

  for (const site of sites) {
    for (const target of site.targets) {
      if (target.browserId === SYSTEM_BROWSER_ID) {
        addUrl(SYSTEM_BROWSER_ID, systemBrowser, '', site.url)
        continue
      }
      const browser = browsers.find((item) => item.id === target.browserId)
      if (browser !== undefined && fileExists(browser.executable)) {
        addUrl(targetKeyOf(target), browser, target.profileId, site.url)
      } else {
        fallback += 1
        addUrl(SYSTEM_BROWSER_ID, systemBrowser, '', site.url)
      }
    }
  }

  let opened = 0
  let failed = 0
  const errors: string[] = []
  const browserNames: string[] = []

  for (const batch of batches.values()) {
    if (!browserNames.includes(batch.browser.name)) {
      browserNames.push(batch.browser.name)
    }
    const result = await launchBatch(
      batch.browser,
      batch.profileId,
      batch.urls,
      {
        exists: fileExists
      }
    )
    opened += result.opened
    failed += result.failed
    if (
      result.error !== undefined &&
      result.failed > 0 &&
      !errors.includes(result.error)
    ) {
      errors.push(result.error)
    }
  }

  return {
    ok: opened > 0,
    opened,
    fallback,
    failed,
    browserNames,
    ...(errors.length > 0 ? { errors } : {})
  }
}

/**
 * 按编组批量打开站点。
 *
 * 解析编组内的有效站点后交给 openSitesInBrowsers；编组为空时返回
 * 可读错误，不触发浏览器探测。
 */
export async function openQuickSiteGroup(
  group: QuickSiteGroup,
  deps: GroupOpenDeps
): Promise<OpenQuickSiteGroupResult> {
  const sites: QuickSite[] = []
  for (const id of group.siteIds) {
    const site = deps.siteStore.getById(id)
    if (site !== null) {
      sites.push(site)
    }
  }
  if (sites.length === 0) {
    return {
      ok: false,
      opened: 0,
      fallback: 0,
      failed: 0,
      errors: ['编组内没有可打开的网站']
    }
  }

  const result = await openSitesInBrowsers(sites, {
    detect: deps.detect,
    launchBatch: deps.launchBatch,
    exists: deps.exists
  })

  return {
    ok: result.ok,
    opened: result.opened,
    fallback: result.fallback,
    failed: result.failed,
    ...(result.errors?.length ? { errors: result.errors } : {})
  }
}
