import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  VideoEngineProbe,
  VideoTranscriptSnapshot
} from '../../src/shared/video'
import { closeDatabase, openDatabase } from '../../src/main/database'
import { VideoEngineSettingsStore } from '../../src/main/video/engine-settings'
import {
  VideoTranscriptService,
  type TranscriptServiceDeps
} from '../../src/main/video/transcript-service'

/** 测试工作目录，afterEach 统一清理 */
const tempRoots: string[] = []

let db: DatabaseSync
let store: VideoEngineSettingsStore
let rootDir = ''
let videoDir = ''
let videoPath = ''

/** 视频原始字节，用于确认提取过程不改动原文件 */
const VIDEO_BYTES = 'fake-video-bytes'

/** 完整可用的探测结果 */
const OK_PROBE: VideoEngineProbe = {
  ok: true,
  binary: 'C:\\whisper\\whisper-cli.exe',
  model: 'C:\\whisper\\ggml-base.bin',
  ffmpeg: 'C:\\ffmpeg\\ffmpeg.exe',
  message: '本地引擎就绪'
}

beforeEach(async () => {
  db = openDatabase({ path: ':memory:' })
  store = new VideoEngineSettingsStore(db)
  rootDir = await mkdtemp(join(tmpdir(), 'video-transcript-'))
  tempRoots.push(rootDir)
  videoDir = join(rootDir, 'videos')
  await mkdir(videoDir, { recursive: true })
  videoPath = join(videoDir, 'demo.mp4')
  await writeFile(videoPath, VIDEO_BYTES, 'utf8')
})

afterEach(async () => {
  closeDatabase(db)
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop()
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

/** 合并默认假依赖与用例覆盖项 */
function makeDeps(
  overrides: Partial<TranscriptServiceDeps>
): TranscriptServiceDeps {
  const base: TranscriptServiceDeps = {
    probeEngine: async () => ({ ...OK_PROBE }),
    extractAudio: async () => {},
    runWhisper: async ({ outputBase }) => {
      await writeFile(`${outputBase}.txt`, '你好世界', 'utf8')
    },
    readTextFile: (path) => readFile(path, 'utf8'),
    makeTempDir: () => mkdtemp(join(tmpdir(), 'video-transcript-run-')),
    removeDir: (path) => rm(path, { recursive: true, force: true }),
    now: Date.now
  }
  return Object.assign(base, overrides)
}

/** 收集阶段序列：running 取 stage，终态取 status */
function stageOf(snapshot: VideoTranscriptSnapshot): string {
  return snapshot.status === 'running' ? snapshot.stage : snapshot.status
}

describe('VideoTranscriptService 引擎缺失', () => {
  it('缺少 whisper 可执行文件时返回 engine-missing', async () => {
    let extracted = false
    const service = new VideoTranscriptService({
      store,
      deps: makeDeps({
        probeEngine: async () => ({
          ...OK_PROBE,
          ok: false,
          binary: null,
          message: '未检测到：whisper 可执行文件'
        }),
        extractAudio: async () => {
          extracted = true
        }
      })
    })

    const result = await service.start({ filePath: videoPath })
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'engine-missing',
      detail: '未检测到：whisper 可执行文件'
    })
    expect(extracted).toBe(false)
  })

  it('缺少识别模型时也返回 engine-missing', async () => {
    const service = new VideoTranscriptService({
      store,
      deps: makeDeps({
        probeEngine: async () => ({ ...OK_PROBE, ok: false, model: null })
      })
    })

    const result = await service.start({ filePath: videoPath })
    expect(result).toMatchObject({ status: 'failed', reason: 'engine-missing' })
  })

  it('缺少 ffmpeg 时返回 ffmpeg-missing 且不抽轨', async () => {
    let extracted = false
    const service = new VideoTranscriptService({
      store,
      deps: makeDeps({
        probeEngine: async () => ({
          ...OK_PROBE,
          ok: false,
          ffmpeg: null,
          message: '未检测到：ffmpeg'
        }),
        extractAudio: async () => {
          extracted = true
        }
      })
    })

    const result = await service.start({ filePath: videoPath })
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'ffmpeg-missing',
      detail: '未检测到：ffmpeg'
    })
    expect(extracted).toBe(false)
  })
})

describe('VideoTranscriptService 成功流程', () => {
  it('按 extracting → recognizing → completed 流转并清理临时目录', async () => {
    const snapshots: VideoTranscriptSnapshot[] = []
    const tempDirs: string[] = []
    const extractArgs: Array<{
      ffmpegPath: string
      inputPath: string
      wavPath: string
    }> = []
    const whisperArgs: Array<{ language: string; binaryPath: string }> = []
    let clock = 1000
    const service = new VideoTranscriptService({
      store,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      getDownloadDir: () => videoDir,
      deps: makeDeps({
        extractAudio: async (ffmpegPath, inputPath, wavPath, signal) => {
          extractArgs.push({ ffmpegPath, inputPath, wavPath })
          expect(signal.aborted).toBe(false)
          await writeFile(wavPath, 'fake-wav', 'utf8')
        },
        runWhisper: async (args) => {
          whisperArgs.push({
            language: args.language,
            binaryPath: args.binaryPath
          })
          expect(args.modelPath).toBe(OK_PROBE.model)
          await writeFile(
            `${args.outputBase}.txt`,
            '[00:00:00.000 --> 00:00:01.000]\n你好世界\n[00:00:01.000 --> 00:00:02.000]',
            'utf8'
          )
        },
        makeTempDir: async () => {
          const dir = await mkdtemp(join(tmpdir(), 'video-transcript-run-'))
          tempDirs.push(dir)
          return dir
        },
        now: () => {
          clock += 1
          return clock
        }
      })
    })

    const result = await service.start({ filePath: videoPath })

    expect(snapshots.map(stageOf)).toEqual([
      'extracting',
      'recognizing',
      'completed'
    ])
    expect(result).toMatchObject({
      status: 'completed',
      text: '你好世界',
      fileName: 'demo.mp4',
      engine: 'whisper-cli.exe'
    })
    expect(
      result.status === 'completed' ? result.elapsedMs : 0
    ).toBeGreaterThan(0)
    expect(service.getSnapshot()).toEqual(snapshots[snapshots.length - 1])
    expect(extractArgs).toEqual([
      {
        ffmpegPath: OK_PROBE.ffmpeg,
        inputPath: videoPath,
        wavPath: join(tempDirs[0] ?? '', 'audio.wav')
      }
    ])
    expect(whisperArgs).toEqual([
      { language: 'zh', binaryPath: OK_PROBE.binary }
    ])
    expect(tempDirs).toHaveLength(1)
    expect(existsSync(tempDirs[0] ?? '')).toBe(false)
    expect(await readFile(videoPath, 'utf8')).toBe(VIDEO_BYTES)
  })

  it('getSnapshot 与 onSnapshot 推送一致', async () => {
    const pushed: VideoTranscriptSnapshot[] = []
    let duringExtract: VideoTranscriptSnapshot = { status: 'idle' }
    let duringWhisper: VideoTranscriptSnapshot = { status: 'idle' }
    const service = new VideoTranscriptService({
      store,
      onSnapshot: (snapshot) => pushed.push(snapshot),
      deps: makeDeps({
        extractAudio: async () => {
          duringExtract = service.getSnapshot()
        },
        runWhisper: async ({ outputBase }) => {
          duringWhisper = service.getSnapshot()
          await writeFile(`${outputBase}.txt`, '完成文本', 'utf8')
        }
      })
    })

    const result = await service.start({ filePath: videoPath })
    expect(pushed.map(stageOf)).toEqual([
      'extracting',
      'recognizing',
      'completed'
    ])
    expect(duringExtract).toEqual(pushed[0])
    expect(duringWhisper).toEqual(pushed[1])
    expect(service.getSnapshot()).toEqual(pushed[2])
    expect(pushed[2]).toEqual(result)
  })
})

describe('VideoTranscriptService 失败与取消', () => {
  it('whisper 非 0 退出时返回 engine-failed 并清理临时目录', async () => {
    const tempDirs: string[] = []
    const service = new VideoTranscriptService({
      store,
      deps: makeDeps({
        runWhisper: async () => {
          throw new Error(`whisper 退出码 1：${'错误日志'.repeat(60)}`)
        },
        makeTempDir: async () => {
          const dir = await mkdtemp(join(tmpdir(), 'video-transcript-run-'))
          tempDirs.push(dir)
          return dir
        }
      })
    })

    const result = await service.start({ filePath: videoPath })
    expect(result).toMatchObject({ status: 'failed', reason: 'engine-failed' })
    const detail = result.status === 'failed' ? (result.detail ?? '') : ''
    expect(detail).toContain('退出码 1')
    expect(Array.from(detail).length).toBeLessThanOrEqual(160)
    expect(tempDirs).toHaveLength(1)
    expect(existsSync(tempDirs[0] ?? '')).toBe(false)
  })

  it('抽取音轨失败时返回 engine-failed 且清理临时目录', async () => {
    const tempDirs: string[] = []
    const service = new VideoTranscriptService({
      store,
      deps: makeDeps({
        extractAudio: async () => {
          throw new Error('ffmpeg 退出码 1')
        },
        makeTempDir: async () => {
          const dir = await mkdtemp(join(tmpdir(), 'video-transcript-run-'))
          tempDirs.push(dir)
          return dir
        }
      })
    })

    const result = await service.start({ filePath: videoPath })
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'engine-failed',
      detail: '音轨抽取失败'
    })
    expect(existsSync(tempDirs[0] ?? '')).toBe(false)
  })

  it('请求文件位于下载目录外时拒绝处理', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'video-outside-'))
    tempRoots.push(outsideDir)
    const outsidePath = join(outsideDir, 'other.mp4')
    await writeFile(outsidePath, 'outside', 'utf8')
    let probed = false
    const service = new VideoTranscriptService({
      store,
      getDownloadDir: () => videoDir,
      deps: makeDeps({
        probeEngine: async () => {
          probed = true
          return { ...OK_PROBE }
        }
      })
    })

    const result = await service.start({ filePath: outsidePath })
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'unknown',
      detail: '文件路径不在下载目录内'
    })
    expect(probed).toBe(false)
  })

  it('取消任务时返回 failed 且 detail 为已取消', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    let entered: () => void = () => {}
    const enteredPromise = new Promise<void>((resolveEntered) => {
      entered = resolveEntered
    })
    const service = new VideoTranscriptService({
      store,
      deps: makeDeps({
        runWhisper: async () => {
          entered()
          await gate
        }
      })
    })

    const task = service.start({ filePath: videoPath })
    await enteredPromise
    service.cancel()
    release()
    const result = await task
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'unknown',
      detail: '已取消'
    })
  })

  it('同一时刻只允许一个任务，重复发起返回 busy', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    let entered: () => void = () => {}
    const enteredPromise = new Promise<void>((resolveEntered) => {
      entered = resolveEntered
    })
    const service = new VideoTranscriptService({
      store,
      deps: makeDeps({
        runWhisper: async ({ outputBase }) => {
          entered()
          await gate
          await writeFile(`${outputBase}.txt`, '并发任务', 'utf8')
        }
      })
    })

    const first = service.start({ filePath: videoPath })
    await enteredPromise
    expect(service.getSnapshot()).toMatchObject({
      status: 'running',
      stage: 'recognizing'
    })
    const second = await service.start({ filePath: videoPath })
    expect(second).toMatchObject({ status: 'failed', reason: 'busy' })
    release()
    const firstResult = await first
    expect(firstResult).toMatchObject({
      status: 'completed',
      text: '并发任务'
    })
    expect(service.getSnapshot()).toEqual(firstResult)
  })

  it('请求参数不合法时返回 failed', async () => {
    const service = new VideoTranscriptService({ store, deps: makeDeps({}) })
    expect(await service.start(null)).toMatchObject({
      status: 'failed',
      reason: 'unknown'
    })
    expect(await service.start({ filePath: 'relative.mp4' })).toMatchObject({
      status: 'failed',
      reason: 'unknown'
    })
    const missingPath = join(videoDir, 'missing.mp4')
    expect(await service.start({ filePath: missingPath })).toMatchObject({
      status: 'failed',
      reason: 'unknown',
      detail: '视频文件不存在或不可读'
    })
  })
})
