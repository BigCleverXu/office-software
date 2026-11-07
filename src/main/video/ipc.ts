// 短视频模块 IPC：解析 / 下载 / 口播 / 引擎设置 / 文件与文本操作
// 所有 handler 都把失败收敛为契约内的返回值，不向渲染层抛出异常
import { dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import {
  DEFAULT_VIDEO_MODULE_SETTINGS,
  VIDEO_CHANNELS,
  sanitizeVideoFileName,
  videoErrorMessage,
  type VideoActionResult,
  type VideoDownloadSnapshot,
  type VideoEngineProbe,
  type VideoErrorReason,
  type VideoExportResult,
  type VideoModuleSettings,
  type VideoParseResult,
  type VideoPickKind,
  type VideoPickResult,
  type VideoTranscriptSnapshot
} from '../../shared/video'
import { probeVideoEngine } from './engine-detect'
import type { VideoEngineSettingsStore } from './engine-settings'
import type { VideoDownloader } from './downloader'
import type { VideoParseService } from './parse-service'
import type { VideoTranscriptService } from './transcript-service'

/** 导出文本最大字节数（2MB） */
const MAX_EXPORT_TEXT_BYTES = 2 * 1024 * 1024

/** 允许用系统默认程序打开的文件扩展名 */
const OPENABLE_EXTENSIONS: readonly string[] = [
  '.mp4',
  '.flv',
  '.mkv',
  '.m4a',
  '.mp3',
  '.wav',
  '.txt'
]

/** 文件选择类型白名单 */
const PICK_KINDS: readonly VideoPickKind[] = [
  'whisper',
  'model',
  'ffmpeg',
  'media',
  'directory'
]

/** 短视频 IPC 可注入依赖 */
export interface VideoIpcDeps {
  parseService: VideoParseService
  downloader: VideoDownloader
  transcriptService: VideoTranscriptService
  engineStore: VideoEngineSettingsStore
  /** 下载目录；配置为空时的兜底由主进程装配层提供 */
  getDownloadDir: () => string
  getWindow: () => BrowserWindow | null
  /** 应用资源目录，用于探测 whisper / 模型 / ffmpeg */
  resourcesDir?: string
}

/** 校验并归一化后的下载请求 */
interface NormalizedDownloadRequest {
  resourceId: string
  variantId: string
  reset: boolean
}

/** 是否为普通对象（排除 null 与数组） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 校验下载请求：必须是对象，resourceId / variantId 为非空字符串，
 * reset 缺省为 false，出现非布尔值时整体视为非法请求。
 */
function parseDownloadRequest(raw: unknown): NormalizedDownloadRequest | null {
  if (!isRecord(raw)) {
    return null
  }
  const resourceId =
    typeof raw.resourceId === 'string' ? raw.resourceId.trim() : ''
  const variantId =
    typeof raw.variantId === 'string' ? raw.variantId.trim() : ''
  if (resourceId === '' || variantId === '') {
    return null
  }
  if (raw.reset !== undefined && typeof raw.reset !== 'boolean') {
    return null
  }
  return { resourceId, variantId, reset: raw.reset === true }
}

/** 构造失败快照，title 仅在已知时写入 */
function failedSnapshot(
  reason: VideoErrorReason,
  detail: string,
  title?: string
): VideoDownloadSnapshot {
  const snapshot: VideoDownloadSnapshot = {
    status: 'failed',
    reason,
    detail,
    resumable: false
  }
  if (title !== undefined) {
    snapshot.title = title
  }
  return snapshot
}

/** 配置里的下载目录为空时，用主进程兜底目录补全 */
function withDownloadDir(
  settings: VideoModuleSettings,
  fallbackDir: string
): VideoModuleSettings {
  return settings.downloadDir.trim() === ''
    ? { ...settings, downloadDir: fallbackDir }
    : settings
}

/** 确保导出文件名以 .txt 结尾 */
function toExportFileName(raw: string): string {
  const cleaned = sanitizeVideoFileName(raw, '口播文本')
  return cleaned.toLowerCase().endsWith('.txt') ? cleaned : `${cleaned}.txt`
}

/** 按选择类型构造系统文件选择框选项 */
function buildPickOptions(kind: VideoPickKind): Electron.OpenDialogOptions {
  if (kind === 'directory') {
    return { title: '选择目录', properties: ['openDirectory'] }
  }
  if (kind === 'media') {
    return {
      title: '选择视频或音频文件',
      properties: ['openFile'],
      filters: [
        { name: '音视频文件', extensions: ['mp4', 'flv', 'm4a', 'mp3', 'wav'] }
      ]
    }
  }
  if (kind === 'model') {
    return {
      title: '选择识别模型',
      properties: ['openFile'],
      filters: [{ name: 'Whisper 模型', extensions: ['bin'] }]
    }
  }
  return {
    title:
      kind === 'whisper' ? '选择 whisper 可执行文件' : '选择 ffmpeg 可执行文件',
    properties: ['openFile'],
    filters: [{ name: '可执行文件', extensions: ['exe'] }]
  }
}

/** 打开 / 导出失败时的统一提示 */
const OPEN_FAILED_MESSAGE = '打开文件失败'

/**
 * 注册短视频模块全部 IPC 通道。
 *
 * parse 直接透传解析服务的分类结果；其余通道均有 try/catch，
 * 失败时返回契约内的空状态或失败快照，保证渲染层不会收到异常。
 */
export function registerVideoIpc(deps: VideoIpcDeps): void {
  ipcMain.handle(
    VIDEO_CHANNELS.parse,
    (
      _event: Electron.IpcMainInvokeEvent,
      input: unknown
    ): Promise<VideoParseResult> => deps.parseService.parse(input)
  )

  ipcMain.handle(
    VIDEO_CHANNELS.download,
    async (
      _event: Electron.IpcMainInvokeEvent,
      rawRequest: unknown
    ): Promise<VideoDownloadSnapshot> => {
      try {
        const request = parseDownloadRequest(rawRequest)
        if (request === null) {
          return failedSnapshot('unknown', '下载请求无效')
        }
        const resource = deps.parseService.getResource(request.resourceId)
        if (resource === null) {
          return failedSnapshot('expired', '解析结果已过期，请重新解析')
        }
        const variant = resource.variants.find(
          (item) => item.id === request.variantId
        )
        if (variant === undefined) {
          return failedSnapshot('empty', '未找到该清晰度', resource.title)
        }
        const downloadDir = deps.getDownloadDir()
        try {
          await mkdir(downloadDir, { recursive: true })
        } catch (error) {
          console.error('创建下载目录失败:', error)
          return failedSnapshot('write', '下载目录不可写', resource.title)
        }
        return await deps.downloader.download({
          resource,
          variant,
          downloadDir,
          reset: request.reset
        })
      } catch (error) {
        console.error('发起下载失败:', error)
        return failedSnapshot('unknown', '下载失败，请稍后重试')
      }
    }
  )

  ipcMain.handle(
    VIDEO_CHANNELS.resetDownload,
    async (): Promise<VideoDownloadSnapshot> => {
      try {
        return await deps.downloader.reset()
      } catch (error) {
        console.error('重置下载失败:', error)
        return deps.downloader.getSnapshot()
      }
    }
  )

  ipcMain.handle(VIDEO_CHANNELS.cancelDownload, (): void => {
    try {
      deps.downloader.cancel()
    } catch (error) {
      console.error('取消下载失败:', error)
    }
  })

  ipcMain.handle(VIDEO_CHANNELS.downloadState, (): VideoDownloadSnapshot => {
    try {
      return deps.downloader.getSnapshot()
    } catch (error) {
      console.error('读取下载快照失败:', error)
      return { status: 'idle' }
    }
  })

  ipcMain.handle(
    VIDEO_CHANNELS.transcriptStart,
    async (
      _event: Electron.IpcMainInvokeEvent,
      request: unknown
    ): Promise<VideoTranscriptSnapshot> => {
      try {
        return await deps.transcriptService.start(request)
      } catch (error) {
        console.error('启动口播提取失败:', error)
        return {
          status: 'failed',
          reason: 'unknown',
          message: videoErrorMessage('unknown')
        }
      }
    }
  )

  ipcMain.handle(VIDEO_CHANNELS.transcriptCancel, (): void => {
    try {
      deps.transcriptService.cancel()
    } catch (error) {
      console.error('取消口播提取失败:', error)
    }
  })

  ipcMain.handle(
    VIDEO_CHANNELS.transcriptState,
    (): VideoTranscriptSnapshot => {
      try {
        return deps.transcriptService.getSnapshot()
      } catch (error) {
        console.error('读取口播快照失败:', error)
        return { status: 'idle' }
      }
    }
  )

  ipcMain.handle(VIDEO_CHANNELS.engineGetSettings, (): VideoModuleSettings => {
    try {
      return withDownloadDir(deps.engineStore.get(), deps.getDownloadDir())
    } catch (error) {
      console.error('读取引擎设置失败:', error)
      return withDownloadDir(
        DEFAULT_VIDEO_MODULE_SETTINGS,
        deps.getDownloadDir()
      )
    }
  })

  ipcMain.handle(
    VIDEO_CHANNELS.engineUpdateSettings,
    (
      _event: Electron.IpcMainInvokeEvent,
      rawPatch: unknown
    ): VideoModuleSettings => {
      try {
        if (!isRecord(rawPatch)) {
          return withDownloadDir(deps.engineStore.get(), deps.getDownloadDir())
        }
        const next = deps.engineStore.update(
          rawPatch as Partial<VideoModuleSettings>
        )
        return withDownloadDir(next, deps.getDownloadDir())
      } catch (error) {
        console.error('更新引擎设置失败:', error)
        return withDownloadDir(
          DEFAULT_VIDEO_MODULE_SETTINGS,
          deps.getDownloadDir()
        )
      }
    }
  )

  ipcMain.handle(
    VIDEO_CHANNELS.engineProbe,
    async (): Promise<VideoEngineProbe> => {
      try {
        return await probeVideoEngine(deps.engineStore.get().engine, {
          resourcesDir: deps.resourcesDir
        })
      } catch (error) {
        console.error('探测本地引擎失败:', error)
        return {
          ok: false,
          binary: null,
          model: null,
          ffmpeg: null,
          message: '引擎探测失败，请稍后重试'
        }
      }
    }
  )

  ipcMain.handle(
    VIDEO_CHANNELS.pickFile,
    async (
      _event: Electron.IpcMainInvokeEvent,
      rawKind: unknown
    ): Promise<VideoPickResult> => {
      if (
        typeof rawKind !== 'string' ||
        !(PICK_KINDS as readonly string[]).includes(rawKind)
      ) {
        return { canceled: true }
      }
      const kind = rawKind as VideoPickKind
      try {
        const options = buildPickOptions(kind)
        const win = deps.getWindow()
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        const filePath = result.filePaths[0]
        if (result.canceled || filePath === undefined) {
          return { canceled: true }
        }
        return { canceled: false, path: filePath }
      } catch (error) {
        console.error('选择文件失败:', error)
        return { canceled: true }
      }
    }
  )

  ipcMain.handle(
    VIDEO_CHANNELS.openFile,
    async (
      _event: Electron.IpcMainInvokeEvent,
      rawPath: unknown
    ): Promise<VideoActionResult> => {
      const filePath = typeof rawPath === 'string' ? rawPath.trim() : ''
      if (filePath === '' || !isAbsolute(filePath)) {
        return { ok: false, error: '文件路径无效' }
      }
      if (!existsSync(filePath)) {
        return { ok: false, error: '文件不存在或已被删除' }
      }
      const extension = extname(filePath).toLowerCase()
      if (!OPENABLE_EXTENSIONS.includes(extension)) {
        return { ok: false, error: '不支持打开该类型的文件' }
      }
      try {
        const error = await shell.openPath(filePath)
        return error === '' ? { ok: true } : { ok: false, error }
      } catch (error) {
        console.error('打开文件失败:', error)
        return { ok: false, error: OPEN_FAILED_MESSAGE }
      }
    }
  )

  ipcMain.handle(
    VIDEO_CHANNELS.showInFolder,
    (_event: Electron.IpcMainInvokeEvent, rawPath: unknown): void => {
      try {
        const filePath = typeof rawPath === 'string' ? rawPath.trim() : ''
        if (filePath !== '' && existsSync(filePath)) {
          shell.showItemInFolder(filePath)
        }
      } catch (error) {
        console.error('定位文件失败:', error)
      }
    }
  )

  ipcMain.handle(
    VIDEO_CHANNELS.exportText,
    async (
      _event: Electron.IpcMainInvokeEvent,
      rawInput: unknown
    ): Promise<VideoExportResult> => {
      try {
        if (!isRecord(rawInput)) {
          return { canceled: true }
        }
        const text = typeof rawInput.text === 'string' ? rawInput.text : null
        const suggestedFileName =
          typeof rawInput.suggestedFileName === 'string'
            ? rawInput.suggestedFileName
            : null
        if (text === null || suggestedFileName === null) {
          return { canceled: true }
        }
        if (Buffer.byteLength(text, 'utf8') > MAX_EXPORT_TEXT_BYTES) {
          return { canceled: true }
        }
        const options: Electron.SaveDialogOptions = {
          title: '导出口播文本',
          defaultPath: join(
            deps.getDownloadDir(),
            toExportFileName(suggestedFileName)
          ),
          filters: [{ name: '文本文件', extensions: ['txt'] }]
        }
        const win = deps.getWindow()
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) {
          return { canceled: true }
        }
        await writeFile(result.filePath, text, 'utf8')
        return { canceled: false, filePath: result.filePath }
      } catch (error) {
        console.error('导出口播文本失败:', error)
        return { canceled: true }
      }
    }
  )
}
