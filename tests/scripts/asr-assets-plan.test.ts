import { describe, expect, it } from 'vitest'

/** 计划结构的最小声明，与 scripts/asr-assets-plan.mjs 保持一致 */
interface AssetPlan {
  supported: boolean
  platform: string
  arch: string
  unsupportedReason: string | null
  whisper: {
    kind: string
    files: Array<{ name: string; size?: number }>
    executable: string
  } | null
  ffmpegName: string | null
  chmod: boolean
}

type ResolveAssetPlan = (platform: string, arch: string) => AssetPlan

let cached: ResolveAssetPlan | null = null

/** 动态加载纯函数模块：脚本不在 tsconfig.node.json 的 include 内 */
async function loadPlan(): Promise<ResolveAssetPlan> {
  if (cached !== null) return cached
  // @ts-expect-error 脚本模块为 .mjs，无类型声明
  const mod = await import('../../scripts/asr-assets-plan.mjs')
  cached = mod.resolveAssetPlan as ResolveAssetPlan
  return cached
}

describe('resolveAssetPlan', () => {
  it('win32 使用预编译包，产物为 main.exe / whisper.dll 与 ffmpeg.exe', async () => {
    const resolveAssetPlan = await loadPlan()
    const plan = resolveAssetPlan('win32', 'x64')

    expect(plan.supported).toBe(true)
    expect(plan.whisper?.kind).toBe('prebuilt-zip')
    expect(plan.whisper?.files.map((file) => file.name)).toEqual([
      'main.exe',
      'whisper.dll'
    ])
    expect(plan.whisper?.executable).toBe('main.exe')
    expect(plan.ffmpegName).toBe('ffmpeg.exe')
    expect(plan.chmod).toBe(false)
  })

  it('darwin 源码编译 whisper-cli，ffmpeg 无后缀且需要 chmod', async () => {
    const resolveAssetPlan = await loadPlan()
    const plan = resolveAssetPlan('darwin', 'arm64')

    expect(plan.supported).toBe(true)
    expect(plan.whisper?.kind).toBe('build-from-source')
    expect(plan.whisper?.files.map((file) => file.name)).toEqual([
      'whisper-cli'
    ])
    expect(plan.whisper?.executable).toBe('whisper-cli')
    expect(plan.ffmpegName).toBe('ffmpeg')
    expect(plan.chmod).toBe(true)
  })

  it('不支持的平台返回 supported=false 与中文原因', async () => {
    const resolveAssetPlan = await loadPlan()
    const plan = resolveAssetPlan('linux', 'x64')

    expect(plan.supported).toBe(false)
    expect(plan.whisper).toBeNull()
    expect(plan.ffmpegName).toBeNull()
    expect(plan.unsupportedReason).toContain('linux')
  })
})
