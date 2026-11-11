import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import {
  DEFAULT_VIDEO_MODULE_SETTINGS,
  sanitizeVideoFileName,
  videoErrorMessage
} from '@shared/video'
import type {
  VideoDownloadProgress,
  VideoDownloadSnapshot,
  VideoEngineProbe,
  VideoImageDownloadProgress,
  VideoImageDownloadSnapshot,
  VideoModuleSettings,
  VideoPickKind,
  VideoResource,
  VideoTranscriptSnapshot,
  VideoVariant
} from '@shared/video'

/** 短视频子模块标识 */
export type VideoSubModuleId = 'parse' | 'transcript'

/** 口播目标文件来源：本地选择 / 解析下载带入 */
export type TranscriptSource = 'local' | 'download'

/** 口播目标文件 */
export interface TranscriptTarget {
  filePath: string
  fileName: string
  source: TranscriptSource
}

/** 诊断详情最大长度，避免底层错误刷屏 */
const MAX_DETAIL_LENGTH = 160

/** 复制成功提示保留时长 */
const COPY_RESET_MS = 3000

/** 未粘贴链接时的提示 */
const EMPTY_INPUT_MESSAGE = '请先粘贴分享链接'

/** 未选择口播目标文件时的提示 */
const TARGET_REQUIRED_MESSAGE = '请先选择视频文件'

/** 口播任务开始的乐观阶段文案 */
const EXTRACTING_MESSAGE = '正在抽取音轨…'

/** 异常转诊断详情：取 message，压缩空白并限长 */
function detailFromError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  return trimmed === '' ? '' : trimmed.slice(0, MAX_DETAIL_LENGTH)
}

/** 从路径取文件名，兼容 Windows 与 POSIX 分隔符 */
function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

/** 默认模块设置的深拷贝，避免调用方误改共享常量 */
function defaultSettings(): VideoModuleSettings {
  return {
    engine: { ...DEFAULT_VIDEO_MODULE_SETTINGS.engine },
    downloadDir: DEFAULT_VIDEO_MODULE_SETTINGS.downloadDir
  }
}

/**
 * 快照是否属于当前资源：下载快照不带 resourceId，
 * 用标题匹配，避免解析新链接后带出上一个资源的下载结果。
 */
function snapshotBelongsTo(
  snapshot: VideoDownloadSnapshot,
  resource: VideoResource
): boolean {
  if (snapshot.status === 'idle') return false
  if (snapshot.status === 'failed') {
    return snapshot.title !== undefined && snapshot.title === resource.title
  }
  return snapshot.title === resource.title
}

/** 图集快照同样按标题归属到当前资源，避免带出上一个资源的下载结果 */
function imageSnapshotBelongsTo(
  snapshot: VideoImageDownloadSnapshot,
  target: VideoResource
): boolean {
  return snapshot.status !== 'idle' && snapshot.title === target.title
}

// 模块级共享状态：面板与子组件共享同一份解析 / 下载 / 口播 / 引擎状态
const input = ref('')
const parsing = ref(false)
const resource = ref<VideoResource | null>(null)
const parseError = ref<string | null>(null)
const selectedVariantId = ref('')
const downloadSnapshot = ref<VideoDownloadSnapshot>({ status: 'idle' })
const imageDownloadSnapshot = ref<VideoImageDownloadSnapshot>({
  status: 'idle'
})
const transcriptSnapshot = ref<VideoTranscriptSnapshot>({ status: 'idle' })
const transcriptText = ref('')
const engineSettings = ref<VideoModuleSettings>(defaultSettings())
const engineProbe = ref<VideoEngineProbe | null>(null)
const engineProbing = ref(false)
const copied = ref(false)
const exporting = ref(false)
const exportNotice = ref<string | null>(null)
const actionError = ref<string | null>(null)
const transcriptTarget = ref<TranscriptTarget | null>(null)
const subModule = ref<VideoSubModuleId>('parse')

/** 解析请求序号，丢弃过期响应 */
let parseToken = 0

/** 下载 / 图集 / 口播请求序号，切换资源后丢弃旧任务的结果与推送 */
let downloadToken = 0
let imageDownloadToken = 0
let transcriptToken = 0

/** 当前口播任务对应的视频文件名，用于过滤其他文件的状态推送 */
let activeTranscriptFileName: string | null = null

/** 用户是否手动编辑过口播文本，编辑后不被识别结果覆盖 */
let transcriptDirty = false

/** 复制提示复位定时器 */
let copyTimer: ReturnType<typeof setTimeout> | null = null

const selectedVariant = computed<VideoVariant | null>(() => {
  const current = resource.value
  if (current === null) return null
  return (
    current.variants.find((item) => item.id === selectedVariantId.value) ?? null
  )
})

const downloadProgress = computed<VideoDownloadProgress | null>(() => {
  const current = downloadSnapshot.value
  return current.status === 'downloading' ? current.progress : null
})

const downloadCompleted = computed<boolean>(
  () => downloadSnapshot.value.status === 'completed'
)

const imageDownloading = computed<boolean>(
  () => imageDownloadSnapshot.value.status === 'downloading'
)

const imageDownloadCompleted = computed<boolean>(
  () => imageDownloadSnapshot.value.status === 'completed'
)

const imageDownloadFailed = computed<boolean>(
  () => imageDownloadSnapshot.value.status === 'failed'
)

const imageDownloadProgress = computed<VideoImageDownloadProgress | null>(
  () => {
    const current = imageDownloadSnapshot.value
    return current.status === 'downloading' ? current.progress : null
  }
)

const transcriptBusy = computed<boolean>(
  () => transcriptSnapshot.value.status === 'running'
)

/** 清空解析之外的资源状态，开始新一轮解析时调用 */
function resetResourceState(): void {
  downloadToken += 1
  imageDownloadToken += 1
  transcriptToken += 1
  activeTranscriptFileName = null
  resource.value = null
  selectedVariantId.value = ''
  downloadSnapshot.value = { status: 'idle' }
  imageDownloadSnapshot.value = { status: 'idle' }
  transcriptSnapshot.value = { status: 'idle' }
  transcriptText.value = ''
  transcriptDirty = false
  actionError.value = null
  exportNotice.value = null
}

/** 应用口播快照：完成时仅在用户未编辑的情况下填充原文 */
function applyTranscriptSnapshot(snapshot: VideoTranscriptSnapshot): void {
  transcriptSnapshot.value = snapshot
  if (snapshot.status === 'completed' && !transcriptDirty) {
    transcriptText.value = snapshot.text
  }
}

/** 读取主进程下载 / 口播快照，恢复同一资源的任务状态 */
async function restoreSnapshots(
  target: VideoResource,
  token: number
): Promise<void> {
  let download: VideoDownloadSnapshot | null = null
  try {
    download = await window.api.video.getDownloadState()
  } catch {
    download = null
  }
  if (token !== parseToken) return
  if (download !== null && snapshotBelongsTo(download, target)) {
    downloadSnapshot.value = download
  }

  await restoreImageDownloadState()
  if (token !== parseToken) return

  let transcript: VideoTranscriptSnapshot | null = null
  try {
    transcript = await window.api.video.getTranscriptState()
  } catch {
    transcript = null
  }
  if (token !== parseToken || transcript === null) return

  // 只与真正归属当前资源的下载快照关联，避免恢复其他资源的口播
  const restoredDownload = downloadSnapshot.value
  const sameDownloadedFile =
    transcript.status === 'completed' &&
    restoredDownload.status === 'completed' &&
    transcript.fileName === restoredDownload.fileName
  const runningWithDownload =
    transcript.status === 'running' && restoredDownload.status === 'downloading'

  if (
    sameDownloadedFile &&
    transcript.status === 'completed' &&
    restoredDownload.status === 'completed'
  ) {
    activeTranscriptFileName = transcript.fileName
    transcriptDirty = false
    applyTranscriptSnapshot(transcript)
  } else if (runningWithDownload && restoredDownload.status === 'downloading') {
    activeTranscriptFileName = restoredDownload.fileName
    transcriptSnapshot.value = transcript
  }
}

/** 解析分享链接；失败时保留输入，成功时默认选中最高清晰度 */
const parse = async (text?: string): Promise<void> => {
  if (typeof text === 'string') {
    input.value = text
  }
  parseToken += 1
  const token = parseToken
  const raw = input.value.trim()
  if (raw === '') {
    parsing.value = false
    parseError.value = EMPTY_INPUT_MESSAGE
    return
  }

  parseError.value = null
  // 主进程下载器与识别服务同一时刻只处理一个任务，解析新链接前先取消旧任务，
  // 避免旧任务在后台继续运行并导致新任务始终返回 busy。
  if (downloadSnapshot.value.status === 'downloading') {
    void window.api.video.cancelDownload().catch(() => undefined)
  }
  if (imageDownloadSnapshot.value.status === 'downloading') {
    void window.api.video.cancelImageDownload().catch(() => undefined)
  }
  if (transcriptSnapshot.value.status === 'running') {
    void window.api.video.cancelTranscript().catch(() => undefined)
  }
  resetResourceState()
  parsing.value = true
  try {
    const result = await window.api.video.parse(raw)
    if (token !== parseToken) return
    if (!result.ok) {
      parseError.value =
        result.message.trim() === ''
          ? videoErrorMessage(result.reason)
          : result.message
      return
    }
    resource.value = result.resource
    const best = [...result.resource.variants].sort(
      (left, right) => right.qualityRank - left.qualityRank
    )[0]
    selectedVariantId.value = best?.id ?? ''
    await restoreSnapshots(result.resource, token)
  } catch {
    if (token === parseToken) {
      parseError.value = '解析失败，请稍后重试'
    }
  } finally {
    if (token === parseToken) {
      parsing.value = false
    }
  }
}

/** 清空输入与错误提示，并取消进行中的任务、复位结果展示 */
const clearInput = (): void => {
  input.value = ''
  parseError.value = null
  if (downloadSnapshot.value.status === 'downloading') {
    void window.api.video.cancelDownload().catch(() => undefined)
  }
  if (imageDownloadSnapshot.value.status === 'downloading') {
    void window.api.video.cancelImageDownload().catch(() => undefined)
  }
  if (transcriptSnapshot.value.status === 'running') {
    void window.api.video.cancelTranscript().catch(() => undefined)
  }
  resetResourceState()
}

/** 切换清晰度：清空当前资源的下载 / 口播展示，避免档位错配 */
const selectVariant = (variantId: string): void => {
  const current = resource.value
  if (current === null || downloadSnapshot.value.status === 'downloading') {
    return
  }
  const variant = current.variants.find((item) => item.id === variantId)
  if (variant === undefined || variant.id === selectedVariantId.value) return
  downloadToken += 1
  transcriptToken += 1
  activeTranscriptFileName = null
  selectedVariantId.value = variant.id
  downloadSnapshot.value = { status: 'idle' }
  transcriptSnapshot.value = { status: 'idle' }
  transcriptText.value = ''
  transcriptDirty = false
  actionError.value = null
  exportNotice.value = null
}

/** 下载完成后同步主进程已有的口播结果，避免重复识别 */
async function syncTranscriptAfterDownload(
  completed: Extract<VideoDownloadSnapshot, { status: 'completed' }>
): Promise<void> {
  try {
    const state = await window.api.video.getTranscriptState()
    if (state.status === 'completed' && state.fileName === completed.fileName) {
      activeTranscriptFileName = state.fileName
      applyTranscriptSnapshot(state)
    }
  } catch {
    // 口播快照读取失败不影响下载结果展示
  }
}

/** 发起下载 / 续传；reset 为 true 时清理半成品重新下载 */
const download = async (reset = false): Promise<void> => {
  const current = resource.value
  const variant = selectedVariant.value
  if (current === null || variant === null) {
    downloadSnapshot.value = {
      status: 'failed',
      reason: 'empty',
      detail: '请先解析资源并选择清晰度',
      resumable: false
    }
    return
  }
  if (downloadSnapshot.value.status === 'downloading') return

  downloadToken += 1
  const token = downloadToken
  transcriptToken += 1
  activeTranscriptFileName = null
  actionError.value = null
  exportNotice.value = null
  transcriptSnapshot.value = { status: 'idle' }
  transcriptText.value = ''
  transcriptDirty = false

  // 先写乐观快照，进度事件才能落在下载中状态上
  const container = variant.container === 'unknown' ? 'mp4' : variant.container
  const optimisticFileName = sanitizeVideoFileName(
    `${current.title}.${container}`,
    current.title
  )
  downloadSnapshot.value = {
    status: 'downloading',
    title: current.title,
    fileName: optimisticFileName,
    progress: {
      fileName: optimisticFileName,
      transferred: 0,
      total: variant.size ?? 0,
      percent: 0,
      speedBytesPerSec: 0,
      remainingMs: null
    }
  }

  try {
    const snapshot = await window.api.video.download({
      resourceId: current.id,
      variantId: variant.id,
      reset
    })
    if (token !== downloadToken || resource.value?.id !== current.id) return
    downloadSnapshot.value = snapshot
    if (snapshot.status === 'completed') {
      setTranscriptTarget({
        filePath: snapshot.filePath,
        fileName: snapshot.fileName,
        source: 'download'
      })
      await syncTranscriptAfterDownload(snapshot)
    }
  } catch (error) {
    if (token !== downloadToken || resource.value?.id !== current.id) return
    downloadSnapshot.value = {
      status: 'failed',
      reason: 'unknown',
      detail: detailFromError(error),
      resumable: true
    }
  }
}

/** 取消下载，保留半成品；最终状态由下载 Promise 的返回值收敛 */
const cancelDownload = async (): Promise<void> => {
  if (downloadSnapshot.value.status !== 'downloading') return
  try {
    await window.api.video.cancelDownload()
  } catch {
    // 取消失败由下载 Promise 的最终快照收敛
  }
}

/** 清理半成品并重置下载状态 */
const resetDownload = async (): Promise<void> => {
  actionError.value = null
  downloadToken += 1
  transcriptToken += 1
  activeTranscriptFileName = null
  try {
    const snapshot = await window.api.video.resetDownload()
    downloadSnapshot.value = snapshot
    transcriptSnapshot.value = { status: 'idle' }
    transcriptText.value = ''
    transcriptDirty = false
    exportNotice.value = null
  } catch {
    actionError.value = '重置下载失败，请稍后重试'
  }
}

/** 用系统默认程序打开已下载视频 */
const openDownloaded = async (): Promise<void> => {
  const current = downloadSnapshot.value
  if (current.status !== 'completed') return
  actionError.value = null
  try {
    const result = await window.api.video.openFile(current.filePath)
    if (!result.ok) {
      actionError.value = result.error ?? '打开文件失败'
    }
  } catch {
    actionError.value = '打开文件失败'
  }
}

/** 在文件管理器中定位已下载视频 */
const showInFolder = async (): Promise<void> => {
  const current = downloadSnapshot.value
  if (current.status !== 'completed') return
  try {
    await window.api.video.showInFolder(current.filePath)
  } catch {
    actionError.value = '无法在文件夹中显示该文件'
  }
}

/** 读取主进程图集快照，恢复页面打开或重新解析后的下载状态 */
const restoreImageDownloadState = async (): Promise<void> => {
  const target = resource.value
  if (target === null) return
  const token = imageDownloadToken
  let snapshot: VideoImageDownloadSnapshot | null = null
  try {
    snapshot = await window.api.video.getImageDownloadState()
  } catch {
    snapshot = null
  }
  if (token !== imageDownloadToken) return
  if (snapshot === null || !imageSnapshotBelongsTo(snapshot, target)) return
  imageDownloadSnapshot.value = snapshot
}

/** 下载图文笔记的全部图片 */
const startImageDownload = async (): Promise<void> => {
  const current = resource.value
  if (current === null) {
    imageDownloadSnapshot.value = {
      status: 'failed',
      title: '',
      reason: 'empty',
      detail: '请先解析图文资源'
    }
    return
  }
  if (imageDownloadSnapshot.value.status === 'downloading') return

  imageDownloadToken += 1
  const token = imageDownloadToken
  actionError.value = null
  // 先写乐观快照，进度推送才能落在下载中状态上
  imageDownloadSnapshot.value = {
    status: 'downloading',
    title: current.title,
    directory: '',
    progress: {
      completed: 0,
      total: current.images.length,
      currentFileName: '',
      percent: 0
    }
  }

  try {
    const snapshot = await window.api.video.downloadImages({
      resourceId: current.id
    })
    if (token !== imageDownloadToken || resource.value?.id !== current.id) {
      return
    }
    imageDownloadSnapshot.value = snapshot
  } catch (error) {
    if (token !== imageDownloadToken || resource.value?.id !== current.id) {
      return
    }
    imageDownloadSnapshot.value = {
      status: 'failed',
      title: current.title,
      reason: 'unknown',
      detail: detailFromError(error)
    }
  }
}

/** 取消图集下载，保留已写入的图片，最终状态由任务返回值收敛 */
const cancelImageDownload = async (): Promise<void> => {
  if (imageDownloadSnapshot.value.status !== 'downloading') return
  try {
    await window.api.video.cancelImageDownload()
  } catch {
    // 取消失败由下载 Promise 的最终快照收敛
  }
  await restoreImageDownloadState()
}

/** 打开图集所在目录 */
const openImageDirectory = async (): Promise<void> => {
  const current = imageDownloadSnapshot.value
  if (current.status !== 'completed') return
  actionError.value = null
  try {
    await window.api.video.openDirectory(current.directory)
  } catch {
    actionError.value = '打开文件夹失败'
  }
}

/** 设置口播目标文件，供口播子模块带入 */
function setTranscriptTarget(target: TranscriptTarget | null): void {
  transcriptTarget.value =
    target === null || target.filePath.trim() === '' ? null : target
}

/** 切换子模块（解析下载 / 口播提取） */
function setSubModule(id: VideoSubModuleId): void {
  subModule.value = id
}

/**
 * 弹出文件选择框选择口播目标文件；
 * 取消或失败时保留原目标不变。
 */
const pickTranscriptFile = async (): Promise<void> => {
  let result: Awaited<ReturnType<typeof window.api.video.pickFile>>
  try {
    result = await window.api.video.pickFile('media')
  } catch {
    return
  }
  if (result.canceled) return
  const filePath = result.path?.trim() ?? ''
  if (filePath === '') return
  setTranscriptTarget({
    filePath,
    fileName: fileNameFromPath(filePath),
    source: 'local'
  })
}

/**
 * 恢复主进程口播快照：
 * 完成且带 filePath 时带入目标并应用文本，运行中采纳状态，其余不改动。
 */
const restoreTranscriptState = async (): Promise<void> => {
  let state: VideoTranscriptSnapshot | null = null
  try {
    state = await window.api.video.getTranscriptState()
  } catch {
    state = null
  }
  if (state === null) return

  if (state.status === 'completed') {
    const filePath = state.filePath?.trim() ?? ''
    if (filePath !== '') {
      const current = transcriptTarget.value
      if (current === null || current.filePath !== filePath) {
        setTranscriptTarget({
          filePath,
          fileName: state.fileName,
          source: 'download'
        })
      }
      activeTranscriptFileName = state.fileName
      applyTranscriptSnapshot(state)
    }
    return
  }

  if (state.status === 'running') {
    activeTranscriptFileName = transcriptTarget.value?.fileName ?? null
    transcriptSnapshot.value = state
  }
}

/** 开始口播提取：优先使用参数路径，其次当前目标文件 */
const transcriptStart = async (path?: string): Promise<void> => {
  if (transcriptSnapshot.value.status === 'running') return

  const target = transcriptTarget.value
  const filePath = path ?? target?.filePath ?? ''
  if (filePath.trim() === '') {
    activeTranscriptFileName = null
    transcriptSnapshot.value = {
      status: 'failed',
      reason: 'unknown',
      message: TARGET_REQUIRED_MESSAGE
    }
    return
  }

  const fileName =
    target !== null && target.filePath === filePath
      ? target.fileName
      : fileNameFromPath(filePath)
  transcriptToken += 1
  const token = transcriptToken
  activeTranscriptFileName = fileName
  exportNotice.value = null
  transcriptDirty = false
  transcriptText.value = ''
  transcriptSnapshot.value = {
    status: 'running',
    stage: 'extracting',
    message: EXTRACTING_MESSAGE
  }

  try {
    const snapshot = await window.api.video.startTranscript({ filePath })
    if (token !== transcriptToken) return
    applyTranscriptSnapshot(snapshot)
  } catch (error) {
    if (token !== transcriptToken) return
    transcriptSnapshot.value = {
      status: 'failed',
      reason: 'unknown',
      message: videoErrorMessage('unknown'),
      detail: detailFromError(error)
    }
  }
}

/** 取消口播提取，最终状态由快照推送收敛 */
const transcriptCancel = async (): Promise<void> => {
  if (transcriptSnapshot.value.status !== 'running') return
  try {
    await window.api.video.cancelTranscript()
  } catch {
    // 取消失败由快照推送收敛
  }
}

/** 用户编辑口播文本：标记 dirty，完成事件不再覆盖 */
const updateTranscriptText = (value: string): void => {
  transcriptText.value = value
  transcriptDirty = true
}

/** 导出口播文本为 .txt */
const exportTranscript = async (): Promise<void> => {
  if (exporting.value) return
  const text = transcriptText.value
  if (text.trim() === '') {
    exportNotice.value = '暂无可导出的文本'
    return
  }
  exporting.value = true
  exportNotice.value = null
  try {
    const title = resource.value?.title.trim() || '口播文本'
    const result = await window.api.video.exportText({
      text,
      suggestedFileName: `${title}-口播.txt`
    })
    if (result.canceled) {
      exportNotice.value = '已取消导出'
    } else {
      exportNotice.value = result.filePath
        ? `已导出到 ${result.filePath}`
        : '已导出'
    }
  } catch {
    exportNotice.value = '导出失败，请稍后重试'
  } finally {
    exporting.value = false
  }
}

/** 复制口播文本，3 秒后复位复制反馈 */
const copyTranscript = async (): Promise<void> => {
  const text = transcriptText.value
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    if (copyTimer !== null) {
      clearTimeout(copyTimer)
    }
    copyTimer = setTimeout(() => {
      copied.value = false
      copyTimer = null
    }, COPY_RESET_MS)
  } catch {
    exportNotice.value = '复制失败，请手动选择文本复制'
  }
}

/** 读取引擎配置；失败时保持默认值 */
const loadEngine = async (): Promise<void> => {
  try {
    engineSettings.value = await window.api.video.getEngineSettings()
  } catch {
    // 读取失败时使用默认配置，不阻塞界面
  }
}

/** 探测本地引擎，结果写入 engineProbe */
const probeEngine = async (): Promise<void> => {
  if (engineProbing.value) return
  engineProbing.value = true
  engineProbe.value = null
  try {
    engineProbe.value = await window.api.video.probeEngine()
  } catch {
    engineProbe.value = {
      ok: false,
      binary: null,
      model: null,
      ffmpeg: null,
      message: '引擎探测失败，请稍后重试'
    }
  } finally {
    engineProbing.value = false
  }
}

/** 合并保存引擎与下载目录设置，成功返回 true */
const updateEngineSettings = async (
  patch: Partial<VideoModuleSettings>
): Promise<boolean> => {
  const current = engineSettings.value
  const next: VideoModuleSettings = {
    engine: { ...current.engine, ...patch.engine },
    downloadDir:
      typeof patch.downloadDir === 'string'
        ? patch.downloadDir
        : current.downloadDir
  }
  try {
    engineSettings.value = await window.api.video.updateEngineSettings(next)
    return true
  } catch {
    return false
  }
}

/** 弹出文件选择框，取消或失败返回 null */
const pickEnginePath = async (kind: VideoPickKind): Promise<string | null> => {
  try {
    const result = await window.api.video.pickFile(kind)
    return result.canceled ? null : (result.path ?? null)
  } catch {
    return null
  }
}

/** 订阅下载进度：只更新下载中快照的进度 */
const subscribeDownload = (): (() => void) => {
  try {
    return window.api.video.onDownloadProgress((progress) => {
      const current = downloadSnapshot.value
      if (current.status !== 'downloading') return
      downloadSnapshot.value = { ...current, progress }
    })
  } catch {
    return () => undefined
  }
}

/** 订阅图集下载推送：只接收归属当前资源的快照 */
const subscribeImageDownload = (): (() => void) => {
  try {
    return window.api.video.onImageDownloadProgress((snapshot) => {
      const current = resource.value
      if (current === null || snapshot.status === 'idle') return
      if (snapshot.title !== current.title) return
      imageDownloadSnapshot.value = snapshot
    })
  } catch {
    return () => undefined
  }
}

/** 订阅口播状态推送，返回取消订阅函数 */
const subscribeTranscript = (): (() => void) => {
  try {
    return window.api.video.onTranscriptState((state) => {
      const current = transcriptSnapshot.value
      if (state.status === 'completed') {
        if (state.fileName !== activeTranscriptFileName) return
      } else if (current.status !== 'running') {
        // 进行中 / 失败 / 复位推送只接受当前正在执行的任务
        return
      }
      applyTranscriptSnapshot(state)
    })
  } catch {
    return () => undefined
  }
}

interface UseVideo {
  /** 分享文本输入 */
  input: Ref<string>
  /** 解析进行中 */
  parsing: Ref<boolean>
  /** 解析结果 */
  resource: Ref<VideoResource | null>
  /** 解析错误文案 */
  parseError: Ref<string | null>
  /** 当前选中的清晰度 id */
  selectedVariantId: Ref<string>
  /** 当前选中的清晰度档位 */
  selectedVariant: ComputedRef<VideoVariant | null>
  /** 下载状态快照 */
  downloadSnapshot: Ref<VideoDownloadSnapshot>
  /** 下载中实时进度，非下载中为 null */
  downloadProgress: ComputedRef<VideoDownloadProgress | null>
  /** 是否已下载完成 */
  downloadCompleted: ComputedRef<boolean>
  /** 图集下载状态快照 */
  imageDownloadSnapshot: Ref<VideoImageDownloadSnapshot>
  /** 图集下载中实时进度，非下载中为 null */
  imageDownloadProgress: ComputedRef<VideoImageDownloadProgress | null>
  /** 图集是否正在下载 */
  imageDownloading: ComputedRef<boolean>
  /** 图集是否下载完成 */
  imageDownloadCompleted: ComputedRef<boolean>
  /** 图集是否下载失败 */
  imageDownloadFailed: ComputedRef<boolean>
  /** 口播状态快照 */
  transcriptSnapshot: Ref<VideoTranscriptSnapshot>
  /** 口播文本，双向可编辑 */
  transcriptText: Ref<string>
  /** 口播任务是否进行中 */
  transcriptBusy: ComputedRef<boolean>
  /** 引擎与下载目录设置 */
  engineSettings: Ref<VideoModuleSettings>
  /** 引擎探测结果 */
  engineProbe: Ref<VideoEngineProbe | null>
  /** 引擎探测进行中 */
  engineProbing: Ref<boolean>
  /** 复制成功反馈 */
  copied: Ref<boolean>
  /** 导出进行中 */
  exporting: Ref<boolean>
  /** 最近一次导出 / 操作提示 */
  exportNotice: Ref<string | null>
  /** 打开文件等操作错误 */
  actionError: Ref<string | null>
  /** 口播目标文件，null 表示尚未选择 */
  transcriptTarget: Ref<TranscriptTarget | null>
  /** 当前短视频子模块 */
  subModule: Ref<VideoSubModuleId>
  parse: (text?: string) => Promise<void>
  clearInput: () => void
  selectVariant: (variantId: string) => void
  download: (reset?: boolean) => Promise<void>
  cancelDownload: () => Promise<void>
  resetDownload: () => Promise<void>
  openDownloaded: () => Promise<void>
  showInFolder: () => Promise<void>
  startImageDownload: () => Promise<void>
  cancelImageDownload: () => Promise<void>
  openImageDirectory: () => Promise<void>
  restoreImageDownloadState: () => Promise<void>
  transcriptStart: (path?: string) => Promise<void>
  transcriptCancel: () => Promise<void>
  updateTranscriptText: (value: string) => void
  exportTranscript: () => Promise<void>
  copyTranscript: () => Promise<void>
  setTranscriptTarget: (target: TranscriptTarget | null) => void
  pickTranscriptFile: () => Promise<void>
  restoreTranscriptState: () => Promise<void>
  setSubModule: (id: VideoSubModuleId) => void
  loadEngine: () => Promise<void>
  probeEngine: () => Promise<void>
  updateEngineSettings: (
    patch: Partial<VideoModuleSettings>
  ) => Promise<boolean>
  pickEnginePath: (kind: VideoPickKind) => Promise<string | null>
  subscribeDownload: () => () => void
  subscribeImageDownload: () => () => void
  subscribeTranscript: () => () => void
}

/** 短视频模块 composable，共享模块级状态 */
export function useVideo(): UseVideo {
  return {
    input,
    parsing,
    resource,
    parseError,
    selectedVariantId,
    selectedVariant,
    downloadSnapshot,
    downloadProgress,
    downloadCompleted,
    imageDownloadSnapshot,
    imageDownloadProgress,
    imageDownloading,
    imageDownloadCompleted,
    imageDownloadFailed,
    transcriptSnapshot,
    transcriptText,
    transcriptBusy,
    engineSettings,
    engineProbe,
    engineProbing,
    copied,
    exporting,
    exportNotice,
    actionError,
    transcriptTarget,
    subModule,
    parse,
    clearInput,
    selectVariant,
    download,
    cancelDownload,
    resetDownload,
    openDownloaded,
    showInFolder,
    startImageDownload,
    cancelImageDownload,
    openImageDirectory,
    restoreImageDownloadState,
    transcriptStart,
    transcriptCancel,
    updateTranscriptText,
    exportTranscript,
    copyTranscript,
    setTranscriptTarget,
    pickTranscriptFile,
    restoreTranscriptState,
    setSubModule,
    loadEngine,
    probeEngine,
    updateEngineSettings,
    pickEnginePath,
    subscribeDownload,
    subscribeImageDownload,
    subscribeTranscript
  }
}
