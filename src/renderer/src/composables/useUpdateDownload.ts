import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type {
  OpenDownloadedResult,
  ReleaseAsset,
  UpdateDownloadErrorReason,
  UpdateDownloadProgress,
  UpdateDownloadResult,
  UpdateDownloadSnapshot
} from '@shared/update'

/** 诊断详情最大长度，避免异常信息刷屏 */
const MAX_DETAIL_LENGTH = 160

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

/** 安装包下载状态 */
export type UpdateDownloadState =
  | { status: 'idle' }
  | {
      status: 'downloading'
      progress: UpdateDownloadProgress | null
    }
  | { status: 'completed'; fileName: string; filePath: string }
  | {
      status: 'failed'
      reason: UpdateDownloadErrorReason
      /** 诊断详情：HTTP 状态码或底层错误信息，无详情为空串 */
      detail: string
    }

/** 下载失败原因到中文文案的映射 */
export const UPDATE_DOWNLOAD_ERROR_TEXT: Record<
  UpdateDownloadErrorReason,
  string
> = {
  network:
    '网络连接失败：无法访问 GitHub 下载服务器。若网络受限，' +
    '请开启代理后重试，或打开发行版页面手动下载',
  timeout: '下载超时：长时间未收到数据，请检查网络后重试',
  http: '下载服务器返回异常状态，请稍后重试或打开发行版页面手动下载',
  'invalid-asset': '安装包地址无效，请打开发行版页面手动下载',
  write: '安装包写入失败，请检查磁盘空间后重试',
  busy: '已有下载任务进行中，请稍候',
  unknown: '下载失败，请重试'
}

// 模块级共享状态：更新弹窗与全局下载提示共用同一份下载状态，弹窗关闭不重置
const state = ref<UpdateDownloadState>({ status: 'idle' })
let lastAsset: ReleaseAsset | null = null
let subscribed = false

const isDownloading = computed(() => state.value.status === 'downloading')

const progress = computed<UpdateDownloadProgress | null>(() => {
  const current = state.value
  return current.status === 'downloading' ? current.progress : null
})

const errorText = computed(() => {
  const current = state.value
  return current.status === 'failed'
    ? UPDATE_DOWNLOAD_ERROR_TEXT[current.reason]
    : ''
})

const errorDetail = computed(() => {
  const current = state.value
  return current.status === 'failed' ? current.detail : ''
})

/** 首次使用时订阅进度事件，重复调用不重复订阅，且不做取消订阅 */
function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  window.api.update.onDownloadProgress((next) => {
    if (state.value.status !== 'downloading') return
    state.value = { status: 'downloading', progress: next }
  })
}

/** 写入下载 Promise 的结果 */
function applyResult(result: UpdateDownloadResult): void {
  if (result.status === 'completed') {
    state.value = {
      status: 'completed',
      fileName: result.fileName,
      filePath: result.filePath
    }
    return
  }
  if (result.status === 'cancelled') {
    state.value = { status: 'idle' }
    return
  }
  state.value = {
    status: 'failed',
    reason: result.reason,
    detail: result.detail ?? ''
  }
}

const start = async (asset: ReleaseAsset): Promise<void> => {
  if (state.value.status === 'downloading') return
  // Vue 响应式 Proxy 无法通过 IPC 结构化克隆，必须先转成纯对象
  const payload: ReleaseAsset = {
    name: asset.name,
    size: asset.size,
    downloadUrl: asset.downloadUrl
  }
  lastAsset = payload
  ensureSubscribed()
  state.value = {
    status: 'downloading',
    progress: {
      fileName: payload.name,
      transferred: 0,
      total: payload.size,
      percent: 0
    }
  }
  try {
    applyResult(await window.api.update.download(payload))
  } catch (error) {
    state.value = {
      status: 'failed',
      reason: 'unknown',
      detail: detailFromError(error)
    }
  }
}

const cancel = async (): Promise<void> => {
  try {
    await window.api.update.cancelDownload()
  } catch {
    // 取消失败由下载 Promise 的 cancelled 结果收敛状态
  }
}

const retry = async (): Promise<void> => {
  if (lastAsset === null) return
  await start(lastAsset)
}

const openFile = async (filePath: string): Promise<OpenDownloadedResult> => {
  try {
    return await window.api.update.openDownloaded(filePath)
  } catch {
    return { status: 'failed' }
  }
}

const showInFolder = async (filePath: string): Promise<void> => {
  try {
    await window.api.update.showInFolder(filePath)
  } catch {
    // 打开文件夹失败无需反馈，静默忽略
  }
}

const reset = (): void => {
  if (state.value.status === 'downloading') return
  state.value = { status: 'idle' }
}

const sync = async (asset?: ReleaseAsset | null): Promise<void> => {
  let snapshot: UpdateDownloadSnapshot
  try {
    snapshot = await window.api.update.getDownloadState()
  } catch {
    // 查询失败不影响弹窗展示，保持现有状态
    return
  }
  if (snapshot.status === 'idle') return
  if (snapshot.status === 'downloading') {
    ensureSubscribed()
    lastAsset = { ...snapshot.asset }
    state.value = { status: 'downloading', progress: snapshot.progress }
    return
  }
  // 已完成 / 失败结果仅在属于当前选中安装包时恢复，避免带出旧版本结果
  if (!asset || snapshot.asset.name !== asset.name) return
  lastAsset = { ...snapshot.asset }
  if (snapshot.status === 'completed') {
    state.value = {
      status: 'completed',
      fileName: snapshot.fileName,
      filePath: snapshot.filePath
    }
    return
  }
  state.value = {
    status: 'failed',
    reason: snapshot.reason,
    detail: snapshot.detail ?? ''
  }
}

/** 仅测试使用：强制清空模块级共享状态 */
export function resetUpdateDownloadStateForTests(): void {
  state.value = { status: 'idle' }
  lastAsset = null
  subscribed = false
}

interface UseUpdateDownload {
  /** 当前下载状态 */
  state: Ref<UpdateDownloadState>
  /** 是否正在下载 */
  isDownloading: ComputedRef<boolean>
  /** 当前下载进度，非下载中为 null */
  progress: ComputedRef<UpdateDownloadProgress | null>
  /** 失败原因对应的中文文案，非失败态为空串 */
  errorText: ComputedRef<string>
  /** 失败诊断详情，非失败态或无详情为空串 */
  errorDetail: ComputedRef<string>
  /** 开始下载指定安装包，下载中重复调用直接返回 */
  start: (asset: ReleaseAsset) => Promise<void>
  /** 取消当前下载，异常静默 */
  cancel: () => Promise<void>
  /** 重新下载最近一次选择过的安装包 */
  retry: () => Promise<void>
  /** 打开已下载的安装包，异常收敛为 failed */
  openFile: (filePath: string) => Promise<OpenDownloadedResult>
  /** 在文件管理器中显示安装包，异常静默 */
  showInFolder: (filePath: string) => Promise<void>
  /** 非下载中时重置为 idle */
  reset: () => void
  /** 从主进程快照恢复下载状态，异常静默 */
  sync: (asset?: ReleaseAsset | null) => Promise<void>
}

/**
 * 下载安装包 composable：封装 IPC 调用、下载进度与结果状态。
 * 状态提升为模块级共享，只维护纯状态，不触发 Toast 或弹窗。
 */
export function useUpdateDownload(): UseUpdateDownload {
  return {
    state,
    isDownloading,
    progress,
    errorText,
    errorDetail,
    start,
    cancel,
    retry,
    openFile,
    showInFolder,
    reset,
    sync
  }
}
