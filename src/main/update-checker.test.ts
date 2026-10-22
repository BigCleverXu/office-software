import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_CHECK_INITIAL_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  type ReleaseInfo,
  type UpdateCheckResult
} from '../shared/update'
import type { ReleaseFetchResult } from './release-provider'
import { UpdateChecker, checkForUpdate } from './update-checker'

/** 构造测试用发行版信息 */
function makeRelease(version: string): ReleaseInfo {
  return {
    version,
    tag: `v${version}`,
    title: `版本 ${version}`,
    notes: '',
    publishedAt: null,
    pageUrl: `https://github.com/o/r/releases/tag/v${version}`
  }
}

/** 可手动 resolve 的 promise，用于构造「检查在途」场景 */
function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolveFn: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve
  })
  return { promise, resolve: (value: T) => resolveFn(value) }
}

describe('checkForUpdate', () => {
  it('发行版更新时返回 update-available', async () => {
    const release = makeRelease('1.1.0')
    const result = await checkForUpdate('1.0.0', async () => ({
      ok: true,
      release
    }))
    expect(result).toEqual({
      status: 'update-available',
      currentVersion: '1.0.0',
      release
    })
  })

  it('发行版同版本时返回 up-to-date', async () => {
    const release = makeRelease('1.0.0')
    const result = await checkForUpdate('1.0.0', async () => ({
      ok: true,
      release
    }))
    expect(result).toEqual({
      status: 'up-to-date',
      currentVersion: '1.0.0',
      release
    })
  })

  it('仓库无发行版时返回 no-release', async () => {
    const result = await checkForUpdate('1.0.0', async () => ({
      ok: true,
      release: null
    }))
    expect(result).toEqual({
      status: 'no-release',
      currentVersion: '1.0.0'
    })
  })

  it('取数异常时收敛为 error/unknown', async () => {
    const result = await checkForUpdate('1.0.0', async () => {
      throw new Error('boom')
    })
    expect(result).toEqual({
      status: 'error',
      currentVersion: '1.0.0',
      reason: 'unknown'
    })
  })

  it('取数失败时保留原始失败原因', async () => {
    const result = await checkForUpdate('1.0.0', async () => ({
      ok: false,
      reason: 'timeout'
    }))
    expect(result).toEqual({
      status: 'error',
      currentVersion: '1.0.0',
      reason: 'timeout'
    })
  })
})

interface Harness {
  checker: UpdateChecker
  fetches: ReturnType<typeof vi.fn>
  available: UpdateCheckResult[]
  setResult: (next: ReleaseFetchResult) => void
}

/** 已创建的实例，退出每个用例时统一 stop */
const trackers: UpdateChecker[] = []

function createHarness(result: ReleaseFetchResult): Harness {
  let current = result
  const fetches = vi.fn(() => Promise.resolve(current))
  const available: UpdateCheckResult[] = []
  const checker = new UpdateChecker({
    getVersion: () => '1.0.0',
    fetchRelease: fetches,
    onUpdateAvailable: (item) => available.push(item)
  })
  trackers.push(checker)
  return {
    checker,
    fetches,
    available,
    setResult: (next) => {
      current = next
    }
  }
}

describe('UpdateChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    while (trackers.length > 0) {
      trackers.pop()?.stop()
    }
    vi.useRealTimers()
  })

  it('启动 10 秒后执行首次检查', async () => {
    const harness = createHarness({ ok: true, release: makeRelease('1.1.0') })

    harness.checker.start()
    await vi.advanceTimersByTimeAsync(9999)
    expect(harness.fetches).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.available).toHaveLength(1)
  })

  it('首检后每 4 小时再次检查', async () => {
    const harness = createHarness({ ok: true, release: makeRelease('1.1.0') })

    harness.checker.start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INITIAL_DELAY_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(2)
  })

  it('同一版本只提醒一次，更高版本再次提醒', async () => {
    const harness = createHarness({ ok: true, release: makeRelease('1.1.0') })

    harness.checker.start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INITIAL_DELAY_MS)
    expect(harness.available).toHaveLength(1)

    // 同一版本再次发现：不再回调
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(2)
    expect(harness.available).toHaveLength(1)

    // 出现更高版本：再次回调
    harness.setResult({ ok: true, release: makeRelease('1.2.0') })
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(harness.available).toHaveLength(2)
    const latest = harness.available[1]
    expect(latest.status).toBe('update-available')
    if (latest.status === 'update-available') {
      expect(latest.release.version).toBe('1.2.0')
    }
  })

  it('检查失败时记录日志且不回调', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const harness = createHarness({ ok: false, reason: 'network' })

    harness.checker.start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INITIAL_DELAY_MS)

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.available).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('自动检查更新失败:', 'network')
    warn.mockRestore()
  })

  it('已是最新或无发行版时静默', async () => {
    const harness = createHarness({ ok: true, release: makeRelease('1.0.0') })

    harness.checker.start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INITIAL_DELAY_MS)
    expect(harness.available).toHaveLength(0)

    harness.setResult({ ok: true, release: null })
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(2)
    expect(harness.available).toHaveLength(0)
  })

  it('stop 后不再检查也不再回调', async () => {
    const harness = createHarness({ ok: true, release: makeRelease('1.1.0') })

    harness.checker.start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INITIAL_DELAY_MS)
    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.available).toHaveLength(1)

    harness.checker.stop()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS * 2)

    expect(harness.fetches).toHaveBeenCalledTimes(1)
    expect(harness.available).toHaveLength(1)
  })

  it('stop 后丢弃在途检查的结果', async () => {
    const deferred = createDeferred<ReleaseFetchResult>()
    const available: UpdateCheckResult[] = []
    const checker = new UpdateChecker({
      getVersion: () => '1.0.0',
      fetchRelease: () => deferred.promise,
      onUpdateAvailable: (item) => available.push(item)
    })
    trackers.push(checker)

    checker.start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INITIAL_DELAY_MS)

    checker.stop()
    deferred.resolve({ ok: true, release: makeRelease('1.1.0') })
    await vi.advanceTimersByTimeAsync(0)

    expect(available).toHaveLength(0)
  })
})
