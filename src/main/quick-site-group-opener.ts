import { existsSync } from 'node:fs'
import {
  SYSTEM_BROWSER_ID,
  type DetectedBrowser,
  type OpenQuickSiteGroupResult,
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

/** 编组打开依赖，可在测试中注入 */
export interface GroupOpenDeps {
  siteStore: QuickSiteStore
  detect: () => DetectedBrowser[]
  launchBatch?: typeof openUrlsInBrowser
  exists?: (path: string) => boolean
}

/** 同一浏览器与角色下待打开的网址 */
interface BrowserBatch {
  browser: DetectedBrowser
  profileId: string
  urls: string[]
}

/**
 * 按编组批量打开站点。
 *
 * 逐个读取站点并按「浏览器 + 角色」归并在一次启动中；浏览器缺失或
 * 可执行文件不存在时该站点回退到系统默认浏览器。各批次的成功 / 失败
 * 数量汇总后返回，失败提示去重收集，绝不抛出异常。
 */
export async function openQuickSiteGroup(
  group: QuickSiteGroup,
  deps: GroupOpenDeps
): Promise<OpenQuickSiteGroupResult> {
  const launchBatch = deps.launchBatch ?? openUrlsInBrowser
  const fileExists = deps.exists ?? existsSync

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

  const browsers = deps.detect()
  const systemBrowser =
    browsers.find((browser) => browser.id === SYSTEM_BROWSER_ID) ??
    SYSTEM_FALLBACK_BROWSER

  const batches = new Map<string, BrowserBatch>()
  let fallback = 0

  for (const site of sites) {
    let batchBrowser = systemBrowser
    let profileId = ''
    let key: string = SYSTEM_BROWSER_ID
    if (site.browserId !== SYSTEM_BROWSER_ID) {
      const browser = browsers.find((item) => item.id === site.browserId)
      if (browser !== undefined && fileExists(browser.executable)) {
        batchBrowser = browser
        profileId = site.profileId
        key = `${browser.id}:${site.profileId}`
      } else {
        fallback += 1
      }
    }
    const batch = batches.get(key)
    if (batch !== undefined) {
      batch.urls.push(site.url)
    } else {
      batches.set(key, { browser: batchBrowser, profileId, urls: [site.url] })
    }
  }

  let opened = 0
  let failed = 0
  const errors: string[] = []

  for (const batch of batches.values()) {
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
    ...(errors.length > 0 ? { errors } : {})
  }
}
