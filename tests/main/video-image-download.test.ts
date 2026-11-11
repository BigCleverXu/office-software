import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  VideoImage,
  VideoImageDownloadSnapshot,
  VideoResource
} from '../../src/shared/video'
import {
  VideoImageDownloader,
  type VideoImageDownloaderOptions
} from '../../src/main/video/image-downloader'

/** 用例创建的临时目录，afterEach 统一清理 */
const tempDirs: string[] = []
let downloadDir = ''

/** 标题经 sanitizeVideoFileName 清洗后的目录名 */
const EXPECTED_DIR_NAME = '夏日穿搭 三套look'

beforeEach(async () => {
  downloadDir = await mkdtemp(join(tmpdir(), 'video-image-download-'))
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

/** 构造图文笔记资源 */
function makeResource(
  images: string[],
  title = '夏日穿搭: 三套look'
): VideoResource {
  return {
    id: 'douyin:1',
    platform: 'douyin',
    nativeId: '1',
    kind: 'note',
    title,
    author: '测试作者',
    sourceUrl: 'https://v.douyin.com/xxxx/',
    resolvedUrl: 'https://www.douyin.com/note/1',
    shareUrl: 'https://www.douyin.com/note/1',
    variants: [],
    images: images.map((url) => ({ url }))
  }
}

/** 构造携带候选地址 / 动图字段的图文笔记资源 */
function makeImageResource(
  images: VideoImage[],
  title = '夏日穿搭: 三套look'
): VideoResource {
  return { ...makeResource([], title), images }
}

/** 构造图片响应 */
function imageResponse(
  contentType: string,
  bytes: Buffer,
  status = 200
): Response {
  const headers = new Headers()
  headers.set('content-type', contentType)
  return new Response(new Uint8Array(bytes).buffer, { status, headers })
}

/** 构造绕过 CDN 白名单、跳过重试等待的下载器 */
function createDownloader(
  options: VideoImageDownloaderOptions = {}
): VideoImageDownloader {
  return new VideoImageDownloader({
    allowMediaUrl: () => true,
    sleep: async () => undefined,
    ...options
  })
}

/** 断言快照为完成并返回收窄后的对象 */
function expectCompleted(
  snapshot: VideoImageDownloadSnapshot
): Extract<VideoImageDownloadSnapshot, { status: 'completed' }> {
  expect(snapshot.status).toBe('completed')
  if (snapshot.status !== 'completed') {
    throw new Error('预期图集下载完成，实际为其它状态')
  }
  return snapshot
}

describe('VideoImageDownloader 批量下载', () => {
  it('下载三张图片并按序号与扩展名落盘', async () => {
    const urls = [
      'https://p3.douyinpic.com/a.jpg',
      'https://p3.douyinpic.com/b.jpg',
      'https://p3.douyinpic.com/c.jpg'
    ]
    const types = ['image/jpeg', 'image/png', 'image/webp']
    const snapshots: VideoImageDownloadSnapshot[] = []
    let calls = 0
    const downloader = createDownloader({
      fetchImpl: async () => {
        const index = calls
        calls += 1
        return imageResponse(
          types[index] ?? 'image/jpeg',
          Buffer.from(`image-${String(index)}`)
        )
      },
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    const snapshot = expectCompleted(
      await downloader.download({
        resource: makeResource(urls),
        downloadDir
      })
    )

    const expectedDirectory = join(downloadDir, EXPECTED_DIR_NAME)
    expect(snapshot.title).toBe('夏日穿搭: 三套look')
    expect(snapshot.directory).toBe(expectedDirectory)
    expect(snapshot.saved).toBe(3)
    expect(snapshot.failed).toBe(0)
    expect((await readdir(expectedDirectory)).sort()).toEqual([
      '01.jpg',
      '02.png',
      '03.webp'
    ])
    // 每张开始前都会推送一次进度快照
    const first = snapshots[0]
    expect(first).toMatchObject({
      status: 'downloading',
      directory: expectedDirectory,
      progress: {
        completed: 0,
        total: 3,
        currentFileName: '01.jpg',
        percent: 0
      }
    })
    expect(downloader.getSnapshot()).toMatchObject({ status: 'completed' })
  })

  it('第 2 张首次失败后重试成功', async () => {
    let retried = 0
    const downloader = createDownloader({
      fetchImpl: async (input: RequestInfo | URL) => {
        if (String(input).endsWith('b.jpg')) {
          retried += 1
          if (retried === 1) {
            return imageResponse('text/plain', Buffer.from('boom'), 500)
          }
        }
        return imageResponse('image/jpeg', Buffer.from('ok'))
      }
    })

    const snapshot = expectCompleted(
      await downloader.download({
        resource: makeResource([
          'https://p3.douyinpic.com/a.jpg',
          'https://p3.douyinpic.com/b.jpg',
          'https://p3.douyinpic.com/c.jpg'
        ]),
        downloadDir
      })
    )

    expect(retried).toBe(2)
    expect(snapshot.saved).toBe(3)
    expect(snapshot.failed).toBe(0)
    expect(
      (await readdir(join(downloadDir, EXPECTED_DIR_NAME))).sort()
    ).toEqual(['01.jpg', '02.jpg', '03.jpg'])
  })

  it('第 2 张两次都失败时继续下载其余图片', async () => {
    const downloader = createDownloader({
      fetchImpl: async (input: RequestInfo | URL) =>
        String(input).endsWith('b.jpg')
          ? imageResponse('text/plain', Buffer.from('boom'), 500)
          : imageResponse('image/jpeg', Buffer.from('ok'))
    })

    const snapshot = expectCompleted(
      await downloader.download({
        resource: makeResource([
          'https://p3.douyinpic.com/a.jpg',
          'https://p3.douyinpic.com/b.jpg',
          'https://p3.douyinpic.com/c.jpg'
        ]),
        downloadDir
      })
    )

    expect(snapshot.saved).toBe(2)
    expect(snapshot.failed).toBe(1)
    // 失败图片不占位，序号仍然按原顺序保留
    expect(
      (await readdir(join(downloadDir, EXPECTED_DIR_NAME))).sort()
    ).toEqual(['01.jpg', '03.jpg'])
  })

  it('白名单外地址计入失败且不发起请求', async () => {
    const requested: string[] = []
    const downloader = createDownloader({
      allowMediaUrl: (_platform, url) => url.includes('douyinpic.com'),
      fetchImpl: async (input: RequestInfo | URL) => {
        requested.push(String(input))
        return imageResponse('image/jpeg', Buffer.from('ok'))
      }
    })

    const snapshot = expectCompleted(
      await downloader.download({
        resource: makeResource([
          'https://p3.douyinpic.com/a.jpg',
          'https://evil.example.com/b.jpg'
        ]),
        downloadDir
      })
    )

    expect(snapshot.saved).toBe(1)
    expect(snapshot.failed).toBe(1)
    expect(requested).toEqual(['https://p3.douyinpic.com/a.jpg'])
    expect(await readdir(join(downloadDir, EXPECTED_DIR_NAME))).toEqual([
      '01.jpg'
    ])
  })

  it('动图只请求动图地址并落盘为 01.mp4', async () => {
    const requested: string[] = []
    const snapshots: VideoImageDownloadSnapshot[] = []
    const downloader = createDownloader({
      fetchImpl: async (input: RequestInfo | URL) => {
        requested.push(String(input))
        return imageResponse('video/mp4', Buffer.from('mp4'))
      },
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    const snapshot = expectCompleted(
      await downloader.download({
        resource: makeImageResource([
          {
            url: 'https://p3.douyinpic.com/a.jpg',
            animated: {
              url: 'https://v3.douyinvod.com/a.mp4',
              width: 720,
              height: 1280,
              durationSec: 3
            }
          }
        ]),
        downloadDir
      })
    )

    expect(requested).toEqual(['https://v3.douyinvod.com/a.mp4'])
    expect(snapshot.saved).toBe(1)
    expect(snapshot.failed).toBe(0)
    expect(await readdir(join(downloadDir, EXPECTED_DIR_NAME))).toEqual([
      '01.mp4'
    ])
    // 动图预备名即最终名，不补推进度
    expect(
      snapshots
        .filter((item) => item.status === 'downloading')
        .map((item) => item.progress.currentFileName)
    ).toEqual(['01.mp4'])
  })

  it('首选地址返回 403 时回退下一个候选并按其 content-type 落盘', async () => {
    const requested: string[] = []
    const snapshots: VideoImageDownloadSnapshot[] = []
    const downloader = createDownloader({
      fetchImpl: async (input: RequestInfo | URL) => {
        const url = String(input)
        requested.push(url)
        if (url.endsWith('a.jpg')) {
          return imageResponse('text/plain', Buffer.from('no'), 403)
        }
        return imageResponse('image/png', Buffer.from('png'))
      },
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    const snapshot = expectCompleted(
      await downloader.download({
        resource: makeImageResource([
          {
            url: 'https://p3.douyinpic.com/a.jpg',
            fallbackUrls: ['https://p3.douyinpic.com/a-fallback']
          }
        ]),
        downloadDir
      })
    )

    // 首选 403 先重试一次，仍失败才换第二个候选
    expect(requested).toEqual([
      'https://p3.douyinpic.com/a.jpg',
      'https://p3.douyinpic.com/a.jpg',
      'https://p3.douyinpic.com/a-fallback'
    ])
    expect(snapshot.saved).toBe(1)
    expect(snapshot.failed).toBe(0)
    expect(await readdir(join(downloadDir, EXPECTED_DIR_NAME))).toEqual([
      '01.png'
    ])
    // 预备名按首个候选推断为 01.jpg，回退成功后补推真实文件名
    expect(
      snapshots
        .filter((item) => item.status === 'downloading')
        .map((item) => item.progress.currentFileName)
    ).toEqual(['01.jpg', '01.png'])
  })

  it('所有候选都失败时计入失败并继续下载其余图片', async () => {
    const downloader = createDownloader({
      fetchImpl: async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('bad')) {
          return imageResponse('text/plain', Buffer.from('boom'), 404)
        }
        return imageResponse('image/jpeg', Buffer.from('ok'))
      }
    })

    const snapshot = expectCompleted(
      await downloader.download({
        resource: makeImageResource([
          {
            url: 'https://p3.douyinpic.com/bad.jpg',
            fallbackUrls: ['https://p3.douyinpic.com/bad-fallback.jpg']
          },
          { url: 'https://p3.douyinpic.com/good.jpg' }
        ]),
        downloadDir
      })
    )

    expect(snapshot.saved).toBe(1)
    expect(snapshot.failed).toBe(1)
    expect(await readdir(join(downloadDir, EXPECTED_DIR_NAME))).toEqual([
      '02.jpg'
    ])
  })

  it('动图与静态图混排时分别落盘为 01.mp4 与 02.jpg', async () => {
    const downloader = createDownloader({
      fetchImpl: async (input: RequestInfo | URL) =>
        String(input).endsWith('.mp4')
          ? imageResponse('video/mp4', Buffer.from('mp4'))
          : imageResponse('image/jpeg', Buffer.from('jpg'))
    })

    const snapshot = expectCompleted(
      await downloader.download({
        resource: makeImageResource([
          {
            url: 'https://p3.douyinpic.com/a.jpg',
            animated: { url: 'https://v3.douyinvod.com/a.mp4' }
          },
          { url: 'https://p3.douyinpic.com/b.jpg' }
        ]),
        downloadDir
      })
    )

    expect(snapshot.saved).toBe(2)
    expect(snapshot.failed).toBe(0)
    expect(
      (await readdir(join(downloadDir, EXPECTED_DIR_NAME))).sort()
    ).toEqual(['01.mp4', '02.jpg'])
  })
})

describe('VideoImageDownloader 并发与取消', () => {
  it('进行中再次调用返回忙碌失败', async () => {
    const downloader = createDownloader({
      fetchImpl: async () => imageResponse('image/jpeg', Buffer.from('ok'))
    })
    const resource = makeResource(['https://p3.douyinpic.com/a.jpg'])

    // download 在首个 await 前同步置位 running
    const first = downloader.download({ resource, downloadDir })
    const second = await downloader.download({ resource, downloadDir })

    expect(second).toMatchObject({
      status: 'failed',
      reason: 'busy',
      detail: '正在下载图片，请稍后再试'
    })
    expect((await first).status).toBe('completed')
  })

  it('取消后停止后续图片并保留已写入文件', async () => {
    let calls = 0
    const downloader = createDownloader({
      fetchImpl: async (input: RequestInfo | URL) => {
        if (String(input).endsWith('b.jpg')) {
          downloader.cancel()
          throw new Error('aborted')
        }
        calls += 1
        return imageResponse('image/jpeg', Buffer.from('ok'))
      }
    })

    const snapshot = await downloader.download({
      resource: makeResource([
        'https://p3.douyinpic.com/a.jpg',
        'https://p3.douyinpic.com/b.jpg',
        'https://p3.douyinpic.com/c.jpg'
      ]),
      downloadDir
    })

    expect(snapshot).toMatchObject({
      status: 'failed',
      reason: 'unknown',
      detail: '已取消'
    })
    expect(calls).toBe(1)
    expect(await readdir(join(downloadDir, EXPECTED_DIR_NAME))).toEqual([
      '01.jpg'
    ])
  })
})
