// 主进程安装包下载服务：校验下载地址、流式落盘并上报进度
// 仅主进程使用；渲染层通过 IPC 触发下载与取消
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  UPDATE_DOWNLOAD_PATH_PREFIX,
  type ReleaseAsset,
  type UpdateDownloadErrorReason,
  type UpdateDownloadProgress,
  type UpdateDownloadResult,
  type UpdateDownloadSnapshot
} from '../shared/update'

/** 默认进度回调最小间隔（毫秒） */
const DEFAULT_PROGRESS_INTERVAL_MS = 200

/** 默认连接超时（毫秒）：等待响应头的最大时长 */
const DEFAULT_CONNECT_TIMEOUT_MS = 20 * 1000

/** 默认传输停滞超时（毫秒）：两个数据块之间的最大空闲时长 */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 1000

/** 诊断详情最大长度，避免异常信息刷屏 */
const MAX_DETAIL_LENGTH = 160

/** 文件名清洗后为空时的回退名 */
const FALLBACK_FILE_NAME = 'update-installer'

/** node:stream/web 的 ReadableStream 类型，用于收窄 DOM 同名类型 */
type NodeWebReadableStream = import('node:stream/web').ReadableStream

/**
 * 是否为允许下载的地址：HTTPS、hostname 严格为 github.com，
 * 且 pathname 以本仓库 release 下载路径前缀开头。
 * 解析失败一律返回 false，不抛异常。
 */
export function isAllowedDownloadUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.pathname.startsWith(UPDATE_DOWNLOAD_PATH_PREFIX)
  )
}

/**
 * 清洗下载文件名：只取最后一段（同时兼容 / 与 \），
 * 仅保留字母数字与 ._-，其余字符替换为 _，并去掉开头的点。
 * 结果为空时回退为 update-installer。
 */
export function sanitizeDownloadFileName(raw: string): string {
  const segments = raw.split(/[/\\]/)
  const last = segments[segments.length - 1] ?? ''
  const sanitized = last.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return sanitized === '' ? FALLBACK_FILE_NAME : sanitized
}

/**
 * 把待打开的文件路径收敛到下载目录内。
 * 空字符串、下载目录本身、以及下载目录之外的路径一律返回 null；
 * 合法路径返回绝对路径。
 */
export function resolveDownloadedFile(
  raw: string,
  downloadDir: string
): string | null {
  if (raw.trim() === '') {
    return null
  }
  const target = resolve(raw)
  const root = resolve(downloadDir)
  if (target === root) {
    return null
  }
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (!target.startsWith(prefix)) {
    return null
  }
  return target
}

/**
 * 提取底层异常的可读诊断：优先错误码（含 cause 的 code），
 * 其次错误信息，压缩空白并限长，避免把堆栈刷到界面上。
 */
export function detailOf(error: unknown): string | undefined {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    const cause = error.cause
    const causeCode =
      cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined
    const parts = [code, causeCode, error.message].filter(
      (item): item is string => typeof item === 'string' && item.trim() !== ''
    )
    if (parts.length === 0) {
      return undefined
    }
    return parts.join(' ').replace(/\s+/g, ' ').slice(0, MAX_DETAIL_LENGTH)
  }
  if (typeof error === 'string') {
    const trimmed = error.replace(/\s+/g, ' ').trim()
    return trimmed === '' ? undefined : trimmed.slice(0, MAX_DETAIL_LENGTH)
  }
  return undefined
}

/** 计算 0-100 的整数百分比；total 未知（0）时为 0 */
function percentOf(transferred: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  const value = Math.floor((transferred / total) * 100)
  return Math.min(100, Math.max(0, value))
}

/** 解析总字节数：优先 content-length，缺失或非法时回退资产声明大小 */
function resolveTotal(header: string | null, fallback: number): number {
  if (header !== null) {
    const trimmed = header.trim()
    if (/^\d+$/.test(trimmed)) {
      const value = Number(trimmed)
      if (value > 0) {
        return value
      }
    }
  }
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
}

/** 进度上报器：节流上报进行中进度，并提供收口到 100% 的完成事件 */
interface ProgressReporter {
  /** 上报当前进度；首次与 force 时不受节流限制 */
  report: (transferred: number, force?: boolean) => void
  /** 完成时补发 100%；不改写 total（可能未知或与实际字节不一致） */
  finish: (transferred: number) => void
}

/**
 * 创建带节流的进度上报器。
 * 首次上报与强制上报不受间隔限制；无回调时为空操作。
 */
function createProgressReporter(
  fileName: string,
  total: number,
  onProgress: ((progress: UpdateDownloadProgress) => void) | undefined,
  intervalMs: number
): ProgressReporter {
  let emitted = false
  let lastEmittedAt = 0
  // 进度上报失败（如窗口已销毁）只影响界面，不应让下载结果变成失败
  const emit = (transferred: number, percent: number): void => {
    try {
      onProgress?.({ fileName, transferred, total, percent })
    } catch {
      // 忽略进度回调异常
    }
  }
  return {
    report: (transferred, force = false) => {
      if (onProgress === undefined) {
        return
      }
      const now = Date.now()
      if (!force && emitted && now - lastEmittedAt < intervalMs) {
        return
      }
      emitted = true
      lastEmittedAt = now
      emit(transferred, percentOf(transferred, total))
    },
    finish: (transferred) => {
      if (onProgress === undefined) {
        return
      }
      // 保留解析出的总大小：未知时为 0，可能与实际字节不一致
      emit(transferred, 100)
    }
  }
}

/** 删除半成品文件，忽略不存在等异常 */
async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  } catch {
    // 清理失败不影响结果归因
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

/** 单次下载请求的失败上下文：区分用户取消与超时中止 */
interface FailureContext {
  controller: AbortController
  /** 是否因超时主动中止 */
  timedOut: boolean
  /** 超时对应的诊断文案 */
  timeoutDetail: string
}

/**
 * 失败归因：中止时先区分超时与用户取消，其余按传入原因与详情收敛。
 * 必须优先判断 timedOut，因为两者都表现为 signal.aborted。
 */
function failureOf(
  context: FailureContext,
  reason: UpdateDownloadErrorReason,
  detail?: string
): UpdateDownloadResult {
  if (context.controller.signal.aborted) {
    if (context.timedOut) {
      return {
        status: 'failed',
        reason: 'timeout',
        detail: context.timeoutDetail
      }
    }
    return { status: 'cancelled' }
  }
  return detail === undefined
    ? { status: 'failed', reason }
    : { status: 'failed', reason, detail }
}

export interface DownloadReleaseAssetOptions {
  /** 待下载的安装包资产 */
  asset: ReleaseAsset
  /** 安装包落盘目录 */
  downloadDir: string
  /** 进度回调 */
  onProgress?: (progress: UpdateDownloadProgress) => void
  /** 注入的 fetch 实现，便于测试；默认使用全局 fetch */
  fetchImpl?: typeof fetch
  /** 进度回调最小间隔（毫秒），默认 200 */
  progressIntervalMs?: number
  /** 连接超时（毫秒），默认 20000 */
  connectTimeoutMs?: number
  /** 传输停滞超时（毫秒），默认 30000 */
  idleTimeoutMs?: number
}

/** 把下载结果转换为快照；用户取消视为空闲，不保留失败结果 */
function snapshotOf(
  asset: ReleaseAsset,
  result: UpdateDownloadResult
): UpdateDownloadSnapshot {
  const pureAsset: ReleaseAsset = {
    name: asset.name,
    size: asset.size,
    downloadUrl: asset.downloadUrl
  }
  if (result.status === 'completed') {
    return {
      status: 'completed',
      asset: pureAsset,
      fileName: result.fileName,
      filePath: result.filePath
    }
  }
  if (result.status === 'cancelled') {
    return { status: 'idle' }
  }
  return result.detail === undefined
    ? { status: 'failed', asset: pureAsset, reason: result.reason }
    : {
        status: 'failed',
        asset: pureAsset,
        reason: result.reason,
        detail: result.detail
      }
}

/**
 * 安装包下载器：同一时刻只允许一个下载任务。
 *
 * 先写入 <fileName>.part，成功后删除同名旧文件并 rename 为最终文件；
 * 失败与取消都会清理半成品，且绝不向调用方抛出异常。
 */
export class AssetDownloader {
  private controller: AbortController | null = null
  /** 进行中下载的资产与最新进度 */
  private current: {
    asset: ReleaseAsset
    progress: UpdateDownloadProgress
  } | null = null
  /** 最近一次下载结果快照 */
  private last: UpdateDownloadSnapshot = { status: 'idle' }

  /** 是否有下载任务在进行 */
  get downloading(): boolean {
    return this.controller !== null
  }

  /** 下载状态快照：进行中优先，否则返回最近一次结果 */
  getSnapshot(): UpdateDownloadSnapshot {
    const current = this.current
    if (current !== null) {
      return {
        status: 'downloading',
        asset: { ...current.asset },
        progress: { ...current.progress }
      }
    }
    return this.last
  }

  /** 取消当前下载；无任务时无副作用 */
  cancel(): void {
    this.controller?.abort()
  }

  async download(
    options: DownloadReleaseAssetOptions
  ): Promise<UpdateDownloadResult> {
    if (this.controller !== null) {
      return { status: 'failed', reason: 'busy' }
    }
    const controller = new AbortController()
    this.controller = controller
    // IPC 传入的资产可能是响应式 Proxy，先复制成纯对象再保存到快照
    const asset: ReleaseAsset = {
      name: options.asset.name,
      size: options.asset.size,
      downloadUrl: options.asset.downloadUrl
    }
    const fileName = sanitizeDownloadFileName(asset.name)
    const partPath = join(options.downloadDir, `${fileName}.part`)
    const finalPath = join(options.downloadDir, fileName)
    let result: UpdateDownloadResult
    this.current = {
      asset,
      progress: {
        fileName,
        transferred: 0,
        total: asset.size,
        percent: 0
      }
    }
    try {
      result = await this.run(
        {
          ...options,
          asset,
          onProgress: (progress: UpdateDownloadProgress) => {
            if (this.current !== null) {
              this.current.progress = progress
            }
            try {
              options.onProgress?.(progress)
            } catch {
              // 进度回调异常不影响下载结果
            }
          }
        },
        controller,
        fileName,
        partPath,
        finalPath
      )
    } catch (error) {
      await removeQuietly(partPath)
      result = { status: 'failed', reason: 'unknown', detail: detailOf(error) }
    } finally {
      this.current = null
      this.controller = null
    }
    this.last = snapshotOf(asset, result)
    return result
  }

  private async run(
    options: DownloadReleaseAssetOptions,
    controller: AbortController,
    fileName: string,
    partPath: string,
    finalPath: string
  ): Promise<UpdateDownloadResult> {
    if (!isAllowedDownloadUrl(options.asset.downloadUrl)) {
      return { status: 'failed', reason: 'invalid-asset' }
    }
    try {
      await mkdir(options.downloadDir, { recursive: true })
    } catch (error) {
      return { status: 'failed', reason: 'write', detail: detailOf(error) }
    }

    const connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    const context: FailureContext = {
      controller,
      timedOut: false,
      timeoutDetail: ''
    }
    let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      context.timedOut = true
      context.timeoutDetail = `连接超时（${connectTimeoutMs / 1000} 秒）`
      controller.abort()
    }, connectTimeoutMs)
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    /** 清理两个超时定时器，避免流程结束后仍有挂起计时 */
    const clearTimers = (): void => {
      if (connectTimer !== null) {
        clearTimeout(connectTimer)
        connectTimer = null
      }
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }
    /** 收到数据后重置停滞计时；无数据超过阈值即中止请求 */
    const touchIdle = (): void => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
      }
      idleTimer = setTimeout(() => {
        context.timedOut = true
        context.timeoutDetail = `传输停滞超时（${idleTimeoutMs / 1000} 秒未收到数据）`
        controller.abort()
      }, idleTimeoutMs)
    }

    const fetchImpl = options.fetchImpl ?? fetch
    let response: Response
    try {
      response = await fetchImpl(options.asset.downloadUrl, {
        signal: controller.signal
      })
    } catch (error) {
      clearTimers()
      return failureOf(context, 'network', detailOf(error))
    }
    // 响应头已到达，连接阶段结束；后续由停滞计时器监控传输
    if (connectTimer !== null) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
    if (!response.ok) {
      clearTimers()
      await discardBody(response)
      return failureOf(context, 'http', `HTTP ${response.status}`)
    }
    const body = response.body
    if (body === null) {
      clearTimers()
      return failureOf(context, 'network', '响应内容为空')
    }
    const total = resolveTotal(
      response.headers.get('content-length'),
      options.asset.size
    )
    const report = createProgressReporter(
      fileName,
      total,
      options.onProgress,
      options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS
    )
    report.report(0, true)

    let transferred = 0
    let writeFailed = false
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferred += chunk.length
        touchIdle()
        report.report(transferred)
        callback(null, chunk)
      }
    })
    const writeStream = createWriteStream(partPath)
    writeStream.on('error', () => {
      writeFailed = true
    })
    // 响应头已到达，改为监控数据块间隔
    touchIdle()
    try {
      await pipeline(
        Readable.fromWeb(body as unknown as NodeWebReadableStream),
        counter,
        writeStream
      )
    } catch (error) {
      clearTimers()
      await removeQuietly(partPath)
      return failureOf(
        context,
        writeFailed ? 'write' : 'network',
        detailOf(error)
      )
    }
    clearTimers()
    if (transferred === 0) {
      // 响应体为空：视为网络异常，避免落地空安装包
      await removeQuietly(partPath)
      return failureOf(context, 'network', '响应内容为空')
    }
    try {
      await rm(finalPath, { force: true })
      await rename(partPath, finalPath)
    } catch (error) {
      await removeQuietly(partPath)
      return { status: 'failed', reason: 'write', detail: detailOf(error) }
    }
    report.finish(transferred)
    return { status: 'completed', fileName, filePath: finalPath }
  }
}
