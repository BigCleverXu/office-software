import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UPDATE_DOWNLOAD_PATH_PREFIX,
  type ReleaseAsset,
  type UpdateDownloadProgress
} from '../shared/update'
import {
  AssetDownloader,
  isAllowedDownloadUrl,
  resolveDownloadedFile,
  sanitizeDownloadFileName
} from './update-downloader'

/** 用例创建的临时目录，afterEach 统一清理 */
const tempDirs: string[] = []
let downloadDir = ''

beforeEach(async () => {
  downloadDir = await mkdtemp(join(tmpdir(), 'update-downloader-'))
  tempDirs.push(downloadDir)
})

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

/** 合法的本仓库 release 下载地址 */
const DOWNLOAD_URL =
  'https://github.com/BigCleverXu/office-software/releases/download/' +
  'v2.4.0/app-setup.exe'

/** 构造测试用资产 */
function makeAsset(overrides: Partial<ReleaseAsset> = {}): ReleaseAsset {
  return {
    name: 'app-setup.exe',
    size: 0,
    downloadUrl: DOWNLOAD_URL,
    ...overrides
  }
}

/** 把 fetch 实现收窄为全局 fetch 类型 */
function asFetch(impl: (...args: never[]) => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch
}

/**
 * 构造受控 fetch：响应挂起，测试可手动 resolve；收到 abort 时拒绝。
 * 用于在下载进行中检查状态快照。
 */
function controlledFetch(): {
  impl: (...args: never[]) => Promise<Response>
  resolve: (response: Response) => void
} {
  let resolveResponse: (response: Response) => void = () => undefined
  let rejectResponse: (reason?: unknown) => void = () => undefined
  const pending = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  const impl = (async (_url: string, init?: RequestInit) => {
    // 取消可能发生在 fetch 发起之前，此时 signal 已处于 aborted 状态
    if (init?.signal?.aborted) {
      rejectResponse(new DOMException('Aborted', 'AbortError'))
      return pending
    }
    init?.signal?.addEventListener('abort', () => {
      rejectResponse(new DOMException('Aborted', 'AbortError'))
    })
    return pending
  }) as unknown as (...args: never[]) => Promise<Response>
  return { impl, resolve: resolveResponse }
}

/** 构造一次性返回固定内容的 200 响应 */
function textResponse(content: string): Response {
  const bytes = new TextEncoder().encode(content)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-length': String(bytes.length) }
  })
}

/** 构造一次性返回固定内容、可自定义响应头的 200 响应 */
function bodyResponse(
  content: string,
  headers: Record<string, string> = {}
): Response {
  const bytes = new TextEncoder().encode(content)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers })
}

/** 构造永不结束的 200 响应；收到 abort 时让流报错 */
function endlessResponse(init?: RequestInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunk = new Uint8Array(1024)
      const timer = setInterval(() => {
        try {
          controller.enqueue(chunk)
        } catch {
          clearInterval(timer)
        }
      }, 1)
      init?.signal?.addEventListener('abort', () => {
        clearInterval(timer)
        controller.error(new DOMException('Aborted', 'AbortError'))
      })
    }
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-length': '10485760' }
  })
}

describe('isAllowedDownloadUrl', () => {
  it('本仓库 release 下载地址合法', () => {
    expect(isAllowedDownloadUrl(DOWNLOAD_URL)).toBe(true)
  })

  it('非 HTTPS、非 github.com、非本仓库路径均不合法', () => {
    expect(
      isAllowedDownloadUrl(
        `http://github.com${UPDATE_DOWNLOAD_PATH_PREFIX}v1/app.exe`
      )
    ).toBe(false)
    expect(
      isAllowedDownloadUrl(
        `https://example.com${UPDATE_DOWNLOAD_PATH_PREFIX}v1/app.exe`
      )
    ).toBe(false)
    expect(
      isAllowedDownloadUrl(
        'https://github.com/other/repo/releases/download/v1/app.exe'
      )
    ).toBe(false)
  })

  it('无法解析的地址返回 false 而不抛异常', () => {
    expect(isAllowedDownloadUrl('not a url')).toBe(false)
    expect(isAllowedDownloadUrl('')).toBe(false)
  })
})

describe('sanitizeDownloadFileName', () => {
  it('路径穿越只保留最后一段', () => {
    expect(sanitizeDownloadFileName('../../evil.exe')).toBe('evil.exe')
  })

  it('反斜杠路径同样只保留最后一段', () => {
    expect(sanitizeDownloadFileName('..\\..\\evil.exe')).toBe('evil.exe')
  })

  it('非法字符替换为下划线', () => {
    const name = sanitizeDownloadFileName('my app (1).exe')
    expect(name).toBe('my_app__1_.exe')
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('去掉开头的点', () => {
    expect(sanitizeDownloadFileName('...hidden.exe')).toBe('hidden.exe')
  })

  it('结果为空时回退为 update-installer', () => {
    expect(sanitizeDownloadFileName('')).toBe('update-installer')
    expect(sanitizeDownloadFileName('dir/')).toBe('update-installer')
    expect(sanitizeDownloadFileName('...')).toBe('update-installer')
  })
})

describe('resolveDownloadedFile', () => {
  it('下载目录内的文件返回绝对路径', () => {
    const file = join(downloadDir, 'app-setup.exe')
    expect(resolveDownloadedFile(file, downloadDir)).toBe(file)
  })

  it('../ 越界路径返回 null', () => {
    expect(
      resolveDownloadedFile(join(downloadDir, '..', 'evil.exe'), downloadDir)
    ).toBeNull()
  })

  it('下载目录本身返回 null', () => {
    expect(resolveDownloadedFile(downloadDir, downloadDir)).toBeNull()
  })

  it('空路径返回 null', () => {
    expect(resolveDownloadedFile('', downloadDir)).toBeNull()
    expect(resolveDownloadedFile('   ', downloadDir)).toBeNull()
  })
})

describe('AssetDownloader 正常下载', () => {
  it('写入最终文件并上报开始 0% 与结束 100%', async () => {
    const content = 'installer-binary-content'
    const fetchImpl = vi.fn(async () => textResponse(content))
    const progress: UpdateDownloadProgress[] = []
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset({ size: content.length }),
      downloadDir,
      onProgress: (item) => progress.push(item),
      fetchImpl: asFetch(fetchImpl)
    })

    expect(result).toEqual({
      status: 'completed',
      fileName: 'app-setup.exe',
      filePath: join(downloadDir, 'app-setup.exe')
    })
    expect(await readFile(join(downloadDir, 'app-setup.exe'), 'utf8')).toBe(
      content
    )
    // 最终文件存在，且 .part 已被 rename 掉
    expect(await readdir(downloadDir)).toEqual(['app-setup.exe'])

    const first = progress[0]
    expect(first?.percent).toBe(0)
    expect(first?.transferred).toBe(0)
    const last = progress[progress.length - 1]
    expect(last?.percent).toBe(100)
    expect(last?.transferred).toBe(content.length)
    expect(progress.every((item) => item.total === content.length)).toBe(true)
    expect(progress.every((item) => item.fileName === 'app-setup.exe')).toBe(
      true
    )
  })

  it('content-length 缺失且资产未声明大小时最终进度仍为 100%', async () => {
    const content = 'installer-without-length'
    const bytes = new TextEncoder().encode(content)
    const fetchImpl = vi.fn(async () => bodyResponse(content))
    const progress: UpdateDownloadProgress[] = []
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset({ size: 0 }),
      downloadDir,
      onProgress: (item) => progress.push(item),
      fetchImpl: asFetch(fetchImpl)
    })

    expect(result.status).toBe('completed')
    const last = progress[progress.length - 1]
    expect(last?.transferred).toBe(bytes.length)
    // 总大小未知时保持 0，仅强制补发 100%
    expect(last?.total).toBe(0)
    expect(last?.percent).toBe(100)
  })

  it('content-length 与实际字节不一致时最终进度仍为 100%', async () => {
    const content = 'installer-truncated-body'
    const bytes = new TextEncoder().encode(content)
    // 声明总长大于 / 小于实际字节，覆盖两个方向的偏差
    const cases = [
      { length: bytes.length + 500, expectedTotal: bytes.length + 500 },
      { length: 1, expectedTotal: 1 }
    ]
    const progress: UpdateDownloadProgress[] = []
    const downloader = new AssetDownloader()

    for (const item of cases) {
      progress.length = 0
      const headers = { 'content-length': String(item.length) }
      const fetchImpl = vi.fn(async () => bodyResponse(content, headers))
      const result = await downloader.download({
        asset: makeAsset({ size: 0 }),
        downloadDir,
        onProgress: (event) => progress.push(event),
        fetchImpl: asFetch(fetchImpl)
      })

      expect(result.status).toBe('completed')
      const last = progress[progress.length - 1]
      expect(last?.transferred).toBe(bytes.length)
      expect(last?.total).toBe(item.expectedTotal)
      expect(last?.percent).toBe(100)
    }
  })
})

describe('AssetDownloader 取消', () => {
  it('进行中取消返回 cancelled 且无残留文件', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      endlessResponse(init)
    )
    const downloader = new AssetDownloader()
    let cancelled = false

    const result = await downloader.download({
      asset: makeAsset({ size: 10485760 }),
      downloadDir,
      progressIntervalMs: 0,
      fetchImpl: asFetch(fetchImpl),
      onProgress: (item) => {
        // 传输开始后取消，覆盖取消发生在流式读取途中的场景
        if (!cancelled && item.transferred > 0) {
          cancelled = true
          downloader.cancel()
        }
      }
    })

    expect(cancelled).toBe(true)
    expect(result).toEqual({ status: 'cancelled' })
    expect(await readdir(downloadDir)).toEqual([])
    expect(downloader.downloading).toBe(false)
  })
})

describe('AssetDownloader 拒绝与失败', () => {
  it('非法下载地址返回 invalid-asset 且不发起请求', async () => {
    const fetchImpl = vi.fn(async () => textResponse('x'))
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset({ downloadUrl: 'https://example.com/evil.exe' }),
      downloadDir,
      fetchImpl: asFetch(fetchImpl)
    })

    expect(result).toEqual({ status: 'failed', reason: 'invalid-asset' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await readdir(downloadDir)).toEqual([])
  })

  it('前一个下载未结束时第二个返回 busy', async () => {
    let started: () => void = () => undefined
    const fetching = new Promise<void>((resolve) => {
      started = resolve
    })
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      started()
      return endlessResponse(init)
    })
    const downloader = new AssetDownloader()

    const first = downloader.download({
      asset: makeAsset({ size: 10485760 }),
      downloadDir,
      fetchImpl: asFetch(fetchImpl)
    })
    await fetching
    expect(downloader.downloading).toBe(true)

    const second = await downloader.download({
      asset: makeAsset(),
      downloadDir,
      fetchImpl: asFetch(fetchImpl)
    })
    expect(second).toEqual({ status: 'failed', reason: 'busy' })

    downloader.cancel()
    expect(await first).toEqual({ status: 'cancelled' })
    expect(downloader.downloading).toBe(false)
    expect(await readdir(downloadDir)).toEqual([])
  })

  it('非 2xx 响应返回 http 与状态码且无残留文件', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset(),
      downloadDir,
      fetchImpl: asFetch(fetchImpl)
    })

    expect(result).toEqual({
      status: 'failed',
      reason: 'http',
      detail: 'HTTP 404'
    })
    expect(await readdir(downloadDir)).toEqual([])
  })

  it('fetch 抛错返回 network 并带异常详情', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom')
    })
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset(),
      downloadDir,
      fetchImpl: asFetch(fetchImpl)
    })

    expect(result).toMatchObject({ status: 'failed', reason: 'network' })
    const detail = result.status === 'failed' ? (result.detail ?? '') : ''
    expect(detail).toContain('boom')
    expect(await readdir(downloadDir)).toEqual([])
  })

  it('底层错误码写入诊断详情', async () => {
    const networkError = Object.assign(
      new Error('getaddrinfo ENOTFOUND github.com'),
      { code: 'ENOTFOUND' }
    )
    const fetchImpl = vi.fn(async () => {
      throw networkError
    })
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset(),
      downloadDir,
      fetchImpl: asFetch(fetchImpl)
    })

    expect(result).toMatchObject({ status: 'failed', reason: 'network' })
    const detail = result.status === 'failed' ? (result.detail ?? '') : ''
    expect(detail).toContain('ENOTFOUND')
    expect(await readdir(downloadDir)).toEqual([])
  })

  it('连接超时返回 timeout 且无残留文件', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
    )
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset(),
      downloadDir,
      connectTimeoutMs: 20,
      fetchImpl: asFetch(fetchImpl)
    })

    expect(result).toMatchObject({ status: 'failed', reason: 'timeout' })
    const detail = result.status === 'failed' ? (result.detail ?? '') : ''
    expect(detail).toContain('连接超时')
    expect(await readdir(downloadDir)).toEqual([])
    expect(downloader.downloading).toBe(false)
  })

  it('传输停滞超时返回 timeout 且无残留文件', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'))
          })
        }
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-length': '1024' }
      })
    })
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset({ size: 1024 }),
      downloadDir,
      idleTimeoutMs: 20,
      fetchImpl: asFetch(fetchImpl)
    })

    expect(result).toMatchObject({ status: 'failed', reason: 'timeout' })
    const detail = result.status === 'failed' ? (result.detail ?? '') : ''
    expect(detail).toContain('传输停滞超时')
    expect(await readdir(downloadDir)).toEqual([])
    expect(downloader.downloading).toBe(false)
  })

  it('进度回调抛异常不影响下载完成', async () => {
    const content = 'installer-with-broken-progress'
    const fetchImpl = vi.fn(async () => textResponse(content))
    const downloader = new AssetDownloader()

    const result = await downloader.download({
      asset: makeAsset({ size: content.length }),
      downloadDir,
      fetchImpl: asFetch(fetchImpl),
      onProgress: () => {
        throw new Error('window destroyed')
      }
    })

    expect(result.status).toBe('completed')
    expect(await readFile(join(downloadDir, 'app-setup.exe'), 'utf8')).toBe(
      content
    )
  })
})

describe('AssetDownloader 下载状态快照', () => {
  it('进行中查询返回 downloading 且带资产与初始进度', async () => {
    const content = 'installer-content'
    const controlled = controlledFetch()
    const downloader = new AssetDownloader()

    const promise = downloader.download({
      asset: makeAsset({ size: content.length }),
      downloadDir,
      fetchImpl: asFetch(controlled.impl)
    })

    const snapshot = downloader.getSnapshot()
    expect(snapshot.status).toBe('downloading')
    if (snapshot.status === 'downloading') {
      expect(snapshot.asset.name).toBe('app-setup.exe')
      expect(snapshot.progress.fileName).toBe('app-setup.exe')
      expect(snapshot.progress.transferred).toBe(0)
      expect(snapshot.progress.percent).toBe(0)
    }

    controlled.resolve(textResponse(content))
    expect(await promise).toEqual({
      status: 'completed',
      fileName: 'app-setup.exe',
      filePath: join(downloadDir, 'app-setup.exe')
    })
    expect(downloader.getSnapshot()).toMatchObject({
      status: 'completed',
      fileName: 'app-setup.exe',
      filePath: join(downloadDir, 'app-setup.exe')
    })
  })

  it('下载完成后快照为 completed', async () => {
    const content = 'installer-finished'
    const fetchImpl = vi.fn(async () => textResponse(content))
    const downloader = new AssetDownloader()

    await downloader.download({
      asset: makeAsset({ size: content.length }),
      downloadDir,
      fetchImpl: asFetch(fetchImpl)
    })

    expect(downloader.getSnapshot()).toEqual({
      status: 'completed',
      asset: makeAsset({ size: content.length }),
      fileName: 'app-setup.exe',
      filePath: join(downloadDir, 'app-setup.exe')
    })
  })

  it('取消后快照为 idle', async () => {
    const controlled = controlledFetch()
    const downloader = new AssetDownloader()

    const promise = downloader.download({
      asset: makeAsset({ size: 1024 }),
      downloadDir,
      fetchImpl: asFetch(controlled.impl)
    })
    expect(downloader.getSnapshot().status).toBe('downloading')

    downloader.cancel()
    expect(await promise).toEqual({ status: 'cancelled' })
    expect(downloader.getSnapshot()).toEqual({ status: 'idle' })
  })

  it('失败后快照为 failed 且带失败原因', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom')
    })
    const downloader = new AssetDownloader()

    await downloader.download({
      asset: makeAsset(),
      downloadDir,
      fetchImpl: asFetch(fetchImpl)
    })

    expect(downloader.getSnapshot()).toMatchObject({
      status: 'failed',
      reason: 'network'
    })
  })
})
