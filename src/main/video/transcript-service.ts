// 短视频模块：本地离线口播提取服务（ffmpeg 抽轨 + whisper.cpp）
// 仅主进程使用；阶段与失败均以快照返回，不向调用方抛出异常
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  videoErrorMessage,
  type VideoEngineConfig,
  type VideoEngineLanguage,
  type VideoEngineProbe,
  type VideoErrorReason,
  type VideoTranscriptSnapshot
} from '../../shared/video'
import { probeVideoEngine } from './engine-detect'
import type { VideoEngineSettingsStore } from './engine-settings'

/** 整体识别超时（毫秒） */
export const TRANSCRIPT_TIMEOUT_MS = 10 * 60 * 1000

/** 诊断详情最大长度，避免 stderr 刷屏 */
const MAX_DETAIL_LENGTH = 160

/** 识别阶段提示文案 */
const EXTRACTING_MESSAGE = '正在抽取音轨…'
const RECOGNIZING_MESSAGE = '正在识别口播文本…'

/** 取消时的固定诊断文案 */
const CANCEL_DETAIL = '已取消'

/** 任务进行中的固定诊断文案 */
const BUSY_DETAIL = '当前有任务正在进行，请稍后再试'

/** 合法识别语言 */
const ENGINE_LANGUAGES: readonly VideoEngineLanguage[] = ['zh', 'en', 'auto']

/** whisper 输出中的纯时间戳行，读取文本时整行丢弃 */
const TIMESTAMP_LINE_PATTERN =
  /^\[\d{1,2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}\.\d{3}\]\s*$/

/** 可注入依赖，便于测试替换真实子进程与文件系统 */
export interface TranscriptServiceDeps {
  /** 探测本地引擎 */
  probeEngine?: (config: VideoEngineConfig) => Promise<VideoEngineProbe>
  /** 抽取 16k 单声道 WAV */
  extractAudio?: (
    ffmpegPath: string,
    inputPath: string,
    wavPath: string,
    signal: AbortSignal
  ) => Promise<void>
  /** 调用 whisper 生成 .txt */
  runWhisper?: (args: {
    binaryPath: string
    modelPath: string
    wavPath: string
    outputBase: string
    language: VideoEngineLanguage
    signal: AbortSignal
  }) => Promise<void>
  readTextFile?: (path: string) => Promise<string>
  makeTempDir?: () => Promise<string>
  removeDir?: (path: string) => Promise<void>
  now?: () => number
}

/** 服务构造参数 */
export interface VideoTranscriptServiceOptions {
  store: VideoEngineSettingsStore
  /** 快照回调，用于主进程推送状态 */
  onSnapshot?: (snapshot: VideoTranscriptSnapshot) => void
  /** 已下载文件所在目录；提供时校验请求路径必须位于其中 */
  getDownloadDir?: () => string
  deps?: Partial<TranscriptServiceDeps>
}

/** 校验并归一化后的请求 */
interface ParsedTranscriptRequest {
  filePath: string
  language: VideoEngineLanguage
}

/** 截断诊断文本：压缩空白并限长，异常输入返回 undefined */
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
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  return cleaned === '' ? undefined : cleaned.slice(0, MAX_DETAIL_LENGTH)
}

/** 去掉纯时间戳行并整理换行 */
function cleanTranscriptText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !TIMESTAMP_LINE_PATTERN.test(line))
    .join('\n')
    .trim()
}

/**
 * 解析请求：必须是对象，filePath 为非空绝对路径；
 * language 仅接受 zh / en / auto，缺省回退引擎配置。
 */
function parseRequest(
  raw: unknown,
  fallbackLanguage: VideoEngineLanguage
): ParsedTranscriptRequest | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const filePath =
    typeof record.filePath === 'string' ? record.filePath.trim() : ''
  if (filePath === '' || !isAbsolute(filePath)) {
    return null
  }
  const language =
    typeof record.language === 'string' &&
    (ENGINE_LANGUAGES as readonly string[]).includes(record.language)
      ? (record.language as VideoEngineLanguage)
      : fallbackLanguage
  return { filePath, language }
}

/**
 * 运行单个子进程并收集 stderr。
 * 不使用 shell，参数以数组传递，避免命令注入；取消时立即终止进程。
 */
function runProcess(
  binary: string,
  args: string[],
  signal: AbortSignal,
  label: string
): Promise<string> {
  return new Promise((resolveProcess, rejectProcess) => {
    if (signal.aborted) {
      rejectProcess(new Error(CANCEL_DETAIL))
      return
    }
    let stderr = ''
    let settled = false
    const child = spawn(binary, args, { windowsHide: true })
    const onAbort = (): void => {
      if (settled) {
        return
      }
      settled = true
      try {
        child.kill('SIGKILL')
      } catch {
        // 进程可能已自然退出，忽略终止失败
      }
      rejectProcess(new Error(CANCEL_DETAIL))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.stderr?.on('data', (chunk: unknown) => {
      stderr = `${stderr}${String(chunk)}`.slice(-800)
    })
    child.on('error', (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      rejectProcess(error)
    })
    child.on('close', (code: number | null) => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) {
        rejectProcess(new Error(CANCEL_DETAIL))
        return
      }
      if (code === 0) {
        resolveProcess(stderr)
        return
      }
      const summary = stderr.replace(/\s+/g, ' ').trim()
      rejectProcess(
        new Error(
          summary === ''
            ? `${label} 退出码 ${String(code)}`
            : `${label} 退出码 ${String(code)}：${summary}`
        )
      )
    })
  })
}

/** 默认抽轨实现：16 kHz 单声道 WAV，输出到临时目录 */
async function defaultExtractAudio(
  ffmpegPath: string,
  inputPath: string,
  wavPath: string,
  signal: AbortSignal
): Promise<void> {
  await runProcess(
    ffmpegPath,
    [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'wav',
      wavPath
    ],
    signal,
    'ffmpeg'
  )
}

/** 默认识别实现：whisper.cpp 输出纯文本 */
async function defaultRunWhisper(args: {
  binaryPath: string
  modelPath: string
  wavPath: string
  outputBase: string
  language: VideoEngineLanguage
  signal: AbortSignal
}): Promise<void> {
  await runProcess(
    args.binaryPath,
    [
      '-m',
      args.modelPath,
      '-f',
      args.wavPath,
      '-l',
      args.language,
      '-otxt',
      '-of',
      args.outputBase,
      '-nt'
    ],
    args.signal,
    'whisper'
  )
}

/**
 * 口播提取服务：同一时刻只允许一个任务。
 *
 * 阶段顺序为「抽取音轨 → 识别中 → 完成」；取消与失败都会清理临时目录，
 * 原视频只读不改。任何异常都收敛为失败快照。
 */
export class VideoTranscriptService {
  private readonly store: VideoEngineSettingsStore
  private readonly onSnapshot:
    ((snapshot: VideoTranscriptSnapshot) => void) | undefined
  private readonly getDownloadDir: (() => string) | undefined
  private readonly probeEngine: (
    config: VideoEngineConfig
  ) => Promise<VideoEngineProbe>
  private readonly extractAudio: (
    ffmpegPath: string,
    inputPath: string,
    wavPath: string,
    signal: AbortSignal
  ) => Promise<void>
  private readonly runWhisper: (args: {
    binaryPath: string
    modelPath: string
    wavPath: string
    outputBase: string
    language: VideoEngineLanguage
    signal: AbortSignal
  }) => Promise<void>
  private readonly readTextFile: (path: string) => Promise<string>
  private readonly makeTempDir: () => Promise<string>
  private readonly removeDir: (path: string) => Promise<void>
  private readonly now: () => number
  private controller: AbortController | null = null
  private timedOut = false
  /** 最近一次快照 */
  private last: VideoTranscriptSnapshot = { status: 'idle' }

  constructor(options: VideoTranscriptServiceOptions) {
    this.store = options.store
    this.onSnapshot = options.onSnapshot
    this.getDownloadDir = options.getDownloadDir
    const deps = options.deps ?? {}
    this.probeEngine = deps.probeEngine ?? probeVideoEngine
    this.extractAudio = deps.extractAudio ?? defaultExtractAudio
    this.runWhisper = deps.runWhisper ?? defaultRunWhisper
    this.readTextFile = deps.readTextFile ?? ((path) => readFile(path, 'utf8'))
    this.makeTempDir =
      deps.makeTempDir ?? (() => mkdtemp(join(tmpdir(), 'video-transcript-')))
    this.removeDir =
      deps.removeDir ?? ((path) => rm(path, { recursive: true, force: true }))
    this.now = deps.now ?? Date.now
  }

  /** 当前快照：进行中为 running，否则为最近一次结果 */
  getSnapshot(): VideoTranscriptSnapshot {
    return this.last
  }

  /** 取消当前任务：中止子进程并保留失败快照 */
  cancel(): void {
    this.controller?.abort()
  }

  /** 发起口播提取；任何异常都收敛为失败快照 */
  async start(request: unknown): Promise<VideoTranscriptSnapshot> {
    if (this.controller !== null) {
      // 互斥拒绝不覆盖进行中任务的快照
      return {
        status: 'failed',
        reason: 'busy',
        message: videoErrorMessage('busy'),
        detail: BUSY_DETAIL
      }
    }
    const controller = new AbortController()
    this.controller = controller
    this.timedOut = false
    const startedAt = this.now()
    let tempDir: string | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      const settings = this.store.get()
      const parsed = parseRequest(request, settings.engine.language)
      if (parsed === null) {
        return this.publishFailure('unknown', '请求参数不合法')
      }
      let info: Awaited<ReturnType<typeof stat>>
      try {
        info = await stat(parsed.filePath)
      } catch {
        return this.publishFailure('unknown', '视频文件不存在或不可读')
      }
      if (!info.isFile()) {
        return this.publishFailure('unknown', '视频文件不存在或不可读')
      }
      if (controller.signal.aborted) {
        return this.publishFailure('unknown', CANCEL_DETAIL)
      }
      const filePath = resolve(parsed.filePath)
      const downloadDir = this.getDownloadDir?.() ?? ''
      if (downloadDir.trim() !== '') {
        const root = resolve(downloadDir)
        const prefix = root.endsWith(sep) ? root : `${root}${sep}`
        if (!filePath.startsWith(prefix)) {
          return this.publishFailure('unknown', '文件路径不在下载目录内')
        }
      }
      timer = setTimeout(() => {
        this.timedOut = true
        controller.abort()
      }, TRANSCRIPT_TIMEOUT_MS)

      const probe = await this.probeEngine(settings.engine)
      if (probe.binary === null || probe.model === null) {
        return this.publishFailure('engine-missing', probe.message)
      }
      if (probe.ffmpeg === null) {
        return this.publishFailure('ffmpeg-missing', probe.message)
      }

      this.publish({
        status: 'running',
        stage: 'extracting',
        message: EXTRACTING_MESSAGE
      })
      tempDir = await this.makeTempDir()
      const wavPath = join(tempDir, 'audio.wav')
      const outputBase = join(tempDir, 'transcript')
      try {
        await this.extractAudio(
          probe.ffmpeg,
          filePath,
          wavPath,
          controller.signal
        )
      } catch (error) {
        if (controller.signal.aborted) {
          throw error
        }
        return this.publishFailure('engine-failed', '音轨抽取失败')
      }
      if (controller.signal.aborted) {
        throw new Error(CANCEL_DETAIL)
      }

      this.publish({
        status: 'running',
        stage: 'recognizing',
        message: RECOGNIZING_MESSAGE
      })
      try {
        await this.runWhisper({
          binaryPath: probe.binary,
          modelPath: probe.model,
          wavPath,
          outputBase,
          language: parsed.language,
          signal: controller.signal
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw error
        }
        return this.publishFailure(
          'engine-failed',
          safeDetail(error) ?? '口播识别失败'
        )
      }
      if (controller.signal.aborted) {
        throw new Error(CANCEL_DETAIL)
      }

      let text: string
      try {
        text = await this.readTextFile(`${outputBase}.txt`)
      } catch (error) {
        return this.publishFailure(
          'write',
          safeDetail(error) ?? '读取识别文本失败'
        )
      }
      if (controller.signal.aborted) {
        throw new Error(CANCEL_DETAIL)
      }
      return this.publish({
        status: 'completed',
        text: cleanTranscriptText(text),
        fileName: basename(filePath),
        filePath,
        engine: basename(probe.binary),
        elapsedMs: Math.max(0, this.now() - startedAt)
      })
    } catch (error) {
      if (this.timedOut) {
        return this.publishFailure(
          'engine-failed',
          `识别超时（${String(TRANSCRIPT_TIMEOUT_MS / 60000)} 分钟）`
        )
      }
      if (controller.signal.aborted) {
        return this.publishFailure('unknown', CANCEL_DETAIL)
      }
      return this.publishFailure('unknown', safeDetail(error))
    } finally {
      if (timer !== null) {
        clearTimeout(timer)
      }
      if (tempDir !== null) {
        try {
          await this.removeDir(tempDir)
        } catch {
          // 清理失败不影响结果归因
        }
      }
      if (this.controller === controller) {
        this.controller = null
      }
    }
  }

  /** 发布失败快照 */
  private publishFailure(
    reason: VideoErrorReason,
    detail?: string
  ): VideoTranscriptSnapshot {
    const snapshot: VideoTranscriptSnapshot = {
      status: 'failed',
      reason,
      message: videoErrorMessage(reason)
    }
    const cleanDetail = safeDetail(detail)
    if (cleanDetail !== undefined) {
      snapshot.detail = cleanDetail
    }
    return this.publish(snapshot)
  }

  /** 保存并推送快照，回调异常不影响任务结果 */
  private publish(snapshot: VideoTranscriptSnapshot): VideoTranscriptSnapshot {
    this.last = snapshot
    try {
      this.onSnapshot?.(snapshot)
    } catch {
      // 快照回调异常不影响识别结果
    }
    return snapshot
  }
}
