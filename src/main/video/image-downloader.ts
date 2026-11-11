// 短视频模块图集下载器：按序号把图文笔记的图片保存到本地目录
// 仅主进程使用；所有失败以快照返回，不向调用方抛出异常
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isAllowedMediaUrl,
  sanitizeVideoFileName,
  type VideoErrorReason,
  type VideoImage,
  type VideoImageDownloadProgress,
  type VideoImageDownloadSnapshot,
  type VideoPlatform,
  type VideoResource
} from '../../shared/video'

/** 图集下载使用的桌面浏览器 UA，部分平台 CDN 会校验 UA */
const IMAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

/** 各平台 CDN 防盗链要求的 Referer */
const IMAGE_REFERER: Record<VideoPlatform, string> = {
  douyin: 'https://www.douyin.com/',
  kuaishou: 'https://www.kuaishou.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  bilibili: 'https://www.bilibili.com/'
}

/** 响应头 content-type 到落盘扩展名的映射 */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic'
}

/** URL 路径中可识别的图片扩展名 */
const URL_EXTENSION_PATTERN = /\.(jpe?g|png|webp|gif)$/i

/** 单张图片失败后的重试间隔（毫秒） */
const RETRY_DELAY_MS = 300

/** 动图落盘扩展名固定为 mp4，不参与扩展名推断 */
const ANIMATED_EXTENSION = 'mp4'

/** 诊断详情最大长度，避免异常信息刷屏 */
const MAX_DETAIL_LENGTH = 160

/** 取消时的固定提示文案 */
const CANCEL_DETAIL = '已取消'

/** 单张图片请求的成功结果 */
interface ImageFetchSuccess {
  ok: true
  extension: string
  data: Buffer
}

/** 单张图片请求的失败结果 */
interface ImageFetchFailure {
  ok: false
  /** 是否为用户主动取消 */
  cancelled: boolean
  reason: VideoErrorReason
}

/** 单张图片请求结果 */
type ImageFetchResult = ImageFetchSuccess | ImageFetchFailure

/** 图集下载器可注入依赖 */
export interface VideoImageDownloaderOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** 媒体地址白名单；默认使用共享契约的 isAllowedMediaUrl */
  allowMediaUrl?: (platform: VideoPlatform, url: string) => boolean
  /** 快照回调，用于主进程推送状态 */
  onSnapshot?: (snapshot: VideoImageDownloadSnapshot) => void
}

/** 单次图集下载入参 */
export interface VideoImageDownloadTaskOptions {
  resource: VideoResource
  downloadDir: string
  /** 为 true 时重新覆盖已有图片 */
  reset?: boolean
}

/** 默认休眠实现 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
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

/** 从 URL 路径中读取图片扩展名，识别不到返回 null */
function extensionFromUrl(url: string): string | null {
  try {
    const match = URL_EXTENSION_PATTERN.exec(new URL(url).pathname)
    if (match === null) {
      return null
    }
    const extension = (match[1] ?? '').toLowerCase()
    return extension === 'jpeg' ? 'jpg' : extension
  } catch {
    return null
  }
}

/** 扩展名优先级：content-type > URL 路径 > jpg */
function extensionOf(contentType: string | null, url: string): string {
  if (contentType !== null) {
    const type = (contentType.split(';')[0] ?? '').trim().toLowerCase()
    const mapped = CONTENT_TYPE_EXTENSIONS[type]
    if (mapped !== undefined) {
      return mapped
    }
  }
  return extensionFromUrl(url) ?? 'jpg'
}

/** 取图片可用的动图地址，缺失或为空串时返回 null */
function animatedUrlOf(image: VideoImage): string | null {
  const url = image.animated?.url
  return typeof url === 'string' && url.trim() !== '' ? url : null
}

/**
 * 单张图片的候选地址：动图只用动图源；
 * 静态图按「首选 url → fallbackUrls」顺序去重，忽略空串。
 */
function candidateUrlsOf(image: VideoImage): string[] {
  const animatedUrl = animatedUrlOf(image)
  if (animatedUrl !== null) {
    return [animatedUrl]
  }
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const url of [image.url, ...(image.fallbackUrls ?? [])]) {
    if (url.trim() === '' || seen.has(url)) {
      continue
    }
    seen.add(url)
    candidates.push(url)
  }
  return candidates
}

/** 百分比：0-100 整数，total 非法或非正数时返回 0 */
function percentOfCompleted(completed: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)))
}

/** 丢弃未读取的响应体，避免连接悬挂 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // 忽略取消失败
  }
}

/**
 * 图集下载器：同一时刻只允许一个任务，按「01.ext」「02.ext」顺序落盘。
 *
 * 同名目录已存在时直接复用，图片按序号覆盖写；取消保留已写入的图片。
 */
export class VideoImageDownloader {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly allowMediaUrl: (
    platform: VideoPlatform,
    url: string
  ) => boolean
  private readonly onSnapshot:
    ((snapshot: VideoImageDownloadSnapshot) => void) | undefined
  private controller: AbortController | null = null
  private running = false
  private activeTask: Promise<VideoImageDownloadSnapshot> | null = null
  /** 进行中任务的标题、目录与最新进度 */
  private current: {
    title: string
    directory: string
    progress: VideoImageDownloadProgress
  } | null = null
  /** 最近一次快照 */
  private last: VideoImageDownloadSnapshot = { status: 'idle' }

  constructor(options: VideoImageDownloaderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.sleep = options.sleep ?? defaultSleep
    this.allowMediaUrl = options.allowMediaUrl ?? isAllowedMediaUrl
    this.onSnapshot = options.onSnapshot
  }

  /** 当前快照：进行中优先，否则返回最近结果 */
  getSnapshot(): VideoImageDownloadSnapshot {
    const current = this.current
    if (current !== null) {
      return {
        status: 'downloading',
        title: current.title,
        directory: current.directory,
        progress: { ...current.progress }
      }
    }
    return this.last
  }

  /** 取消当前任务：中止进行中的请求，保留已写入的图片 */
  cancel(): void {
    this.controller?.abort()
  }

  /** 发起下载；任何异常都收敛为失败快照 */
  async download(
    options: VideoImageDownloadTaskOptions
  ): Promise<VideoImageDownloadSnapshot> {
    if (this.running) {
      return {
        status: 'failed',
        title: options.resource.title,
        reason: 'busy',
        detail: '正在下载图片，请稍后再试'
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
        safeDetail(error)
      )
    } finally {
      if (this.activeTask === task) {
        this.activeTask = null
      }
      this.running = false
    }
  }

  /** 执行一次完整图集下载流程 */
  private async runDownload(
    options: VideoImageDownloadTaskOptions
  ): Promise<VideoImageDownloadSnapshot> {
    const { resource, downloadDir } = options
    const title = resource.title
    const total = resource.images.length
    const controller = new AbortController()
    this.controller = controller
    try {
      if (resource.kind !== 'note' || total === 0) {
        return this.publishFailure(title, 'empty', '该笔记没有可下载的图片')
      }
      const directory = join(
        downloadDir,
        sanitizeVideoFileName(title, '图文笔记')
      )
      try {
        await mkdir(directory, { recursive: true })
      } catch (error) {
        return this.publishFailure(title, 'write', safeDetail(error))
      }

      let saved = 0
      let failed = 0
      let lastReason: VideoErrorReason = 'network'
      let cancelled = false

      for (let index = 0; index < resource.images.length; index += 1) {
        if (controller.signal.aborted) {
          cancelled = true
          break
        }
        const image = resource.images[index]
        if (image === undefined) {
          continue
        }
        const sequence = String(index + 1).padStart(2, '0')
        const candidates = candidateUrlsOf(image)
        const animated = animatedUrlOf(image) !== null
        const preliminary = animated
          ? `${sequence}.${ANIMATED_EXTENSION}`
          : `${sequence}.${extensionFromUrl(candidates[0] ?? '') ?? 'jpg'}`
        this.publishProgress(
          title,
          directory,
          saved + failed,
          total,
          preliminary
        )

        // 白名单按候选逐个判断：白名单外的候选直接跳过，不发请求
        const allowed = candidates.filter((url) =>
          this.allowMediaUrl(resource.platform, url)
        )
        if (allowed.length === 0) {
          failed += 1
          lastReason = 'unknown'
          continue
        }

        // 按候选顺序依次尝试，每个候选最多请求两次
        let success: ImageFetchSuccess | null = null
        let cancelledHere = false
        let candidateReason: VideoErrorReason = 'unknown'
        for (const url of allowed) {
          const result = await this.fetchWithRetry(
            url,
            resource.platform,
            controller.signal
          )
          if (result.ok) {
            success = result
            break
          }
          if (result.cancelled) {
            cancelledHere = true
            break
          }
          candidateReason = result.reason
        }
        if (cancelledHere) {
          cancelled = true
          break
        }
        if (success === null) {
          failed += 1
          lastReason = candidateReason
          continue
        }

        const fileName = animated
          ? `${sequence}.${ANIMATED_EXTENSION}`
          : `${sequence}.${success.extension}`
        if (fileName !== preliminary) {
          this.publishProgress(
            title,
            directory,
            saved + failed,
            total,
            fileName
          )
        }
        try {
          await writeFile(join(directory, fileName), success.data)
        } catch {
          failed += 1
          lastReason = 'write'
          continue
        }
        saved += 1
      }

      this.current = null
      if (cancelled) {
        return this.publishFailure(title, 'unknown', CANCEL_DETAIL)
      }
      if (saved === 0) {
        return this.publishFailure(
          title,
          lastReason,
          `${failed} 张图片全部下载失败`
        )
      }
      return this.publishCompletion(title, directory, saved, failed)
    } catch (error) {
      this.current = null
      return this.publishFailure(title, 'unknown', safeDetail(error))
    } finally {
      if (this.controller === controller) {
        this.controller = null
      }
      this.current = null
    }
  }

  /** 单张图片失败时重试一次，仍失败则把原因交给调用方计数 */
  private async fetchWithRetry(
    url: string,
    platform: VideoPlatform,
    signal: AbortSignal
  ): Promise<ImageFetchResult> {
    const first = await this.fetchImage(url, platform, signal)
    if (first.ok || first.cancelled) {
      return first
    }
    try {
      await this.sleep(RETRY_DELAY_MS)
    } catch {
      // 休眠异常不影响重试
    }
    if (signal.aborted) {
      return { ok: false, cancelled: true, reason: 'unknown' }
    }
    return this.fetchImage(url, platform, signal)
  }

  /** 请求单张图片：非 2xx、空响应体与网络异常都归为失败 */
  private async fetchImage(
    url: string,
    platform: VideoPlatform,
    signal: AbortSignal
  ): Promise<ImageFetchResult> {
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'User-Agent': IMAGE_USER_AGENT,
          Referer: IMAGE_REFERER[platform],
          Accept: 'image/*',
          'Accept-Language': 'zh-CN,zh;q=0.9'
        },
        signal
      })
      if (!response.ok) {
        await discardBody(response)
        return {
          ok: false,
          cancelled: false,
          reason: reasonOfStatus(response.status)
        }
      }
      const data = Buffer.from(await response.arrayBuffer())
      if (data.byteLength === 0) {
        return { ok: false, cancelled: false, reason: 'network' }
      }
      return {
        ok: true,
        extension: extensionOf(response.headers.get('content-type'), url),
        data
      }
    } catch {
      if (signal.aborted) {
        return { ok: false, cancelled: true, reason: 'unknown' }
      }
      return { ok: false, cancelled: false, reason: 'network' }
    }
  }

  /** 发布进行中快照 */
  private publishProgress(
    title: string,
    directory: string,
    completed: number,
    total: number,
    currentFileName: string
  ): void {
    const progress: VideoImageDownloadProgress = {
      completed,
      total,
      currentFileName,
      percent: percentOfCompleted(completed, total)
    }
    this.current = { title, directory, progress }
    this.publish({
      status: 'downloading',
      title,
      directory,
      progress: { ...progress }
    })
  }

  /** 发布完成快照 */
  private publishCompletion(
    title: string,
    directory: string,
    saved: number,
    failed: number
  ): VideoImageDownloadSnapshot {
    const snapshot: VideoImageDownloadSnapshot = {
      status: 'completed',
      title,
      directory,
      saved,
      failed
    }
    this.publish(snapshot)
    return snapshot
  }

  /** 发布失败快照 */
  private publishFailure(
    title: string,
    reason: VideoErrorReason,
    detail: string | undefined
  ): VideoImageDownloadSnapshot {
    const cleanDetail = safeDetail(detail)
    const snapshot: VideoImageDownloadSnapshot = {
      status: 'failed',
      title,
      reason
    }
    if (cleanDetail !== undefined) {
      snapshot.detail = cleanDetail
    }
    this.publish(snapshot)
    return snapshot
  }

  /** 保存并推送快照，回调异常不影响下载结果 */
  private publish(snapshot: VideoImageDownloadSnapshot): void {
    this.last = snapshot
    try {
      this.onSnapshot?.(snapshot)
    } catch {
      // 快照回调异常不影响下载结果
    }
  }
}
