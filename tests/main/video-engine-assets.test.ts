import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { probeVideoEngine } from '../../src/main/video/engine-detect'

/** 测试工作目录，afterEach 统一清理 */
const tempRoots: string[] = []

/** 原始 PATH，测试结束后恢复，避免污染其他用例 */
const originalPath = process.env.PATH

let rootDir = ''

/** 按平台补齐可执行文件后缀，与探测逻辑保持一致 */
function engineFileName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

/** 写入占位文件，父目录不存在时自动创建 */
async function writeFakeFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '', 'utf8')
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'video-engine-assets-'))
  tempRoots.push(rootDir)
})

afterEach(async () => {
  if (originalPath === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = originalPath
  }
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop()
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

describe('probeVideoEngine 内置资源', () => {
  it('whisper / 模型 / ffmpeg 全部命中内置资源目录', async () => {
    const resourcesDir = join(rootDir, 'resources')
    const whisperDir = join(resourcesDir, 'whisper')
    const ffmpegDir = join(resourcesDir, 'ffmpeg')
    const binaryName = engineFileName('main')
    const ffmpegName = engineFileName('ffmpeg')
    await writeFakeFile(join(whisperDir, binaryName))
    await writeFakeFile(join(whisperDir, 'ggml-base-q5_1.bin'))
    await writeFakeFile(join(ffmpegDir, ffmpegName))

    const probe = await probeVideoEngine({}, { resourcesDir })

    expect(probe).toMatchObject({
      ok: true,
      binary: join(whisperDir, binaryName),
      model: join(whisperDir, 'ggml-base-q5_1.bin'),
      ffmpeg: join(ffmpegDir, ffmpegName),
      message: '本地引擎就绪'
    })
  })

  it('内置 main.exe 优先于 PATH 中的 whisper-cli', async () => {
    const resourcesDir = join(rootDir, 'resources')
    const whisperDir = join(resourcesDir, 'whisper')
    const ffmpegDir = join(resourcesDir, 'ffmpeg')
    const binaryName = engineFileName('main')
    await writeFakeFile(join(whisperDir, binaryName))
    await writeFakeFile(join(whisperDir, 'ggml-base-q5_1.bin'))
    await writeFakeFile(join(ffmpegDir, engineFileName('ffmpeg')))

    const pathDir = join(rootDir, 'path-bin')
    await writeFakeFile(join(pathDir, engineFileName('whisper-cli')))
    process.env.PATH = pathDir

    const probe = await probeVideoEngine({}, { resourcesDir })

    expect(probe.binary).toBe(join(whisperDir, binaryName))
    expect(probe.ok).toBe(true)
  })

  it('内置 whisper 缺失时回退 PATH 中的 whisper-cli', async () => {
    const resourcesDir = join(rootDir, 'resources')
    const whisperDir = join(resourcesDir, 'whisper')
    const ffmpegDir = join(resourcesDir, 'ffmpeg')
    const cliName = engineFileName('whisper-cli')
    // 仅放模型与 ffmpeg，确保可执行文件只能来自 PATH
    await writeFakeFile(join(whisperDir, 'ggml-base-q5_1.bin'))
    await writeFakeFile(join(ffmpegDir, engineFileName('ffmpeg')))

    const pathDir = join(rootDir, 'path-bin')
    await writeFakeFile(join(pathDir, cliName))
    process.env.PATH = pathDir

    const probe = await probeVideoEngine({}, { resourcesDir })

    expect(probe.binary).toBe(join(pathDir, cliName))
    expect(probe.model).toBe(join(whisperDir, 'ggml-base-q5_1.bin'))
    expect(probe.ok).toBe(true)
  })

  it('资源与 PATH 均缺失时返回缺项文案', async () => {
    const resourcesDir = join(rootDir, 'empty-resources')
    await mkdir(resourcesDir, { recursive: true })
    const emptyPathDir = join(rootDir, 'empty-path')
    await mkdir(emptyPathDir, { recursive: true })
    process.env.PATH = emptyPathDir

    const probe = await probeVideoEngine({}, { resourcesDir })

    expect(probe.ok).toBe(false)
    expect(probe.binary).toBeNull()
    expect(probe.model).toBeNull()
    expect(probe.message).toContain('whisper 可执行文件')
    expect(probe.message).toContain('识别模型')
    if (probe.ffmpeg === null) {
      expect(probe.message).toContain('ffmpeg')
    } else {
      // 开发环境若 ffmpeg-static 可用，缺项文案只列前两项
      expect(probe.message).not.toContain('ffmpeg')
    }
  })
})
