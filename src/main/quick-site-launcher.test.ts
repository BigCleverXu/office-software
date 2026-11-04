import { describe, expect, it, vi } from 'vitest'
import type { DetectedBrowser } from '../shared/quick-sites'
import { openUrlsInBrowser, type LaunchDeps } from './quick-site-launcher'

/** 构造一个浏览器对象 */
function makeBrowser(
  overrides: Partial<DetectedBrowser> = {}
): DetectedBrowser {
  return {
    id: 'chrome',
    name: 'Google Chrome',
    kind: 'chromium',
    executable: '/usr/bin/google-chrome',
    profiles: [],
    ...overrides
  }
}

/** 构造假子进程并返回 spawn mock */
function makeSpawnMock(): {
  spawnMock: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
} {
  const unref = vi.fn()
  const on = vi.fn()
  const spawnMock = vi.fn(() => ({ unref, on }))
  return { spawnMock, unref, on }
}

describe('openUrlsInBrowser', () => {
  it('chromium 多个网址合并为一次启动', async () => {
    const { spawnMock } = makeSpawnMock()
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    const result = await openUrlsInBrowser(
      makeBrowser(),
      'Profile 1',
      ['https://a.com', 'b.com'],
      deps
    )

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/google-chrome',
      ['https://a.com/', 'https://b.com/', '--profile-directory=Profile 1'],
      { detached: true, stdio: 'ignore' }
    )
    expect(result).toEqual({ ok: true, opened: 2, failed: 0 })
  })

  it('firefox 带角色时多网址合并为一次启动', async () => {
    const { spawnMock } = makeSpawnMock()
    const browser = makeBrowser({
      id: 'firefox',
      name: 'Mozilla Firefox',
      kind: 'firefox',
      executable: '/usr/bin/firefox'
    })
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    const result = await openUrlsInBrowser(
      browser,
      '/home/alice/.mozilla/firefox/abc',
      ['https://a.com', 'https://b.com'],
      deps
    )

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/firefox',
      [
        '--new-instance',
        '--profile',
        '/home/alice/.mozilla/firefox/abc',
        'https://a.com/',
        'https://b.com/'
      ],
      { detached: true, stdio: 'ignore' }
    )
    expect(result).toEqual({ ok: true, opened: 2, failed: 0 })
  })

  it('system 逐个打开且相邻网址之间等待 200ms', async () => {
    const openExternal = vi.fn(async () => {})
    const delay = vi.fn(async () => {})
    const browser = makeBrowser({
      id: 'system',
      name: '系统默认浏览器',
      kind: 'system',
      executable: ''
    })
    const deps: LaunchDeps = { openExternal, delay }

    const result = await openUrlsInBrowser(
      browser,
      '',
      ['https://a.com', 'https://b.com', 'https://c.com'],
      deps
    )

    expect(openExternal).toHaveBeenCalledTimes(3)
    expect(openExternal).toHaveBeenNthCalledWith(1, 'https://a.com/')
    expect(openExternal).toHaveBeenNthCalledWith(3, 'https://c.com/')
    expect(delay).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledWith(200)
    expect(result).toEqual({ ok: true, opened: 3, failed: 0 })
  })

  it('含非法网址时计入失败，合法网址照常打开', async () => {
    const { spawnMock } = makeSpawnMock()
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    const result = await openUrlsInBrowser(
      makeBrowser(),
      '',
      ['https://a.com', 'javascript:alert(1)', 'b.com'],
      deps
    )

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/google-chrome',
      ['https://a.com/', 'https://b.com/'],
      { detached: true, stdio: 'ignore' }
    )
    expect(result).toEqual({ ok: true, opened: 2, failed: 1 })
  })

  it('可执行文件缺失时全部合法网址计入失败', async () => {
    const { spawnMock } = makeSpawnMock()
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => false
    }

    const result = await openUrlsInBrowser(
      makeBrowser(),
      '',
      ['https://a.com', 'https://b.com'],
      deps
    )

    expect(result).toEqual({
      ok: false,
      opened: 0,
      failed: 2,
      error: '未找到浏览器可执行文件，请重新扫描后再试'
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('全部网址非法时返回网址无效且失败数与输入一致', async () => {
    const { spawnMock } = makeSpawnMock()
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    const result = await openUrlsInBrowser(
      makeBrowser(),
      '',
      ['javascript:alert(1)', 'file:///etc/passwd'],
      deps
    )

    expect(result).toEqual({
      ok: false,
      opened: 0,
      failed: 2,
      error: '网址无效'
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
