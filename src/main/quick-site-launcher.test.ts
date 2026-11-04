import { describe, expect, it, vi } from 'vitest'
import type { DetectedBrowser } from '../shared/quick-sites'
import {
  openUrlsInBrowser,
  openUrlInBrowser,
  type LaunchDeps
} from './quick-site-launcher'

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

describe('openUrlInBrowser', () => {
  it('system 使用 openExternal 打开并返回浏览器名', async () => {
    const openExternal = vi.fn(async () => {})
    const browser = makeBrowser({
      id: 'system',
      name: '系统默认浏览器',
      kind: 'system',
      executable: ''
    })

    const result = await openUrlInBrowser(browser, '', 'github.com', {
      openExternal
    })

    expect(openExternal).toHaveBeenCalledWith('https://github.com/')
    expect(result).toEqual({ ok: true, browserName: '系统默认浏览器' })
  })

  it('chromium 带角色时附加 --profile-directory', async () => {
    const { spawnMock, unref } = makeSpawnMock()
    const browser = makeBrowser()
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    const result = await openUrlInBrowser(
      browser,
      'Profile 1',
      'https://example.com',
      deps
    )

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/google-chrome',
      ['https://example.com/', '--profile-directory=Profile 1'],
      { detached: true, stdio: 'ignore' }
    )
    expect(unref).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, browserName: 'Google Chrome' })
  })

  it('chromium 不带角色时只传网址', async () => {
    const { spawnMock } = makeSpawnMock()
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    await openUrlInBrowser(makeBrowser(), '', 'https://example.com', deps)

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/google-chrome',
      ['https://example.com/'],
      { detached: true, stdio: 'ignore' }
    )
  })

  it('firefox 带角色时使用 --new-instance --profile', async () => {
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

    await openUrlInBrowser(
      browser,
      '/home/alice/.mozilla/firefox/abc',
      'https://example.com',
      deps
    )

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/firefox',
      [
        '--new-instance',
        '--profile',
        '/home/alice/.mozilla/firefox/abc',
        'https://example.com/'
      ],
      { detached: true, stdio: 'ignore' }
    )
  })

  it('firefox 不带角色时只传网址', async () => {
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

    await openUrlInBrowser(browser, '', 'https://example.com', deps)

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/firefox',
      ['https://example.com/'],
      { detached: true, stdio: 'ignore' }
    )
  })

  it('Safari 通过 open -a Safari 启动', async () => {
    const { spawnMock } = makeSpawnMock()
    const browser = makeBrowser({
      id: 'safari',
      name: 'Safari',
      kind: 'safari',
      executable: '/Applications/Safari.app/Contents/MacOS/Safari'
    })
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    await openUrlInBrowser(browser, '', 'https://example.com', deps)

    expect(spawnMock).toHaveBeenCalledWith(
      'open',
      ['-a', 'Safari', 'https://example.com/'],
      { detached: true, stdio: 'ignore' }
    )
  })

  it('可执行文件缺失时返回可读错误且不启动进程', async () => {
    const { spawnMock } = makeSpawnMock()
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => false
    }

    const result = await openUrlInBrowser(
      makeBrowser(),
      '',
      'https://example.com',
      deps
    )

    expect(result).toEqual({
      ok: false,
      error: '未找到浏览器可执行文件，请重新扫描后再试'
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('非法网址返回网址无效且不启动进程', async () => {
    const { spawnMock } = makeSpawnMock()
    const deps: LaunchDeps = {
      spawn: spawnMock as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    const result = await openUrlInBrowser(
      makeBrowser(),
      '',
      'javascript:alert(1)',
      deps
    )

    expect(result).toEqual({ ok: false, error: '网址无效' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('spawn 抛出异常时返回打开浏览器失败', async () => {
    const deps: LaunchDeps = {
      spawn: (() => {
        throw new Error('boom')
      }) as unknown as LaunchDeps['spawn'],
      exists: () => true
    }

    const result = await openUrlInBrowser(
      makeBrowser(),
      '',
      'https://example.com',
      deps
    )

    expect(result).toEqual({ ok: false, error: '打开浏览器失败' })
  })

  it('openExternal 失败时返回打开浏览器失败', async () => {
    const openExternal = vi.fn(async () => {
      throw new Error('boom')
    })
    const browser = makeBrowser({
      id: 'system',
      name: '系统默认浏览器',
      kind: 'system',
      executable: ''
    })

    const result = await openUrlInBrowser(browser, '', 'https://example.com', {
      openExternal
    })

    expect(result).toEqual({ ok: false, error: '打开浏览器失败' })
  })
})

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
