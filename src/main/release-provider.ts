// 主进程发行版取数层：请求 GitHub releases/latest 并解析为 ReleaseInfo
// 仅主进程使用；渲染层受 CSP 限制不直接发起外部请求
import {
  GITHUB_OWNER,
  GITHUB_RELEASES_ENDPOINT,
  GITHUB_REPO,
  parseRelease,
  type ReleaseInfo,
  type UpdateErrorReason
} from '../shared/update'

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 5000

export interface ReleaseProviderOptions {
  /** 请求超时（毫秒），默认 5000 */
  timeoutMs?: number
  /** 注入的 fetch 实现，便于测试；默认使用全局 fetch */
  fetchImpl?: typeof fetch
}

/** 取数结果：成功携带发行版（可能为 null 表示仓库暂无发行版） */
export type ReleaseFetchResult =
  | { ok: true; release: ReleaseInfo | null }
  | { ok: false; reason: UpdateErrorReason }

/**
 * 按 HTTP 状态归因失败原因（404 已由调用方先行处理为暂无发行版）。
 * 429 → rate-limited；401/403 → unreadable；其余 → network。
 */
function reasonFromStatus(status: number): UpdateErrorReason {
  if (status === 429) {
    return 'rate-limited'
  }
  if (status === 401 || status === 403) {
    return 'unreadable'
  }
  return 'network'
}

/**
 * 获取最新发行版。
 *
 * 始终返回判别联合，绝不向调用方抛出异常：
 * - 404 → 视为暂无发行版（release 为 null）
 * - 429 → rate-limited；401/403 → unreadable；其余 !ok → network
 * - JSON 解析失败或 parseRelease 返回 null → unknown
 * - AbortError / 超时 → timeout；其余 fetch 异常 → network
 */
export async function fetchLatestRelease(
  options: ReleaseProviderOptions = {}
): Promise<ReleaseFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url =
      `${GITHUB_RELEASES_ENDPOINT}/${GITHUB_OWNER}/${GITHUB_REPO}` +
      '/releases/latest'
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (response.status === 404) {
      // GitHub 无发行版时 /releases/latest 返回 404
      return { ok: true, release: null }
    }
    if (!response.ok) {
      return { ok: false, reason: reasonFromStatus(response.status) }
    }
    try {
      const payload: unknown = await response.json()
      const release = parseRelease(payload, GITHUB_OWNER, GITHUB_REPO)
      if (release === null) {
        return { ok: false, reason: 'unknown' }
      }
      return { ok: true, release }
    } catch {
      // JSON 解析失败
      return { ok: false, reason: 'unknown' }
    }
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      return { ok: false, reason: 'timeout' }
    }
    if (error instanceof Error) {
      return { ok: false, reason: 'network' }
    }
    return { ok: false, reason: 'unknown' }
  } finally {
    // 避免定时器泄漏
    clearTimeout(timer)
  }
}
