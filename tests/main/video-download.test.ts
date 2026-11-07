import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  VideoDownloadProgress,
  VideoDownloadSnapshot,
  VideoResource,
  VideoVariant
} from '../../src/shared/video'
import {
  VideoDownloader,
  type VideoDownloaderOptions
} from '../../src/main/video/downloader'

/** 固定测试字节：100KB，内容按索引变化便于发现拼接错位 */
const PAYLOAD = Buffer.alloc(100 * 1024)
for (let index = 0; index < PAYLOAD.length; index += 1) {
  PAYLOAD[index] = index % 251
}

/** 慢速流的单块大小（字节） */
const SLOW_CHUNK_SIZE = 4096

/** 慢速流的单块间隔（毫秒） */
const SLOW_CHUNK_DELAY_MS = 5

/** 用例创建的临时目录，afterEach 统一清理 */
const tempDirs: string[] = []
let downloadDir = ''

/** 测试期望的文件名 */
const EXPECTED_FILE_NAME = '测试视频-1080P 高清.mp4'

beforeEach(async () => {
  downloadDir = await mkdtemp(join(tmpdir(), 'video-download-'))
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

/** 一次被本地服务记录到的请求 */
interface RecordedRequest {
  path: string
  range: string | null
}

/** 本地测试服务句柄 */
interface TestServerHandle {
  baseUrl: string
  requests: RecordedRequest[]
  /** 切换为忽略 Range，始终返回 200 全量 */
  setIgnoreRange: (value: boolean) => void
  close: () => Promise<void>
}

/** 按客户端请求发送全量或部分内容，慢速路由分块发送 */
function respond(
  req: IncomingMessage,
  res: ServerResponse,
  ignoreRange: boolean,
  slow: boolean
): void {
  if (req.url === '/rate') {
    res.writeHead(429, { 'content-length': '0' })
    res.end()
    return
  }
  if (req.url === '/expired') {
    res.writeHead(404, { 'content-length': '0' })
    res.end()
    return
  }
  const range = req.headers.range ?? null
  const match = range === null ? null : /bytes=(\d+)-/.exec(range)
  let start = 0
  let status = 200
  const headers: Record<string, string> = { 'accept-ranges': 'bytes' }
  if (match !== null && !ignoreRange) {
    start = Number(match[1])
    if (start >= PAYLOAD.length) {
      res.writeHead(416, { 'content-range': `bytes */${PAYLOAD.length}` })
      res.end()
      return
    }
    status = 206
    headers['content-range'] =
      `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`
    headers['content-length'] = String(PAYLOAD.length - start)
  } else {
    headers['content-length'] = String(PAYLOAD.length)
  }
  res.writeHead(status, headers)
  const slice = PAYLOAD.subarray(start)
  if (!slow) {
    res.end(slice)
    return
  }
  let offset = 0
  const timer = setInterval(() => {
    if (offset >= slice.length) {
      clearInterval(timer)
      res.end()
      return
    }
    const chunk = slice.subarray(offset, offset + SLOW_CHUNK_SIZE)
    offset += chunk.length
    res.write(chunk)
  }, SLOW_CHUNK_DELAY_MS)
  res.on('close', () => {
    clearInterval(timer)
  })
}

/** 启动本地 127.0.0.1 服务，支持 Range 与慢速路由 */
async function startServer(): Promise<TestServerHandle> {
  let ignoreRange = false
  const requests: RecordedRequest[] = []
  const server = createServer((req, res) => {
    requests.push({ path: req.url ?? '', range: req.headers.range ?? null })
    respond(req, res, ignoreRange, req.url === '/slow')
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port =
    typeof address === 'object' && address !== null ? address.port : 0
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setIgnoreRange: (value) => {
      ignoreRange = value
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  }
}

/** 构造测试资源 */
function makeResource(overrides: Partial<VideoResource> = {}): VideoResource {
  return {
    id: 'douyin:1',
    platform: 'douyin',
    nativeId: '1',
    kind: 'video',
    title: '测试视频',
    author: '测试作者',
    sourceUrl: 'https://v.douyin.com/abc',
    resolvedUrl: 'https://www.douyin.com/video/1',
    shareUrl: 'https://www.douyin.com/video/1',
    variants: [],
    images: [],
    ...overrides
  }
}

/** 构造测试档位 */
function makeVariant(
  url: string,
  overrides: Partial<VideoVariant> = {}
): VideoVariant {
  return {
    id: 'v1',
    label: '1080P 高清',
    qualityRank: 1080,
    container: 'mp4',
    url,
    ...overrides
  }
}

/** 构造绕过 CDN 白名单的下载器，其余依赖可注入 */
function createDownloader(
  options: VideoDownloaderOptions = {}
): VideoDownloader {
  return new VideoDownloader({
    allowMediaUrl: () => true,
    ...options
  })
}

/** 断言快照为失败并返回收窄后的对象 */
function expectFailed(
  snapshot: VideoDownloadSnapshot
): Extract<VideoDownloadSnapshot, { status: 'failed' }> {
  expect(snapshot.status).toBe('failed')
  if (snapshot.status !== 'failed') {
    throw new Error('预期下载失败，实际为其它状态')
  }
  return snapshot
}

describe('VideoDownloader 完整下载', () => {
  it('下载成功且文件字节与响应一致', async () => {
    const server = await startServer()
    const progress: VideoDownloadProgress[] = []
    const downloader = createDownloader()
    try {
      const snapshot = await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/video.mp4`),
        downloadDir,
        onProgress: (item) => progress.push(item)
      })

      expect(snapshot.status).toBe('completed')
      if (snapshot.status === 'completed') {
        expect(snapshot.title).toBe('测试视频')
        expect(snapshot.fileName).toBe(EXPECTED_FILE_NAME)
        expect(snapshot.filePath).toBe(join(downloadDir, EXPECTED_FILE_NAME))
        const bytes = await readFile(snapshot.filePath)
        expect(bytes.equals(PAYLOAD)).toBe(true)
      }
      // 半成品与元数据都被清理，只剩最终文件
      expect(await readdir(downloadDir)).toEqual([EXPECTED_FILE_NAME])
      const last = progress[progress.length - 1]
      expect(last?.percent).toBe(100)
      expect(last?.transferred).toBe(PAYLOAD.length)
      expect(last?.total).toBe(PAYLOAD.length)
      expect(
        progress.every((item) => item.fileName === EXPECTED_FILE_NAME)
      ).toBe(true)
      expect(downloader.getSnapshot()).toMatchObject({ status: 'completed' })
    } finally {
      await server.close()
    }
  })

  it('同名最终文件存在时追加序号不覆盖', async () => {
    const server = await startServer()
    const downloader = createDownloader()
    try {
      const variant = makeVariant(`${server.baseUrl}/video.mp4`)
      const first = await downloader.download({
        resource: makeResource(),
        variant,
        downloadDir
      })
      const second = await downloader.download({
        resource: makeResource(),
        variant,
        downloadDir
      })

      expect(first.status).toBe('completed')
      expect(second.status).toBe('completed')
      if (first.status === 'completed' && second.status === 'completed') {
        expect(first.fileName).toBe(EXPECTED_FILE_NAME)
        expect(second.fileName).toBe('测试视频-1080P 高清 (1).mp4')
        expect(second.filePath).not.toBe(first.filePath)
        expect((await readFile(second.filePath)).equals(PAYLOAD)).toBe(true)
      }
      expect((await readdir(downloadDir)).sort()).toEqual(
        [EXPECTED_FILE_NAME, '测试视频-1080P 高清 (1).mp4'].sort()
      )
    } finally {
      await server.close()
    }
  })
})

describe('VideoDownloader 取消与续传', () => {
  it('取消后保留半成品与元数据，快照可续传', async () => {
    const server = await startServer()
    const downloader = createDownloader({ progressIntervalMs: 0 })
    try {
      const snapshot = await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/slow`),
        downloadDir,
        onProgress: (item) => {
          if (item.transferred >= 20 * 1024) {
            downloader.cancel()
          }
        }
      })

      const failed = expectFailed(snapshot)
      expect(failed.reason).toBe('unknown')
      expect(failed.detail).toBe('已取消，可继续下载')
      expect(failed.resumable).toBe(true)
      const partPath = join(downloadDir, `${EXPECTED_FILE_NAME}.part`)
      const partBytes = (await stat(partPath)).size
      expect(partBytes).toBeGreaterThan(0)
      // 元数据保留，供下次续传判定
      const meta = JSON.parse(
        await readFile(`${partPath.replace(/\.part$/, '')}.meta.json`, 'utf8')
      ) as { url: string }
      expect(meta.url).toContain('/slow')
      // 最终文件尚未生成
      expect(await readdir(downloadDir)).toEqual(
        expect.arrayContaining([
          `${EXPECTED_FILE_NAME}.part`,
          `${EXPECTED_FILE_NAME}.meta.json`
        ])
      )
    } finally {
      await server.close()
    }
  })

  it('再次下载只请求增量并拼接正确', async () => {
    const server = await startServer()
    const downloader = createDownloader({ progressIntervalMs: 0 })
    try {
      const variant = makeVariant(`${server.baseUrl}/slow`)
      await downloader.download({
        resource: makeResource(),
        variant,
        downloadDir,
        onProgress: (item) => {
          if (item.transferred >= 20 * 1024) {
            downloader.cancel()
          }
        }
      })
      const partPath = join(downloadDir, `${EXPECTED_FILE_NAME}.part`)
      const partBytes = (await stat(partPath)).size
      expect(partBytes).toBeGreaterThan(0)
      const before = server.requests.length

      const snapshot = await downloader.download({
        resource: makeResource(),
        variant,
        downloadDir
      })

      expect(snapshot.status).toBe('completed')
      const resumeRequest = server.requests[before]
      expect(resumeRequest?.range).toBe(`bytes=${partBytes}-`)
      if (snapshot.status === 'completed') {
        expect((await readFile(snapshot.filePath)).equals(PAYLOAD)).toBe(true)
      }
      expect(await readdir(downloadDir)).toEqual([EXPECTED_FILE_NAME])
    } finally {
      await server.close()
    }
  })

  it('服务器忽略 Range 返回 200 时从头重写', async () => {
    const server = await startServer()
    const downloader = createDownloader({ progressIntervalMs: 0 })
    try {
      const variant = makeVariant(`${server.baseUrl}/slow`)
      await downloader.download({
        resource: makeResource(),
        variant,
        downloadDir,
        onProgress: (item) => {
          if (item.transferred >= 20 * 1024) {
            downloader.cancel()
          }
        }
      })
      const partPath = join(downloadDir, `${EXPECTED_FILE_NAME}.part`)
      expect((await stat(partPath)).size).toBeGreaterThan(0)
      server.setIgnoreRange(true)
      const before = server.requests.length

      const snapshot = await downloader.download({
        resource: makeResource(),
        variant,
        downloadDir
      })

      expect(snapshot.status).toBe('completed')
      // 仍会先尝试续传，收到 200 后从 0 重写
      expect(server.requests[before]?.range).toMatch(/^bytes=\d+-$/)
      if (snapshot.status === 'completed') {
        expect((await readFile(snapshot.filePath)).equals(PAYLOAD)).toBe(true)
      }
      expect(await readdir(downloadDir)).toEqual([EXPECTED_FILE_NAME])
    } finally {
      await server.close()
    }
  })

  it('reset 清理半成品并回到 idle', async () => {
    const server = await startServer()
    const downloader = createDownloader({ progressIntervalMs: 0 })
    try {
      await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/slow`),
        downloadDir,
        onProgress: (item) => {
          if (item.transferred >= 20 * 1024) {
            downloader.cancel()
          }
        }
      })
      expect((await readdir(downloadDir)).length).toBeGreaterThan(0)

      const snapshot = await downloader.reset()

      expect(snapshot).toEqual({ status: 'idle' })
      expect(downloader.getSnapshot()).toEqual({ status: 'idle' })
      expect(await readdir(downloadDir)).toEqual([])
    } finally {
      await server.close()
    }
  })
})

describe('VideoDownloader 白名单与错误归因', () => {
  it('默认白名单拒绝本地非 HTTPS 地址且不发请求', async () => {
    const server = await startServer()
    const downloader = new VideoDownloader()
    try {
      const snapshot = await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/video.mp4`),
        downloadDir
      })

      const failed = expectFailed(snapshot)
      expect(failed.reason).toBe('unknown')
      expect(failed.detail).toBe('媒体地址不在允许范围')
      expect(failed.resumable).toBe(false)
      expect(server.requests).toEqual([])
      expect(await readdir(downloadDir)).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('429 失败归因为 rate-limited', async () => {
    const server = await startServer()
    const downloader = createDownloader()
    try {
      const snapshot = await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/rate`),
        downloadDir
      })

      const failed = expectFailed(snapshot)
      expect(failed.reason).toBe('rate-limited')
      expect(failed.detail).toBe('HTTP 429')
      expect(failed.resumable).toBe(false)
      expect(await readdir(downloadDir)).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('404 失败归因为 expired', async () => {
    const server = await startServer()
    const downloader = createDownloader()
    try {
      const snapshot = await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/expired`),
        downloadDir
      })

      const failed = expectFailed(snapshot)
      expect(failed.reason).toBe('expired')
      expect(failed.detail).toBe('HTTP 404')
    } finally {
      await server.close()
    }
  })
})

describe('VideoDownloader DASH 合并', () => {
  it('顺序下载音频并调用合并，完成后只剩最终文件', async () => {
    const server = await startServer()
    const mergeCalls: Array<{
      ffmpegPath: string
      videoPath: string
      audioPath: string
      outputPath: string
    }> = []
    const progress: VideoDownloadProgress[] = []
    const downloader = createDownloader({
      resolveFfmpeg: async () => 'fake-ffmpeg',
      runMerge: async (args) => {
        mergeCalls.push(args)
        const video = await readFile(args.videoPath)
        const audio = await readFile(args.audioPath)
        await writeFile(args.outputPath, Buffer.concat([video, audio]))
      }
    })
    try {
      const snapshot = await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/video.mp4`, {
          container: 'm4s',
          audioUrl: `${server.baseUrl}/audio.m4s`
        }),
        downloadDir,
        onProgress: (item) => progress.push(item)
      })

      expect(snapshot.status).toBe('completed')
      if (snapshot.status === 'completed') {
        expect(snapshot.fileName).toBe(EXPECTED_FILE_NAME)
        const bytes = await readFile(snapshot.filePath)
        expect(bytes.length).toBe(PAYLOAD.length * 2)
        expect(bytes.equals(Buffer.concat([PAYLOAD, PAYLOAD]))).toBe(true)
      }
      expect(mergeCalls).toHaveLength(1)
      expect(mergeCalls[0]?.ffmpegPath).toBe('fake-ffmpeg')
      expect(mergeCalls[0]?.videoPath).toBe(
        `${join(downloadDir, EXPECTED_FILE_NAME)}.video.tmp`
      )
      expect(mergeCalls[0]?.audioPath).toBe(
        `${join(downloadDir, EXPECTED_FILE_NAME)}.audio.tmp`
      )
      expect(server.requests.map((item) => item.path)).toEqual([
        '/video.mp4',
        '/audio.m4s'
      ])
      expect(progress[progress.length - 1]?.percent).toBe(100)
      expect(await readdir(downloadDir)).toEqual([EXPECTED_FILE_NAME])
    } finally {
      await server.close()
    }
  })

  it('缺少 ffmpeg 时返回 ffmpeg-missing 并保留半成品', async () => {
    const server = await startServer()
    const downloader = createDownloader({
      resolveFfmpeg: async () => null,
      runMerge: async () => {
        throw new Error('不应调用合并')
      }
    })
    try {
      const snapshot = await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/video.mp4`, {
          container: 'm4s',
          audioUrl: `${server.baseUrl}/audio.m4s`
        }),
        downloadDir
      })

      const failed = expectFailed(snapshot)
      expect(failed.reason).toBe('ffmpeg-missing')
      expect(failed.detail).toBe('未检测到 ffmpeg')
      expect(failed.resumable).toBe(true)
      const finalPath = join(downloadDir, EXPECTED_FILE_NAME)
      expect((await stat(`${finalPath}.part`)).size).toBe(PAYLOAD.length)
      expect((await stat(`${finalPath}.audio.part`)).size).toBe(PAYLOAD.length)
      expect(downloader.getSnapshot()).toMatchObject({
        status: 'failed',
        reason: 'ffmpeg-missing',
        resumable: true
      })
    } finally {
      await server.close()
    }
  })

  it('合并失败时半成品恢复为 .part 并可续传', async () => {
    const server = await startServer()
    const downloader = createDownloader({
      resolveFfmpeg: async () => 'fake-ffmpeg',
      runMerge: async () => {
        throw new Error('merge boom')
      }
    })
    try {
      const snapshot = await downloader.download({
        resource: makeResource(),
        variant: makeVariant(`${server.baseUrl}/video.mp4`, {
          container: 'm4s',
          audioUrl: `${server.baseUrl}/audio.m4s`
        }),
        downloadDir
      })

      const failed = expectFailed(snapshot)
      expect(failed.reason).toBe('engine-failed')
      expect(failed.resumable).toBe(true)
      const finalPath = join(downloadDir, EXPECTED_FILE_NAME)
      expect((await stat(`${finalPath}.part`)).size).toBe(PAYLOAD.length)
      expect((await stat(`${finalPath}.audio.part`)).size).toBe(PAYLOAD.length)
      const files = await readdir(downloadDir)
      expect(files).not.toContain(`${EXPECTED_FILE_NAME}.video.tmp`)
      expect(files).not.toContain(`${EXPECTED_FILE_NAME}.audio.tmp`)
    } finally {
      await server.close()
    }
  })
})
