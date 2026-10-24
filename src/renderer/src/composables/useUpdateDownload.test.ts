import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UpdateDownloadResult,
  UpdateDownloadSnapshot
} from '../../../shared/update'
import {
  resetUpdateDownloadStateForTests,
  useUpdateDownload
} from './useUpdateDownload'

/** 模拟的下载调用，用例内按需覆写返回值 */
const download = vi.fn<(asset: unknown) => Promise<UpdateDownloadResult>>()

/** 模拟的下载状态快照查询，用例内按需覆写返回值 */
const getDownloadState = vi.fn<() => Promise<UpdateDownloadSnapshot>>()

/** 模拟 preload 暴露的 update API */
function stubUpdateApi(): void {
  vi.stubGlobal('window', {
    api: {
      update: {
        download,
        getDownloadState,
        onDownloadProgress: () => () => undefined,
        cancelDownload: async () => undefined,
        openDownloaded: async () => ({ status: 'opened' }),
        showInFolder: async () => undefined
      }
    }
  })
}

/** 当前系统对应的安装包 */
const ASSET = {
  name: 'app-setup.exe',
  size: 1024,
  downloadUrl:
    'https://github.com/BigCleverXu/office-software/releases/download/' +
    'v2.4.0/app-setup.exe'
}

beforeEach(() => {
  download.mockReset()
  getDownloadState.mockReset()
  getDownloadState.mockResolvedValue({ status: 'idle' })
  resetUpdateDownloadStateForTests()
  stubUpdateApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useUpdateDownload IPC 参数', () => {
  it('响应式资产转为纯对象后再传给 IPC', async () => {
    download.mockResolvedValue({ status: 'cancelled' })
    const asset = reactive({ ...ASSET, extra: 'ignored' })
    const { start } = useUpdateDownload()

    await start(asset)

    expect(download).toHaveBeenCalledTimes(1)
    const payload = download.mock.calls[0]?.[0]
    expect(payload).toEqual(ASSET)
    // 回归本次根因：Proxy 不能被结构化克隆
    expect(() => structuredClone(payload)).not.toThrow()
  })
})

describe('useUpdateDownload 失败展示', () => {
  it('透传主进程返回的原因与诊断详情', async () => {
    download.mockResolvedValue({
      status: 'failed',
      reason: 'http',
      detail: 'HTTP 404'
    })
    const { start, state, errorText, errorDetail } = useUpdateDownload()

    await start({ ...ASSET })

    expect(state.value).toEqual({
      status: 'failed',
      reason: 'http',
      detail: 'HTTP 404'
    })
    expect(errorText.value).toContain('下载服务器返回异常状态')
    expect(errorDetail.value).toBe('HTTP 404')
  })

  it('IPC 调用自身失败时保留异常信息', async () => {
    download.mockRejectedValue(new Error('An object could not be cloned.'))
    const { start, state, errorDetail } = useUpdateDownload()

    await start({ ...ASSET })

    expect(state.value).toMatchObject({
      status: 'failed',
      reason: 'unknown'
    })
    expect(errorDetail.value).toBe('An object could not be cloned.')
  })
})

describe('useUpdateDownload 从主进程快照恢复', () => {
  it('快照为 downloading 时恢复进度', async () => {
    const progress = {
      fileName: 'app-setup.exe',
      transferred: 512,
      total: 1024,
      percent: 50
    }
    getDownloadState.mockResolvedValue({
      status: 'downloading',
      asset: { ...ASSET },
      progress
    })
    const {
      sync,
      state,
      isDownloading,
      progress: currentProgress
    } = useUpdateDownload()

    await sync()

    expect(state.value).toEqual({ status: 'downloading', progress })
    expect(isDownloading.value).toBe(true)
    expect(currentProgress.value).toEqual(progress)
  })

  it('快照为 completed 且资产同名时恢复完成状态', async () => {
    getDownloadState.mockResolvedValue({
      status: 'completed',
      asset: { ...ASSET },
      fileName: 'app-setup.exe',
      filePath: '/downloads/app-setup.exe'
    })
    const { sync, state } = useUpdateDownload()

    await sync(ASSET)

    expect(state.value).toEqual({
      status: 'completed',
      fileName: 'app-setup.exe',
      filePath: '/downloads/app-setup.exe'
    })
  })

  it('快照为 completed 但资产名不同时保持 idle', async () => {
    getDownloadState.mockResolvedValue({
      status: 'completed',
      asset: { ...ASSET, name: 'other.exe' },
      fileName: 'other.exe',
      filePath: '/downloads/other.exe'
    })
    const { sync, state } = useUpdateDownload()

    await sync(ASSET)

    expect(state.value).toEqual({ status: 'idle' })
  })

  it('查询快照失败时不抛异常且保持已有状态', async () => {
    download.mockResolvedValue({
      status: 'failed',
      reason: 'http',
      detail: 'HTTP 404'
    })
    const { start, sync, state } = useUpdateDownload()
    await start({ ...ASSET })
    expect(state.value.status).toBe('failed')

    getDownloadState.mockRejectedValue(new Error('ipc broken'))

    await expect(sync(ASSET)).resolves.toBeUndefined()
    expect(state.value).toEqual({
      status: 'failed',
      reason: 'http',
      detail: 'HTTP 404'
    })
  })
})
