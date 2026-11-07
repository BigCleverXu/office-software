// 短视频模块下载器：CDN 白名单、断点续传、进度节流、取消保留半成品与 DASH 合并
// 仅主进程使用；所有失败以快照返回，不向调用方抛出异常
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  decideResume,
  isAllowedMediaUrl,
  percentOf,
  sanitizeVideoFileName,
  type VideoDownloadProgress,
  type VideoDownloadSnapshot,
  type VideoErrorReason,
  type VideoPlatform,
  type VideoResource,
  type VideoVariant
} from '../../shared/video'

/** 默认进度回调最小间隔（毫秒） */
const DEFAULT_PROGRESS_INTERVAL_MS = 200

/** 下载请求使用的桌面浏览器 UA，部分平台 CDN 会校验 UA */
const DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

/** 各平台 CDN 防盗链要求的 Referer */
const DOWNLOAD_REFERER: Record<VideoPlatform, string> = {
  douyin: 'https://www.douyin.com/',
  kuaishou: 'https://www.kuaishou.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  bilibili: 'https://www.bilibili.com/'
}

/** 诊断详情最大长度，避免异常信息刷屏 */
const MAX_DETAIL_LENGTH = 160

/** 同名文件去重的最大尝试次数 */
const MAX_NAME_ATTEMPTS = 100

/** 取消时的固定提示文案 */
const CANCEL_DETAIL = '已取消，可继续下载'

/** node:stream/web 的 ReadableStream 类型，用于收窄 DOM 同名类型 */
type NodeWebReadableStream = import('node:stream/web').ReadableStream

/** 半成品元数据，写入 <finalPath>.meta.json */
interface VideoDownloadMeta {
  url: string
  totalBytes: number
  etag?: string
  lastModified?: string
  updatedAt: string
}

/** 单个任务的目标路径集合 */
interface DownloadTarget {
  title: string
  fileName: string
  finalPath: string
  partPath: string
  metaPath: string
  audioPartPath: string
  audioMetaPath: string
}

/** 进度阶段：总体百分比区间 */
interface ProgressStage {
  from: number
  to: number
}

/** 单个流的进度上报器 */
interface StreamReporter {
  report: (transferred: number, total: number, force?: boolean) => void
  finish: (transferred: number, total: number) => void
}

/** 内部失败信号：仅在下载器内部抛出，最终统一转换为快照 */
class VideoDownloadFailure extends Error {
  readonly reason: VideoErrorReason
  readonly detail: string | undefined
  readonly resumable: boolean
  readonly cancelled: boolean

  constructor(
    reason: VideoErrorReason,
    detail: string | undefined,
    resumable: boolean,
    cancelled = false
  ) {
    super(detail ?? reason)
    this.name = 'VideoDownloadFailure'
    this.reason = reason
    this.detail = detail
    this.resumable = resumable
    this.cancelled = cancelled
  }
}

/** 合并函数的入参 */
export interface VideoMergeArgs {
  ffmpegPath: string
  videoPath: string
  audioPath: string
  outputPath: string
}

/** 下载器可注入依赖 */
export interface VideoDownloaderOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  progressIntervalMs?: number
  resolveFfmpeg?: () => Promise<string | null>
  runMerge?: (args: VideoMergeArgs) => Promise<void>
  /** 媒体地址白名单；默认使用共享契约的 isAllowedMediaUrl */
  allowMediaUrl?: (platform: VideoPlatform, url: string) => boolean
  /** 快照回调，用于主进程推送状态 */
  onSnapshot?: (snapshot: VideoDownloadSnapshot) => void
}

/** 单次下载入参 */
export interface VideoDownloadTaskOptions {
  resource: VideoResource
  variant: VideoVariant
  downloadDir: string
  /** 为 true 时清理半成品并从头下载 */
  reset?: boolean
  onProgress?: (progress: VideoDownloadProgress) => void
}

/** 截断并脱敏诊断文本：遮蔽 Cookie / Token 类参数，压缩空白并限长 */
function safeDetail(value: unknown): string | undefined {
  let raw = ''
  if (typeof value === 'string') {
    raw = value
  } else if (value instanceof Error) {
    const code = (value as NodeJS.ErrnoException).code
    raw =
      typeof code === 'string' && code !== ''
        ? `${code} ${value.message}`
        : value.message
  }
  const cleaned = raw
    .replace(
      /(cookie|authorization|token|signature|w_rid|x-amz-signature|sign)=([^\s;&]+)/gi,
      '$1=***'
    )
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? undefined : cleaned.slice(0, MAX_DETAIL_LENGTH)
}

/** HTTP 状态码对应的失败原因 */
function reasonOfStatus(status: number): VideoErrorReason {
  if (status === 401 || status === 403) {
    return 'signature-failed'
  }
  if (status === 404 || status === 410) {
    return 'expired'
  }
  if (status === 429) {
    return 'rate-limited'
  }
  return 'network'
}

/** 档位声明的字节大小，缺失或非法返回 0 */
function declaredSizeOf(variant: VideoVariant): number {
  const size = variant.size
  return typeof size === 'number' && Number.isFinite(size) && size > 0
    ? size
    : 0
}

/** 容器格式对应的落盘扩展名 */
function extensionOf(container: VideoVariant['container']): string {
  return container === 'flv' ? 'flv' : 'mp4'
}

/** 文件是否存在，任何异常按不存在处理 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 读取文件大小，缺失或异常返回 0 */
async function sizeOf(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

/** 删除文件，忽略不存在等异常 */
async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  } catch {
    // 清理失败不影响结果
  }
}

/** 丢弃未读取的响应体，避免连接悬挂 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // 忽略取消失败
  }
}

/** 解析 content-length：缺失或非法返回 0 */
function parseContentLength(header: string | null): number {
  if (header === null) {
    return 0
  }
  const trimmed = header.trim()
  if (!/^\d+$/.test(trimmed)) {
    return 0
  }
  const value = Number(trimmed)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 解析 Content-Range 起始字节，非法返回 null */
function parseContentRangeStart(header: string | null): number | null {
  if (header === null) {
    return null
  }
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim())
  if (match === null) {
    return null
  }
  const start = Number(match[1])
  return Number.isFinite(start) ? start : null
}

/** 读取半成品元数据，非法内容返回 null */
async function readMeta(path: string): Promise<VideoDownloadMeta | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return null
    }
    const record = parsed as Record<string, unknown>
    if (typeof record.url !== 'string' || record.url.trim() === '') {
      return null
    }
    const totalRaw = record.totalBytes
    const totalBytes =
      typeof totalRaw === 'number' && Number.isFinite(totalRaw)
        ? Math.max(0, totalRaw)
        : 0
    const meta: VideoDownloadMeta = {
      url: record.url,
      totalBytes,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
    }
    if (typeof record.etag === 'string') {
      meta.etag = record.etag
    }
    if (typeof record.lastModified === 'string') {
      meta.lastModified = record.lastModified
    }
    return meta
  } catch {
    return null
  }
}

/** 写入半成品元数据 */
async function writeMeta(path: string, meta: VideoDownloadMeta): Promise<void> {
  await writeFile(path, JSON.stringify(meta), 'utf8')
}

/**
 * 创建节流进度上报器：首次与 force 上报不受间隔限制，
 * 速度按最近采样窗口估算，总大小未知时剩余时间为 null。
 */
function createReporter(
  fileName: string,
  stage: ProgressStage,
  onProgress: ((progress: VideoDownloadProgress) => void) | undefined,
  now: () => number,
  intervalMs: number
): StreamReporter {
  const samples: Array<{ at: number; bytes: number }> = []
  let emitted = false
  let lastEmittedAt = 0

  /** 估算当前速度（字节/秒），窗口内无有效时间差时返回 0 */
  const speedOf = (transferred: number, at: number): number => {
    samples.push({ at, bytes: transferred })
    while (samples.length > 8) {
      samples.shift()
    }
    const cutoff = at - 2000
    while (
      samples.length > 2 &&
      samples[0] !== undefined &&
      samples[0].at < cutoff
    ) {
      samples.shift()
    }
    const first = samples[0]
    if (first === undefined) {
      return 0
    }
    const elapsed = at - first.at
    if (elapsed <= 0) {
      return 0
    }
    const speed = ((transferred - first.bytes) / elapsed) * 1000
    return Number.isFinite(speed) && speed > 0 ? Math.round(speed) : 0
  }

  const emit = (transferred: number, total: number, percent: number): void => {
    if (onProgress === undefined) {
      return
    }
    try {
      const at = now()
      const speed = speedOf(transferred, at)
      let remainingMs: number | null = null
      if (total > 0) {
        remainingMs =
          transferred >= total
            ? 0
            : speed > 0
              ? Math.max(0, Math.round(((total - transferred) / speed) * 1000))
              : null
      }
      onProgress({
        fileName,
        transferred,
        total,
        percent,
        speedBytesPerSec: speed,
        remainingMs
      })
    } catch {
      // 进度回调异常不影响下载结果
    }
  }

  return {
    report: (transferred, total, force = false) => {
      if (onProgress === undefined) {
        return
      }
      const at = now()
      if (!force && emitted && at - lastEmittedAt < intervalMs) {
        return
      }
      emitted = true
      lastEmittedAt = at
      const ratio = percentOf(transferred, total) / 100
      const percent = Math.min(
        stage.to,
        Math.max(
          stage.from,
          stage.from + Math.round((stage.to - stage.from) * ratio)
        )
      )
      emit(transferred, total, percent)
    },
    finish: (transferred, total) => {
      if (onProgress === undefined) {
        return
      }
      emit(transferred, total, stage.to)
    }
  }
}

/** 默认 ffmpeg 探测：优先读取环境变量，Task 8 会接入更完整的路径解析 */
async function defaultResolveFfmpeg(): Promise<string | null> {
  const candidate = process.env.FFMPEG_PATH?.trim() ?? ''
  return candidate === '' ? null : candidate
}

/** 默认合并实现：调用 ffmpeg 无损合并音视频 */
async function defaultRunMerge(args: VideoMergeArgs): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = ''
    const child = spawn(
      args.ffmpegPath,
      [
        '-y',
        '-i',
        args.videoPath,
        '-i',
        args.audioPath,
        '-c',
        'copy',
        args.outputPath
      ],
      { windowsHide: true }
    )
    child.stderr?.on('data', (chunk: unknown) => {
      stderr = `${stderr}${String(chunk)}`.slice(-400)
    })
    child.on('error', (error: Error) => {
      reject(error)
    })
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          stderr.trim() === ''
            ? `ffmpeg 退出码 ${String(code)}`
            : `ffmpeg 退出码 ${String(code)}：${stderr.trim()}`
        )
      )
    })
  })
}

/**
 * 短视频下载器：同一时刻只允许一个任务。
 *
 * 先写 <finalPath>.part 与 <finalPath>.meta.json，成功后 rename 为最终文件；
 * 取消与网络类失败保留半成品以便续传，显式 reset 才清理。
 */
export class VideoDownloader {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly progressIntervalMs: number
  private readonly resolveFfmpeg: () => Promise<string | null>
  private readonly runMerge: (args: VideoMergeArgs) => Promise<void>
  private readonly allowMediaUrl: (
    platform: VideoPlatform,
    url: string
  ) => boolean
  private readonly onSnapshot:
    ((snapshot: VideoDownloadSnapshot) => void) | undefined
  private controller: AbortController | null = null
  private running = false
  private activeTask: Promise<VideoDownloadSnapshot> | null = null
  private target: DownloadTarget | null = null
  /** 进行中任务的标题、文件名与最新进度 */
  private current: {
    title: string
    fileName: string
    progress: VideoDownloadProgress
  } | null = null
  /** 最近一次快照 */
  private last: VideoDownloadSnapshot = { status: 'idle' }

  constructor(options: VideoDownloaderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.progressIntervalMs = Math.max(
      0,
      options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS
    )
    this.resolveFfmpeg = options.resolveFfmpeg ?? defaultResolveFfmpeg
    this.runMerge = options.runMerge ?? defaultRunMerge
    this.allowMediaUrl = options.allowMediaUrl ?? isAllowedMediaUrl
    this.onSnapshot = options.onSnapshot
  }

  /** 是否有任务在进行 */
  get downloading(): boolean {
    return this.running
  }

  /** 当前快照：进行中优先，否则返回最近结果 */
  getSnapshot(): VideoDownloadSnapshot {
    const current = this.current
    if (current !== null) {
      return {
        status: 'downloading',
        title: current.title,
        fileName: current.fileName,
        progress: { ...current.progress }
      }
    }
    return this.last
  }

  /** 取消当前任务：保留 .part 与 .meta.json，区分于失败清理 */
  cancel(): void {
    this.controller?.abort()
  }

  /**
   * 清理当前目标的半成品、元数据与音频半成品并回到 idle。
   * 若有任务在进行，先取消并等待其收尾，避免删除仍被写入的文件。
   */
  async reset(): Promise<VideoDownloadSnapshot> {
    const task = this.activeTask
    if (task !== null) {
      this.controller?.abort()
      try {
        await task
      } catch {
        // 任务内部已收敛为快照，这里只需等待收尾
      }
    }
    const target = this.target
    if (target !== null) {
      await Promise.all([
        removeQuietly(target.partPath),
        removeQuietly(target.metaPath),
        removeQuietly(target.audioPartPath),
        removeQuietly(target.audioMetaPath)
      ])
    }
    this.current = null
    const idle: VideoDownloadSnapshot = { status: 'idle' }
    this.publish(idle)
    return idle
  }

  /** 发起下载；任何异常都收敛为失败快照 */
  async download(
    options: VideoDownloadTaskOptions
  ): Promise<VideoDownloadSnapshot> {
    if (this.running) {
      return {
        status: 'failed',
        title: options.resource.title,
        reason: 'busy',
        detail: '当前有任务正在进行，请稍后再试',
        resumable: false
      }
    }
    this.running = true
    const task = this.runDownload(options)
    this.activeTask = task
    try {
      return await task
    } catch (error) {
      // runDownload 内部已捕获全部异常，此处仅作兜底
      return this.publishFailure(
        options.resource.title,
        'unknown',
        safeDetail(error),
        false
      )
    } finally {
      if (this.activeTask === task) {
        this.activeTask = null
      }
      this.running = false
    }
  }

  /** 执行一次完整下载流程 */
  private async runDownload(
    options: VideoDownloadTaskOptions
  ): Promise<VideoDownloadSnapshot> {
    const { resource, variant, downloadDir, reset } = options
    const controller = new AbortController()
    this.controller = controller
    const title = resource.title
    try {
      if (
        !this.allowMediaUrl(resource.platform, variant.url) ||
        (variant.audioUrl !== undefined &&
          !this.allowMediaUrl(resource.platform, variant.audioUrl))
      ) {
        return this.publishFailure(
          title,
          'unknown',
          '媒体地址不在允许范围',
          false
        )
      }
      try {
        await mkdir(downloadDir, { recursive: true })
      } catch (error) {
        return this.publishFailure(title, 'write', safeDetail(error), false)
      }
      const target = await this.buildTarget(resource, variant, downloadDir)
      this.target = target
      const progress: VideoDownloadProgress = {
        fileName: target.fileName,
        transferred: 0,
        total: declaredSizeOf(variant),
        percent: 0,
        speedBytesPerSec: 0,
        remainingMs: null
      }
      this.current = { title, fileName: target.fileName, progress }
      this.publish({
        status: 'downloading',
        title,
        fileName: target.fileName,
        progress: { ...progress }
      })
      try {
        // 首次进度立即上报，不受节流间隔限制
        options.onProgress?.(progress)
      } catch {
        // 进度回调异常不影响下载结果
      }

      const progressSink = (item: VideoDownloadProgress): void => {
        if (this.current !== null) {
          this.current.progress = { ...item }
          // 进度已节流，这里同步推送 downloading 快照
          this.publish({
            status: 'downloading',
            title,
            fileName: target.fileName,
            progress: { ...item }
          })
        }
        try {
          options.onProgress?.(item)
        } catch {
          // 进度回调异常不影响下载结果
        }
      }

      if (variant.audioUrl !== undefined && variant.audioUrl !== '') {
        return await this.runDashDownload({
          resource,
          variant,
          target,
          controller,
          progressSink,
          reset: reset === true
        })
      }

      const reporter = createReporter(
        target.fileName,
        { from: 0, to: 100 },
        progressSink,
        this.now,
        this.progressIntervalMs
      )
      const streamed = await this.runStream({
        url: variant.url,
        platform: resource.platform,
        partPath: target.partPath,
        metaPath: target.metaPath,
        totalFallback: declaredSizeOf(variant),
        reset: reset === true,
        controller,
        reporter
      })
      try {
        await rm(target.finalPath, { force: true })
        await rename(target.partPath, target.finalPath)
      } catch (error) {
        throw new VideoDownloadFailure('write', safeDetail(error), false)
      }
      await removeQuietly(target.metaPath)
      reporter.finish(streamed.transferred, streamed.total)
      this.current = null
      return this.publishCompletion(title, target.fileName, target.finalPath)
    } catch (error) {
      if (error instanceof VideoDownloadFailure) {
        const resumable =
          error.resumable && (await this.hasPartial(this.target))
        if (error.cancelled) {
          return this.publishFailure(title, 'unknown', CANCEL_DETAIL, resumable)
        }
        return this.publishFailure(title, error.reason, error.detail, resumable)
      }
      return this.publishFailure(
        title,
        'unknown',
        safeDetail(error),
        await this.hasPartial(this.target)
      )
    } finally {
      if (this.target !== null) {
        this.current = null
      }
      if (this.controller === controller) {
        this.controller = null
      }
    }
  }

  /** DASH：先视频 0-90%，再音频 90-95%，最后合并 95-100% */
  private async runDashDownload(args: {
    resource: VideoResource
    variant: VideoVariant
    target: DownloadTarget
    controller: AbortController
    progressSink: (progress: VideoDownloadProgress) => void
    reset: boolean
  }): Promise<VideoDownloadSnapshot> {
    const { resource, variant, target, controller, progressSink, reset } = args
    const audioUrl = variant.audioUrl ?? ''

    const videoReporter = createReporter(
      target.fileName,
      { from: 0, to: 90 },
      progressSink,
      this.now,
      this.progressIntervalMs
    )
    const video = await this.runStream({
      url: variant.url,
      platform: resource.platform,
      partPath: target.partPath,
      metaPath: target.metaPath,
      totalFallback: declaredSizeOf(variant),
      reset,
      controller,
      reporter: videoReporter
    })
    videoReporter.finish(video.transferred, video.total)

    const audioReporter = createReporter(
      target.fileName,
      { from: 90, to: 95 },
      progressSink,
      this.now,
      this.progressIntervalMs
    )
    const audio = await this.runStream({
      url: audioUrl,
      platform: resource.platform,
      partPath: target.audioPartPath,
      metaPath: target.audioMetaPath,
      totalFallback: 0,
      reset,
      controller,
      reporter: audioReporter
    })
    audioReporter.finish(audio.transferred, audio.total)

    await this.mergeStreams(target, progressSink, controller)
    this.current = null
    return this.publishCompletion(
      resource.title,
      target.fileName,
      target.finalPath
    )
  }

  /** 合并 DASH 音视频；缺少 ffmpeg 或合并失败均保留半成品 */
  private async mergeStreams(
    target: DownloadTarget,
    progressSink: (progress: VideoDownloadProgress) => void,
    controller: AbortController
  ): Promise<void> {
    if (controller.signal.aborted) {
      throw new VideoDownloadFailure('unknown', CANCEL_DETAIL, true, true)
    }
    let ffmpegPath: string | null = null
    try {
      ffmpegPath = await this.resolveFfmpeg()
    } catch {
      ffmpegPath = null
    }
    if (ffmpegPath === null || ffmpegPath.trim() === '') {
      throw new VideoDownloadFailure('ffmpeg-missing', '未检测到 ffmpeg', true)
    }
    const mergeTarget = `${target.finalPath}.merge.tmp.mp4`
    const videoTemp = `${target.finalPath}.video.tmp`
    const audioTemp = `${target.finalPath}.audio.tmp`
    const videoBytes = await sizeOf(target.partPath)
    const audioBytes = await sizeOf(target.audioPartPath)
    const total = videoBytes + audioBytes
    this.emitProgress(progressSink, target.fileName, videoBytes, total, 95)
    try {
      await rename(target.partPath, videoTemp)
      await rename(target.audioPartPath, audioTemp)
    } catch (error) {
      await removeQuietly(videoTemp)
      throw new VideoDownloadFailure('write', safeDetail(error), true)
    }
    try {
      await this.runMerge({
        ffmpegPath,
        videoPath: videoTemp,
        audioPath: audioTemp,
        outputPath: mergeTarget
      })
    } catch (error) {
      // 恢复半成品，便于下次继续尝试合并
      try {
        await rename(videoTemp, target.partPath)
      } catch {
        // 恢复失败只影响续传，不改变失败归因
      }
      try {
        await rename(audioTemp, target.audioPartPath)
      } catch {
        // 同上
      }
      await removeQuietly(mergeTarget)
      throw new VideoDownloadFailure(
        'engine-failed',
        safeDetail(error) ?? 'ffmpeg 合并失败',
        true
      )
    }
    try {
      await rm(target.finalPath, { force: true })
      await rename(mergeTarget, target.finalPath)
    } catch (error) {
      await removeQuietly(mergeTarget)
      await removeQuietly(videoTemp)
      await removeQuietly(audioTemp)
      throw new VideoDownloadFailure('write', safeDetail(error), false)
    }
    await Promise.all([
      removeQuietly(videoTemp),
      removeQuietly(audioTemp),
      removeQuietly(target.metaPath),
      removeQuietly(target.audioMetaPath)
    ])
    this.emitProgress(progressSink, target.fileName, total, total, 100)
  }

  /** 下载单个流到 .part，支持 Range 续传与 200 回退 */
  private async runStream(args: {
    url: string
    platform: VideoPlatform
    partPath: string
    metaPath: string
    totalFallback: number
    reset: boolean
    controller: AbortController
    reporter: StreamReporter
  }): Promise<{ transferred: number; total: number }> {
    const {
      url,
      partPath,
      metaPath,
      totalFallback,
      reset,
      controller,
      reporter
    } = args
    let existingBytes = reset ? 0 : await sizeOf(partPath)
    const meta = reset ? null : await readMeta(metaPath)
    if (
      reset ||
      decideResume({
        existingBytes,
        metaUrl: meta?.url ?? null,
        requestUrl: url,
        hasMeta: meta !== null
      }) === 'restart'
    ) {
      await removeQuietly(partPath)
      await removeQuietly(metaPath)
      existingBytes = 0
    }
    const resumable = existingBytes > 0
    const headers: Record<string, string> = {
      'User-Agent': DOWNLOAD_USER_AGENT,
      Referer: DOWNLOAD_REFERER[args.platform],
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
    if (resumable) {
      headers.Range = `bytes=${existingBytes}-`
    }
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new VideoDownloadFailure('unknown', CANCEL_DETAIL, true, true)
      }
      throw new VideoDownloadFailure('network', safeDetail(error), true)
    }

    const status = response.status
    if (!response.ok) {
      await discardBody(response)
      throw new VideoDownloadFailure(
        reasonOfStatus(status),
        `HTTP ${status}`,
        true
      )
    }
    const contentLength = parseContentLength(
      response.headers.get('content-length')
    )
    let writeFlag: 'a' | 'w' = resumable ? 'a' : 'w'
    let transferred = resumable ? existingBytes : 0
    /** 本次写入的起点，用于判断流是否真的写入了新数据 */
    let startBytes = resumable ? existingBytes : 0
    let total = 0
    if (status === 206) {
      const start = parseContentRangeStart(
        response.headers.get('content-range')
      )
      if (resumable) {
        if (start !== existingBytes) {
          await discardBody(response)
          throw new VideoDownloadFailure(
            'network',
            '续传响应区间与本地半成品不匹配',
            true
          )
        }
        total =
          contentLength > 0
            ? existingBytes + contentLength
            : (meta?.totalBytes ?? 0)
        writeFlag = 'a'
        startBytes = existingBytes
      } else if (start === 0) {
        transferred = 0
        writeFlag = 'w'
        total = contentLength
      } else {
        await discardBody(response)
        throw new VideoDownloadFailure(
          'network',
          '服务器返回了意外的部分响应',
          false
        )
      }
    } else if (status === 200) {
      if (resumable) {
        // 服务器忽略 Range：清空半成品从 0 重写
        await removeQuietly(partPath)
        transferred = 0
        startBytes = 0
        writeFlag = 'w'
      }
      total = contentLength > 0 ? contentLength : totalFallback
    } else {
      // 其他 2xx（如 203）按完整响应从 0 写入
      await removeQuietly(partPath)
      transferred = 0
      startBytes = 0
      writeFlag = 'w'
      total = contentLength > 0 ? contentLength : totalFallback
    }

    const body = response.body
    if (body === null) {
      throw new VideoDownloadFailure('network', '响应内容为空', resumable)
    }
    try {
      const metaToWrite: VideoDownloadMeta = {
        url,
        totalBytes: total > 0 ? total : (meta?.totalBytes ?? 0),
        updatedAt: new Date(this.now()).toISOString()
      }
      const etag = response.headers.get('etag')
      const lastModified = response.headers.get('last-modified')
      if (etag !== null) {
        metaToWrite.etag = etag
      }
      if (lastModified !== null) {
        metaToWrite.lastModified = lastModified
      }
      await writeMeta(metaPath, metaToWrite)
    } catch (error) {
      await discardBody(response)
      throw new VideoDownloadFailure('write', safeDetail(error), false)
    }

    reporter.report(transferred, total, true)
    let writeFailed = false
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferred += chunk.length
        reporter.report(transferred, total)
        callback(null, chunk)
      }
    })
    const writeStream = createWriteStream(partPath, { flags: writeFlag })
    writeStream.on('error', () => {
      writeFailed = true
    })
    try {
      await pipeline(
        Readable.fromWeb(body as unknown as NodeWebReadableStream),
        counter,
        writeStream
      )
    } catch (error) {
      if (controller.signal.aborted) {
        throw new VideoDownloadFailure('unknown', CANCEL_DETAIL, true, true)
      }
      throw new VideoDownloadFailure(
        writeFailed ? 'write' : 'network',
        safeDetail(error),
        true
      )
    }
    if (transferred === startBytes) {
      throw new VideoDownloadFailure('network', '响应内容为空', false)
    }
    return { transferred, total }
  }

  /** 生成目标路径；同名最终文件追加序号避免覆盖 */
  private async buildTarget(
    resource: VideoResource,
    variant: VideoVariant,
    downloadDir: string
  ): Promise<DownloadTarget> {
    const extension = extensionOf(variant.container)
    const base = `${resource.title}-${variant.label}`
    for (let index = 0; index < MAX_NAME_ATTEMPTS; index += 1) {
      const suffix = index === 0 ? '' : ` (${index})`
      const fileName = sanitizeVideoFileName(
        `${base}${suffix}.${extension}`,
        'video'
      )
      const finalPath = join(downloadDir, fileName)
      if (!(await fileExists(finalPath))) {
        return {
          title: resource.title,
          fileName,
          finalPath,
          partPath: `${finalPath}.part`,
          metaPath: `${finalPath}.meta.json`,
          audioPartPath: `${finalPath}.audio.part`,
          audioMetaPath: `${finalPath}.audio.meta.json`
        }
      }
    }
    // 极端情况下用时间戳兜底，保证仍有可写文件名
    const fileName = sanitizeVideoFileName(
      `${base}-${this.now()}.${extension}`,
      'video'
    )
    const finalPath = join(downloadDir, fileName)
    return {
      title: resource.title,
      fileName,
      finalPath,
      partPath: `${finalPath}.part`,
      metaPath: `${finalPath}.meta.json`,
      audioPartPath: `${finalPath}.audio.part`,
      audioMetaPath: `${finalPath}.audio.meta.json`
    }
  }

  /** 是否仍存在可续传的半成品 */
  private async hasPartial(target: DownloadTarget | null): Promise<boolean> {
    if (target === null) {
      return false
    }
    return (
      (await fileExists(target.partPath)) ||
      (await fileExists(target.audioPartPath))
    )
  }

  /** 直接发出聚合阶段进度（用于合并阶段） */
  private emitProgress(
    sink: (progress: VideoDownloadProgress) => void,
    fileName: string,
    transferred: number,
    total: number,
    percent: number
  ): void {
    try {
      sink({
        fileName,
        transferred,
        total,
        percent,
        speedBytesPerSec: 0,
        remainingMs: null
      })
    } catch {
      // 进度回调异常不影响下载结果
    }
  }

  /** 发布完成快照 */
  private publishCompletion(
    title: string,
    fileName: string,
    filePath: string
  ): VideoDownloadSnapshot {
    const snapshot: VideoDownloadSnapshot = {
      status: 'completed',
      title,
      fileName,
      filePath
    }
    this.publish(snapshot)
    return snapshot
  }

  /** 发布失败快照 */
  private publishFailure(
    title: string,
    reason: VideoErrorReason,
    detail: string | undefined,
    resumable: boolean
  ): VideoDownloadSnapshot {
    const cleanDetail = safeDetail(detail)
    const snapshot: VideoDownloadSnapshot = {
      status: 'failed',
      title,
      reason,
      resumable
    }
    if (cleanDetail !== undefined) {
      snapshot.detail = cleanDetail
    }
    this.publish(snapshot)
    return snapshot
  }

  /** 保存并推送快照，回调异常不影响下载结果 */
  private publish(snapshot: VideoDownloadSnapshot): void {
    this.last = snapshot
    try {
      this.onSnapshot?.(snapshot)
    } catch {
      // 快照回调异常不影响下载结果
    }
  }
}
