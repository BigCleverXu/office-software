// 自动检查更新：统一的版本判定 + 定时调度
// 手动 IPC 与后台自动检查共用 checkForUpdate，避免两套判定规则
import {
  AUTO_CHECK_INITIAL_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  isNewerVersion,
  type UpdateCheckResult
} from '../shared/update'
import { fetchLatestRelease, type ReleaseFetchResult } from './release-provider'

/**
 * 对比当前版本与发行版取数结果，归类为四态结果。
 *
 * 任何异常都收敛为 error / unknown，绝不向调用方抛出。
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchRelease: () => Promise<ReleaseFetchResult>
): Promise<UpdateCheckResult> {
  try {
    const result = await fetchRelease()
    if (!result.ok) {
      return { status: 'error', currentVersion, reason: result.reason }
    }
    if (result.release === null) {
      return { status: 'no-release', currentVersion }
    }
    if (isNewerVersion(result.release.version, currentVersion)) {
      return {
        status: 'update-available',
        currentVersion,
        release: result.release
      }
    }
    return { status: 'up-to-date', currentVersion, release: result.release }
  } catch {
    return { status: 'error', currentVersion, reason: 'unknown' }
  }
}

export interface UpdateCheckerOptions {
  getVersion: () => string
  /** 注入取数实现以便测试；默认使用 fetchLatestRelease */
  fetchRelease?: () => Promise<ReleaseFetchResult>
  /** 发现新版本时的回调，仅在 update-available 且该版本未提醒过时触发 */
  onUpdateAvailable: (result: UpdateCheckResult) => void
  /** 检查周期（毫秒），默认 AUTO_CHECK_INTERVAL_MS */
  intervalMs?: number
  /** 首次检查延迟（毫秒），默认 AUTO_CHECK_INITIAL_DELAY_MS */
  initialDelayMs?: number
}

/**
 * 自动检查更新调度器：启动延迟后首检，之后按固定周期检查。
 *
 * 仅在新版本可用且本次运行内未提醒过时回调；失败、无发行版、已是最新均静默。
 */
export class UpdateChecker {
  private readonly options: UpdateCheckerOptions
  private readonly fetchRelease: () => Promise<ReleaseFetchResult>
  private timeout: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private checking = false
  /** 本次运行内已提醒过的版本号，用于去重 */
  private notifiedVersion: string | null = null

  constructor(options: UpdateCheckerOptions) {
    this.options = options
    this.fetchRelease = options.fetchRelease ?? (() => fetchLatestRelease())
  }

  /** 启动定时检查；重复调用不会重复创建定时器 */
  start(): void {
    if (this.timeout !== null || this.interval !== null) {
      return
    }
    this.stopped = false
    const initialDelayMs =
      this.options.initialDelayMs ?? AUTO_CHECK_INITIAL_DELAY_MS
    const intervalMs = this.options.intervalMs ?? AUTO_CHECK_INTERVAL_MS
    this.timeout = setTimeout(() => {
      this.timeout = null
      void this.check()
    }, initialDelayMs)
    this.interval = setInterval(() => {
      void this.check()
    }, intervalMs)
  }

  /** 清理定时器；之后不再触发检查与回调 */
  stop(): void {
    this.stopped = true
    if (this.timeout !== null) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
    if (this.interval !== null) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private async check(): Promise<void> {
    // 已停止或上一轮仍在进行时跳过本次
    if (this.stopped || this.checking) {
      return
    }
    this.checking = true
    try {
      const result = await checkForUpdate(
        this.options.getVersion(),
        this.fetchRelease
      )
      // 检查期间被停止：丢弃结果，不触发任何回调
      if (this.stopped) {
        return
      }
      if (result.status === 'error') {
        console.warn('自动检查更新失败:', result.reason)
        return
      }
      if (result.status !== 'update-available') {
        return
      }
      if (this.notifiedVersion === result.release.version) {
        return
      }
      this.notifiedVersion = result.release.version
      this.options.onUpdateAvailable(result)
    } catch (error) {
      console.warn('自动检查更新失败:', error)
    } finally {
      this.checking = false
    }
  }
}
