// 设备模块：主进程命令执行封装
// 只依赖 node 内置能力，任何异常都收敛为 ok=false，绝不 reject
import { execFile } from 'node:child_process'

/** 命令执行结果 */
export interface ShellRunResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** 可注入的命令执行器，便于测试替换 */
export interface ShellRunner {
  run(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<ShellRunResult>
}

/** 设备扫描超时（PowerShell / system_profiler 较慢） */
export const DEVICE_SCAN_TIMEOUT_MS = 15000

/** 音频读取与设置超时 */
export const AUDIO_TIMEOUT_MS = 8000

/** 指针速度读取与设置超时 */
export const POINTER_TIMEOUT_MS = 5000

/** 超时后留给 SIGTERM 的宽限时间，超过则强制 SIGKILL */
const KILL_GRACE_MS = 1000

/** 非字符串输出归一化为空串 */
function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 异常归一化为可读文本 */
function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return typeof error === 'string' ? error : ''
}

/**
 * 执行一次命令并等待结束。
 *
 * timeout 选项负责超时终止（SIGTERM），另加一个 SIGKILL 定时器兜底，
 * 避免子进程残留；ENOENT、超时、非零退出码等一律收敛为 ok=false。
 */
function runOnce(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<ShellRunResult> {
  return new Promise((resolve) => {
    let settled = false
    let killTimer: NodeJS.Timeout | null = null
    const finish = (result: ShellRunResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (killTimer !== null) {
        clearTimeout(killTimer)
        killTimer = null
      }
      resolve(result)
    }
    try {
      const child = execFile(
        command,
        args,
        {
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          timeout: timeoutMs
        },
        (error, stdout, stderr) => {
          const stderrText = toText(stderr)
          finish({
            ok: error === null,
            stdout: toText(stdout),
            stderr: stderrText !== '' ? stderrText : errorText(error)
          })
        }
      )
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 进程可能已自行退出，忽略
        }
      }, timeoutMs + KILL_GRACE_MS)
    } catch (error) {
      finish({ ok: false, stdout: '', stderr: errorText(error) })
    }
  })
}

/** 创建默认命令执行器（GUI 应用下隐藏窗口） */
export function createShellRunner(): ShellRunner {
  return { run: runOnce }
}
