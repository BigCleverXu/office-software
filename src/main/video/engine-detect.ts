// 短视频模块：本地口播引擎路径探测
// whisper 与模型：用户配置 → 内置资源 whisper 目录 → 系统 PATH
// ffmpeg：用户配置 → 内置资源 ffmpeg 目录（兼容资源根目录）→ ffmpeg-static → 系统 PATH
// 找不到时返回中文缺项说明
import { readdir, stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import {
  normalizeVideoEngineConfig,
  type VideoEngineConfig,
  type VideoEngineProbe
} from '../../shared/video'

/** 资源目录下存放 whisper 的二级目录名 */
const WHISPER_RESOURCE_DIR = 'whisper'

/** 资源目录下存放 ffmpeg 的二级目录名 */
const FFMPEG_RESOURCE_DIR = 'ffmpeg'

/** PATH 中查找 whisper 可执行文件的名称顺序 */
const WHISPER_BINARY_NAMES: readonly string[] = [
  'whisper-cli',
  'whisper',
  'main'
]

/** 资源目录内 whisper 可执行文件的名称顺序 */
const WHISPER_RESOURCE_BINARY_NAMES: readonly string[] = ['whisper-cli', 'main']

/** 探测选项 */
export interface VideoEngineDetectOptions {
  /** 应用资源目录；默认取 process.resourcesPath，开发态回退当前工作目录 */
  resourcesDir?: string
}

/** 探测入参与默认配置合并 */
function resolveConfig(config?: Partial<VideoEngineConfig>): VideoEngineConfig {
  return normalizeVideoEngineConfig(config ?? {})
}

/** 是否为 Windows 平台 */
function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * 把打包产物路径中的 app.asar 换成 app.asar.unpacked。
 * 已是 unpacked 的路径保持原样；空串返回空串。
 */
export function normalizeAsarPath(path: string): string {
  if (typeof path !== 'string' || path.trim() === '') {
    return ''
  }
  return path.replace(/app\.asar(?!\.unpacked)/g, 'app.asar.unpacked')
}

/** 默认资源目录：打包态用 process.resourcesPath，开发态用工作目录 */
function defaultResourcesDir(): string {
  const value = (process as unknown as { resourcesPath?: unknown })
    .resourcesPath
  if (typeof value === 'string' && value.trim() !== '') {
    return value
  }
  return process.cwd()
}

/** 文件是否存在，异常按不存在处理 */
async function isFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

/** 配置路径存在则返回规范化后的绝对路径，否则 null */
async function useConfiguredFile(raw: string): Promise<string | null> {
  const candidate = normalizeAsarPath(raw).trim()
  if (candidate === '') {
    return null
  }
  return (await isFile(candidate)) ? candidate : null
}

/** 依次检查候选路径，返回第一个存在的文件 */
async function firstExisting(
  candidates: readonly string[]
): Promise<string | null> {
  const seen = new Set<string>()
  for (const raw of candidates) {
    const candidate = normalizeAsarPath(raw).trim()
    if (candidate === '' || seen.has(candidate)) {
      continue
    }
    seen.add(candidate)
    if (await isFile(candidate)) {
      return candidate
    }
  }
  return null
}

/** 单个可执行文件名在 Windows 下补齐 .exe / .cmd 后缀 */
function executableNames(name: string): string[] {
  const names = isWindows() ? [`${name}.exe`, `${name}.cmd`, name] : [name]
  return names
}

/** 读取 PATH 目录列表，去空白与引号并去重 */
function pathDirectories(): string[] {
  const raw = process.env.PATH ?? process.env.Path ?? ''
  const directories: string[] = []
  const seen = new Set<string>()
  for (const segment of raw.split(delimiter)) {
    const directory = segment.trim().replace(/^"(.*)"$/, '$1')
    if (directory === '' || seen.has(directory)) {
      continue
    }
    seen.add(directory)
    directories.push(directory)
  }
  return directories
}

/** 在 PATH 中按名称顺序查找可执行文件 */
async function findInPath(names: readonly string[]): Promise<string | null> {
  const directories = pathDirectories()
  for (const directory of directories) {
    for (const name of names) {
      const found = await firstExisting(
        executableNames(name).map((item) => join(directory, item))
      )
      if (found !== null) {
        return found
      }
    }
  }
  return null
}

/** 模型文件排序：ggml-base.bin 优先，其后任意 ggml-*.bin，最后任意 *.bin */
async function pickModelInDirectory(directory: string): Promise<string | null> {
  const preferred = join(directory, 'ggml-base.bin')
  if (await isFile(preferred)) {
    return preferred
  }
  let names: string[]
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    names = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return null
  }
  const ggmlModel = names.find((name) => /^ggml-.+\.bin$/i.test(name))
  if (ggmlModel !== undefined) {
    return join(directory, ggmlModel)
  }
  const anyModel = names.find((name) => /\.bin$/i.test(name))
  return anyModel === undefined ? null : join(directory, anyModel)
}

/**
 * 在资源目录与 PATH 中查找模型文件。
 * PATH 场景逐个目录检查 ggml-*.bin 与任意 *.bin。
 */
async function findModel(
  configModel: string,
  resourcesDir: string
): Promise<string | null> {
  const configured = await useConfiguredFile(configModel)
  if (configured !== null) {
    return configured
  }
  const resourceModel = await pickModelInDirectory(
    join(resourcesDir, WHISPER_RESOURCE_DIR)
  )
  if (resourceModel !== null) {
    return resourceModel
  }
  for (const directory of pathDirectories()) {
    const found = await pickModelInDirectory(directory)
    if (found !== null) {
      return found
    }
  }
  return null
}

/** 动态加载 ffmpeg-static；模块缺失或路径无效时返回 null */
async function findStaticFfmpeg(): Promise<string | null> {
  try {
    const moduleName = 'ffmpeg-static'
    const loaded: unknown = await import(moduleName)
    if (loaded === null || typeof loaded !== 'object') {
      return null
    }
    const value = (loaded as { default?: unknown }).default
    if (typeof value !== 'string' || value.trim() === '') {
      return null
    }
    const candidate = normalizeAsarPath(value)
    return (await isFile(candidate)) ? candidate : null
  } catch {
    return null
  }
}

/** 内置 ffmpeg 候选：优先 ffmpeg 子目录，其次资源根目录（兼容旧安装包） */
function resourceFfmpegCandidates(resourcesDir: string): string[] {
  const candidates: string[] = []
  for (const name of executableNames('ffmpeg')) {
    candidates.push(join(resourcesDir, FFMPEG_RESOURCE_DIR, name))
  }
  for (const name of executableNames('ffmpeg')) {
    candidates.push(join(resourcesDir, name))
  }
  return candidates
}

/** 探测 ffmpeg：配置 → 内置 ffmpeg 目录（兼容根目录）→ ffmpeg-static → PATH */
async function findFfmpeg(
  configuredPath: string,
  resourcesDir: string
): Promise<string | null> {
  const configured = await useConfiguredFile(configuredPath)
  if (configured !== null) {
    return configured
  }
  const resourcePath = await firstExisting(
    resourceFfmpegCandidates(resourcesDir)
  )
  if (resourcePath !== null) {
    return resourcePath
  }
  const staticPath = await findStaticFfmpeg()
  if (staticPath !== null) {
    return staticPath
  }
  return findInPath(['ffmpeg'])
}

/** 资源目录中的 whisper 可执行文件候选路径 */
function resourceWhisperCandidates(resourcesDir: string): string[] {
  const directory = join(resourcesDir, WHISPER_RESOURCE_DIR)
  const candidates: string[] = []
  for (const name of WHISPER_RESOURCE_BINARY_NAMES) {
    for (const fileName of executableNames(name)) {
      candidates.push(join(directory, fileName))
    }
  }
  return candidates
}

/** 根据探测结果拼接面向用户的中文说明 */
function describeProbe(probe: Omit<VideoEngineProbe, 'message'>): string {
  if (probe.ok) {
    return '本地引擎就绪'
  }
  const missing: string[] = []
  if (probe.binary === null) {
    missing.push('whisper 可执行文件')
  }
  if (probe.model === null) {
    missing.push('识别模型')
  }
  if (probe.ffmpeg === null) {
    missing.push('ffmpeg')
  }
  return `未检测到：${missing.join('、')}`
}

/**
 * 探测本地口播引擎。
 *
 * 依次检查用户配置路径、内置应用资源目录（whisper / ffmpeg 子目录）
 * 与系统 PATH；ffmpeg 在资源缺失时再回退 ffmpeg-static；
 * 返回实际路径与中文说明，任何异常都收敛为「未找到」。
 */
export async function probeVideoEngine(
  config?: Partial<VideoEngineConfig>,
  options: VideoEngineDetectOptions = {}
): Promise<VideoEngineProbe> {
  const resolved = resolveConfig(config)
  const resourcesDir = options.resourcesDir ?? defaultResourcesDir()
  let binary: string | null = null
  let model: string | null = null
  let ffmpeg: string | null = null
  try {
    const configuredBinary = await useConfiguredFile(resolved.whisperBinary)
    binary =
      configuredBinary ??
      (await firstExisting(resourceWhisperCandidates(resourcesDir))) ??
      (await findInPath(WHISPER_BINARY_NAMES))
    model = await findModel(resolved.whisperModel, resourcesDir)
    ffmpeg = await findFfmpeg(resolved.ffmpegPath, resourcesDir)
  } catch {
    // 探测过程中任何失败都按缺失处理，仍返回可读说明
  }
  return {
    ok: binary !== null && model !== null && ffmpeg !== null,
    binary,
    model,
    ffmpeg,
    message: describeProbe({
      ok: binary !== null && model !== null && ffmpeg !== null,
      binary,
      model,
      ffmpeg
    })
  }
}

/**
 * 仅解析 ffmpeg 路径，供下载器 IPC 复用。
 * 顺序与探测一致：配置 → 内置 ffmpeg 目录（兼容根目录）→
 * ffmpeg-static → PATH。
 */
export async function resolveFfmpegPath(
  config?: Partial<VideoEngineConfig>,
  options: VideoEngineDetectOptions = {}
): Promise<string | null> {
  const resolved = resolveConfig(config)
  const resourcesDir = options.resourcesDir ?? defaultResourcesDir()
  try {
    return await findFfmpeg(resolved.ffmpegPath, resourcesDir)
  } catch {
    return null
  }
}
