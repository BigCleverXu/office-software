import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { shell } from 'electron'
import {
  SYSTEM_BROWSER_ID,
  normalizeQuickSiteUrl,
  type DetectedBrowser,
  type OpenQuickSiteResult
} from '../shared/quick-sites'

/** 启动依赖，可在测试中注入 */
export interface LaunchDeps {
  spawn?: typeof spawn
  openExternal?: (url: string) => Promise<void>
  exists?: (path: string) => boolean
  /** 等待实现，批量打开时用于控制相邻网址的间隔 */
  delay?: (ms: number) => Promise<void>
}

/** 批量打开结果 */
export interface BatchOpenResult {
  ok: boolean
  /** 成功打开的网址数 */
  opened: number
  /** 打开失败的网址数 */
  failed: number
  error?: string
}

/** 网址未通过校验 */
const INVALID_URL_ERROR = '网址无效'

/** 浏览器可执行文件缺失 */
const MISSING_EXECUTABLE_ERROR = '未找到浏览器可执行文件，请重新扫描后再试'

/** 启动失败 */
const LAUNCH_FAILED_ERROR = '打开浏览器失败'

/** 批量打开时相邻网址之间的间隔（毫秒） */
const BATCH_OPEN_INTERVAL_MS = 200

/** 默认等待实现 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 以分离进程启动一次命令；失败返回 false，不抛出 */
function spawnDetached(
  runner: typeof spawn,
  command: string,
  args: string[]
): boolean {
  try {
    const child = runner(command, args, {
      detached: true,
      stdio: 'ignore'
    })
    // 监听异步错误，避免进程级未处理异常
    if (typeof child.on === 'function') {
      child.on('error', () => {})
    }
    if (typeof child.unref === 'function') {
      child.unref()
    }
    return true
  } catch {
    return false
  }
}

/** 按内核拼装批量启动参数 */
function buildBatchArgs(
  browser: DetectedBrowser,
  profileId: string,
  urls: string[]
): string[] {
  if (browser.kind === 'firefox') {
    return profileId !== ''
      ? ['--new-instance', '--profile', profileId, ...urls]
      : [...urls]
  }
  return profileId !== ''
    ? [...urls, `--profile-directory=${profileId}`]
    : [...urls]
}

/**
 * 逐个打开网址，相邻两次之间等待固定间隔。
 *
 * initialFailed 计入已有的非法网址数量；任何一次失败都只累加计数，
 * 最终收敛为可读错误，不抛出。
 */
async function openSequentially(
  urls: string[],
  initialFailed: number,
  opener: (url: string) => Promise<void>,
  delay: (ms: number) => Promise<void>
): Promise<BatchOpenResult> {
  let opened = 0
  let failed = initialFailed
  let firstError: string | undefined
  for (let index = 0; index < urls.length; index += 1) {
    if (index > 0) {
      await delay(BATCH_OPEN_INTERVAL_MS)
    }
    try {
      await opener(urls[index])
      opened += 1
    } catch {
      failed += 1
      firstError = firstError ?? LAUNCH_FAILED_ERROR
    }
  }
  return firstError === undefined
    ? { ok: opened > 0, opened, failed }
    : { ok: opened > 0, opened, failed, error: firstError }
}

/** 按内核拼装命令与参数 */
function buildCommand(
  browser: DetectedBrowser,
  profileId: string,
  url: string
): { command: string; args: string[] } {
  if (browser.kind === 'safari') {
    return { command: 'open', args: ['-a', 'Safari', url] }
  }
  if (browser.kind === 'firefox') {
    return {
      command: browser.executable,
      args:
        profileId !== ''
          ? ['--new-instance', '--profile', profileId, url]
          : [url]
    }
  }
  return {
    command: browser.executable,
    args: profileId !== '' ? [url, `--profile-directory=${profileId}`] : [url]
  }
}

/**
 * 用指定浏览器与角色打开网址。
 *
 * 启动前再次校验网址协议；系统默认浏览器走 shell.openExternal，其余
 * 以分离进程启动，不阻塞界面。任何失败都收敛为可读结果，不抛出异常。
 */
export async function openUrlInBrowser(
  browser: DetectedBrowser,
  profileId: string,
  url: string,
  deps?: LaunchDeps
): Promise<OpenQuickSiteResult> {
  const normalizedUrl = normalizeQuickSiteUrl(url)
  if (normalizedUrl === '') {
    return { ok: false, error: INVALID_URL_ERROR }
  }
  const openExternal =
    deps?.openExternal ?? ((target: string) => shell.openExternal(target))
  const exists = deps?.exists ?? existsSync

  if (browser.id === SYSTEM_BROWSER_ID || browser.kind === 'system') {
    try {
      await openExternal(normalizedUrl)
      return { ok: true, browserName: browser.name }
    } catch {
      return { ok: false, error: LAUNCH_FAILED_ERROR }
    }
  }
  if (!exists(browser.executable)) {
    return { ok: false, error: MISSING_EXECUTABLE_ERROR }
  }

  const runner = deps?.spawn ?? spawn
  const { command, args } = buildCommand(browser, profileId, normalizedUrl)
  try {
    const child = runner(command, args, {
      detached: true,
      stdio: 'ignore'
    })
    // 监听异步错误，避免进程级未处理异常
    if (typeof child.on === 'function') {
      child.on('error', () => {})
    }
    if (typeof child.unref === 'function') {
      child.unref()
    }
    return { ok: true, browserName: browser.name }
  } catch {
    return { ok: false, error: LAUNCH_FAILED_ERROR }
  }
}

/**
 * 用指定浏览器与角色批量打开网址。
 *
 * 先逐个校验网址，非法网址计入失败；系统默认浏览器与 Safari 逐个打开
 * 并保留间隔，Chromium / Firefox 只启动一次并一次性传入全部网址。
 * 所有失败都收敛为可读结果，不抛出异常。
 */
export async function openUrlsInBrowser(
  browser: DetectedBrowser,
  profileId: string,
  urls: string[],
  deps?: LaunchDeps
): Promise<BatchOpenResult> {
  const delay = deps?.delay ?? wait
  const runner = deps?.spawn ?? spawn
  const openExternal =
    deps?.openExternal ?? ((target: string) => shell.openExternal(target))
  const exists = deps?.exists ?? existsSync

  const validUrls: string[] = []
  let failed = 0
  for (const url of urls) {
    const normalizedUrl = normalizeQuickSiteUrl(url)
    if (normalizedUrl === '') {
      failed += 1
    } else {
      validUrls.push(normalizedUrl)
    }
  }
  if (validUrls.length === 0) {
    return { ok: false, opened: 0, failed, error: INVALID_URL_ERROR }
  }

  if (browser.id === SYSTEM_BROWSER_ID || browser.kind === 'system') {
    return openSequentially(
      validUrls,
      failed,
      (url) => openExternal(url),
      delay
    )
  }

  if (browser.kind === 'safari') {
    return openSequentially(
      validUrls,
      failed,
      async (url) => {
        if (!spawnDetached(runner, 'open', ['-a', 'Safari', url])) {
          throw new Error(LAUNCH_FAILED_ERROR)
        }
      },
      delay
    )
  }

  if (!exists(browser.executable)) {
    return {
      ok: false,
      opened: 0,
      failed: failed + validUrls.length,
      error: MISSING_EXECUTABLE_ERROR
    }
  }

  const args = buildBatchArgs(browser, profileId, validUrls)
  if (!spawnDetached(runner, browser.executable, args)) {
    return {
      ok: false,
      opened: 0,
      failed: failed + validUrls.length,
      error: LAUNCH_FAILED_ERROR
    }
  }
  return { ok: true, opened: validUrls.length, failed }
}
