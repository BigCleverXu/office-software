#!/usr/bin/env node
/**
 * 获取 ASR 内置资源（Windows / macOS）
 *
 * 用法：
 *   node scripts/fetch-asr-assets.mjs            首次获取 / 增量补齐（已存在的文件校验通过则跳过）
 *   node scripts/fetch-asr-assets.mjs --check    只校验，不下载
 *   node scripts/fetch-asr-assets.mjs --force    强制重新获取并更新 scripts/asr-assets.lock.json
 *
 * 产物（仅当前构建平台，模型两平台共用）：
 *   Windows：resources/whisper/main.exe
 *            resources/whisper/whisper.dll
 *            resources/whisper/ggml-base-q5_1.bin
 *            resources/ffmpeg/ffmpeg.exe
 *   macOS：  resources/whisper/whisper-cli（源码编译）
 *            resources/whisper/ggml-base-q5_1.bin
 *            resources/ffmpeg/ffmpeg
 *
 * 平台差异由 scripts/asr-assets-plan.mjs 描述；仅使用 Node 内置模块，不新增依赖。
 */

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveAssetPlan } from './asr-assets-plan.mjs'

const require = createRequire(import.meta.url)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESOURCES_DIR = join(ROOT, 'resources')
const WHISPER_DIR = join(RESOURCES_DIR, 'whisper')
const FFMPEG_DIR = join(RESOURCES_DIR, 'ffmpeg')
const LOCK_PATH = join(ROOT, 'scripts', 'asr-assets.lock.json')

const MODEL = {
  name: 'ggml-base-q5_1.bin',
  size: 59707625,
  urls: [
    'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin'
  ]
}

/** 模型锁键两平台共用 */
const MODEL_KEY = `shared/whisper/${MODEL.name}`

/** 旧版模型锁键，用于向后兼容 */
const MODEL_LEGACY_KEY = `whisper/${MODEL.name}`

const BUDGET_BYTES = 160 * 1024 * 1024
const MAX_RETRIES = 2

function log(msg) {
  console.log(msg)
}

function fail(msg) {
  process.exitCode = 1
  throw new Error(msg)
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

function isExecutable(path) {
  if (!existsSync(path)) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function readLock() {
  if (!existsSync(LOCK_PATH)) return null
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8'))
  } catch {
    fail(`lock 文件无法解析：${LOCK_PATH}（可加 --force 重建）`)
  }
}

function writeLock(entries) {
  mkdirSync(dirname(LOCK_PATH), { recursive: true })
  const payload = {
    _说明:
      'ASR 资源期望哈希，由 scripts/fetch-asr-assets.mjs 维护；勿手工修改。',
    generatedAt: new Date().toISOString(),
    files: entries
  }
  writeFileSync(LOCK_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  log(`[写入] 哈希锁文件 ${relative(ROOT, LOCK_PATH)}`)
}

/** 读取锁条目；新键不存在时回退旧的平台无关键 */
function lockEntry(lock, key, legacyKeys = []) {
  const files = lock?.files
  if (!files) return null
  if (files[key]) return files[key]
  for (const legacy of legacyKeys) {
    if (files[legacy]) return files[legacy]
  }
  return null
}

async function downloadToFile(url, dest, { timeoutMs, label }) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: { 'user-agent': 'office-software-asr-fetch/1.0' }
  })
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`)
  }
  const total = Number(res.headers.get('content-length') || 0)
  const ws = createWriteStream(dest)
  let received = 0
  let nextMark = 0.2
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!ws.write(value)) await once(ws, 'drain')
      received += value.length
      if (total > 0 && received / total >= nextMark) {
        log(
          `  ... ${label} ${Math.round(nextMark * 100)}%（${fmtBytes(received)} / ${fmtBytes(total)}）`
        )
        nextMark += 0.2
      }
    }
    await new Promise((resolve, reject) => {
      ws.end((err) => (err ? reject(err) : resolve()))
    })
  } catch (err) {
    ws.destroy()
    throw err
  }
  return { received, total }
}

async function withRetries(task, label) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await task(attempt)
    } catch (err) {
      lastErr = err
      if (attempt <= MAX_RETRIES) {
        const waitMs = attempt * 2000
        log(
          `[重试] ${label} 第 ${attempt} 次失败（${err.message}），${waitMs / 1000}s 后重试`
        )
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  }
  throw lastErr
}

function collectFiles(dir, targetName, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, targetName, out)
    else if (
      entry.isFile() &&
      entry.name.toLowerCase() === targetName.toLowerCase()
    )
      out.push(full)
  }
  return out
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true })
  try {
    execFileSync('tar.exe', ['-xf', zipPath, '-C', destDir], { stdio: 'pipe' })
    return 'tar.exe'
  } catch (err) {
    log(
      `[提示] tar.exe 解压失败（${err.message.split('\n')[0]}），改用 PowerShell Expand-Archive`
    )
    const psQuote = (p) => `'${p.replace(/'/g, "''")}'`
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destDir)} -Force`
      ],
      { stdio: 'pipe' }
    )
    return 'PowerShell Expand-Archive'
  }
}

/** 执行外部命令，失败时抛出带 stderr 摘要的中文错误 */
function runCommand(command, args, label) {
  try {
    return execFileSync(command, args, { stdio: 'pipe' })
  } catch (err) {
    const stderr =
      err.stderr === undefined || err.stderr === null
        ? ''
        : err.stderr.toString('utf8')
    const detail = stderr.trim().split('\n').slice(-5).join(' ') || err.message
    throw new Error(`${label}失败：${detail}`)
  }
}

/** 登记 whisper 产物到锁条目（按平台前缀） */
async function registerWhisperEntries(plan, entries) {
  for (const { name } of plan.whisper.files) {
    const path = join(WHISPER_DIR, name)
    if (!existsSync(path)) continue
    entries[`${plan.platform}/whisper/${name}`] = {
      sha256: (await hashFile(path)).toUpperCase(),
      size: fileSize(path)
    }
  }
}

/** Windows：下载 whisper.cpp 预编译包并拷贝 main.exe / whisper.dll */
async function acquireWhisperPrebuilt(plan, { force, entries }) {
  const { files, zip } = plan.whisper
  const names = files.map((file) => file.name).join(' 与 ')
  const filesOk = files.every(({ name, size }) => {
    const path = join(WHISPER_DIR, name)
    return existsSync(path) && fileSize(path) === size
  })

  if (!force && filesOk) {
    log(`[跳过] resources/whisper 下 ${names} 已存在且大小正确`)
    await registerWhisperEntries(plan, entries)
    return
  }

  const tmpZip = join(
    tmpdir(),
    `whisper-bin-x64-${process.pid}-${Date.now()}.zip`
  )
  const tmpExtract = mkdtempSync(join(tmpdir(), 'whisper-extract-'))
  try {
    let downloaded = false
    let lastErr = null
    for (const url of zip.urls) {
      try {
        log(`[下载] whisper.cpp Windows 预编译包（约 2.2 MB）来源 ${url}`)
        await withRetries(async (attempt) => {
          const { received } = await downloadToFile(url, tmpZip, {
            timeoutMs: 180000,
            label: `whisper zip（第 ${attempt} 次）`
          })
          if (received !== zip.size) {
            throw new Error(
              `压缩包大小异常：期望 ${zip.size}，实际 ${received}`
            )
          }
        }, 'whisper zip 下载')
        downloaded = true
        break
      } catch (err) {
        lastErr = err
        rmSync(tmpZip, { force: true })
        log(`[警告] 来源失败：${err.message}`)
      }
    }
    if (!downloaded)
      fail(`whisper zip 下载失败：${lastErr?.message ?? '未知错误'}`)

    const actual = await hashFile(tmpZip)
    if (actual.toUpperCase() !== zip.sha256.toUpperCase()) {
      fail(`whisper zip SHA-256 不匹配：期望 ${zip.sha256}，实际 ${actual}`)
    }
    log('[校验] whisper zip SHA-256 通过')

    const tool = extractZip(tmpZip, tmpExtract)
    log(`[解压] 使用 ${tool} 完成`)

    mkdirSync(WHISPER_DIR, { recursive: true })
    for (const { name } of files) {
      const matches = collectFiles(tmpExtract, name)
      if (matches.length === 0) fail(`压缩包内未找到 ${name}`)
      copyFileSync(matches[0], join(WHISPER_DIR, name))
      log(
        `[拷贝] ${relative(ROOT, join(WHISPER_DIR, name))}（${fmtBytes(fileSize(join(WHISPER_DIR, name)))}）`
      )
    }
  } finally {
    rmSync(tmpZip, { force: true })
    rmSync(tmpExtract, { recursive: true, force: true })
  }

  await registerWhisperEntries(plan, entries)
}

/** 在解压目录中查找包含 CMakeLists.txt 的源码根目录 */
function findSourceRoot(dir, depth = 0) {
  if (existsSync(join(dir, 'CMakeLists.txt'))) return dir
  if (depth >= 2) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const found = findSourceRoot(join(dir, entry.name), depth + 1)
    if (found !== null) return found
  }
  return null
}

/** 在构建目录中定位 whisper 可执行文件，排除动态库 */
function findBuiltWhisper(buildDir, candidates) {
  for (const name of candidates) {
    for (const path of [join(buildDir, 'bin', name), join(buildDir, name)]) {
      if (existsSync(path) && statSync(path).isFile()) return path
    }
  }
  for (const name of candidates) {
    const match = collectFiles(buildDir, name).find(
      (path) => !/\.(dylib|so|dll|a)$/i.test(path)
    )
    if (match !== undefined) return match
  }
  return null
}

/** macOS：下载源码、CMake 编译并拷贝 whisper-cli */
async function acquireWhisperFromSource(plan, { force, entries }) {
  const file = plan.whisper.files[0]
  const dest = join(WHISPER_DIR, file.name)

  if (!force && isExecutable(dest)) {
    log(`[跳过] ${relative(ROOT, dest)} 已存在且可执行`)
    await registerWhisperEntries(plan, entries)
    return
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'whisper-build-'))
  const tarPath = join(tmpRoot, 'whisper-src.tar.gz')
  const srcExtract = join(tmpRoot, 'src')
  const buildDir = join(tmpRoot, 'build')
  try {
    try {
      execFileSync('cmake', ['--version'], { stdio: 'pipe' })
    } catch {
      fail(
        '未找到可用的 cmake，无法编译 whisper.cpp（macOS 可先执行 brew install cmake）'
      )
    }

    const { version, urls } = plan.whisper.source
    let downloaded = false
    let lastErr = null
    for (const url of urls) {
      try {
        log(`[下载] whisper.cpp 源码包（${version}）来源 ${url}`)
        await withRetries(async (attempt) => {
          const { received } = await downloadToFile(url, tarPath, {
            timeoutMs: 300000,
            label: `whisper 源码包（第 ${attempt} 次）`
          })
          if (received <= 0) throw new Error('源码包内容为空')
        }, 'whisper 源码包下载')
        downloaded = true
        break
      } catch (err) {
        lastErr = err
        rmSync(tarPath, { force: true })
        log(`[警告] 来源失败：${err.message}`)
      }
    }
    if (!downloaded)
      fail(`whisper 源码包下载失败：${lastErr?.message ?? '未知错误'}`)

    mkdirSync(srcExtract, { recursive: true })
    runCommand('tar', ['-xzf', tarPath, '-C', srcExtract], '解压源码包')
    log('[解压] 使用 tar -xzf 完成')

    const sourceDir = findSourceRoot(srcExtract)
    if (sourceDir === null) fail('源码包内未找到 CMakeLists.txt')
    const sourceRoot = relative(tmpRoot, sourceDir)
    log(`[源码] ${sourceRoot === '' ? 'whisper.cpp' : sourceRoot}`)

    const { configure, fallbackConfigure } = plan.whisper.cmake
    try {
      runCommand(
        'cmake',
        ['-S', sourceDir, '-B', buildDir, ...configure],
        '配置 whisper.cpp '
      )
      runCommand(
        'cmake',
        ['--build', buildDir, '--config', 'Release', '-j'],
        '编译 whisper.cpp '
      )
    } catch (err) {
      log(
        `[警告] 默认参数构建失败（${err.message}），改用 -DGGML_METAL=OFF 重试一次`
      )
      rmSync(buildDir, { recursive: true, force: true })
      try {
        runCommand(
          'cmake',
          ['-S', sourceDir, '-B', buildDir, ...configure, ...fallbackConfigure],
          '配置 whisper.cpp（Metal 关闭）'
        )
        runCommand(
          'cmake',
          ['--build', buildDir, '--config', 'Release', '-j'],
          '编译 whisper.cpp（Metal 关闭）'
        )
      } catch (retryErr) {
        fail(
          `whisper.cpp 编译失败：${err.message}；关闭 Metal 重试仍失败：${retryErr.message}`
        )
      }
    }

    const candidates = file.outputCandidates ?? [file.name]
    const built = findBuiltWhisper(buildDir, candidates)
    if (built === null)
      fail(
        `构建产物中未找到 ${candidates.join(' 或 ')}（构建目录 ${relative(tmpRoot, buildDir)}）`
      )

    mkdirSync(WHISPER_DIR, { recursive: true })
    copyFileSync(built, dest)
    chmodSync(dest, plan.executableMode ?? 0o755)
    log(`[拷贝] ${relative(ROOT, dest)}（${fmtBytes(fileSize(dest))}）`)
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true })
  }

  await registerWhisperEntries(plan, entries)
}

async function acquireWhisper(plan, { force, entries }) {
  if (plan.whisper.kind === 'prebuilt-zip') {
    await acquireWhisperPrebuilt(plan, { force, entries })
    return
  }
  await acquireWhisperFromSource(plan, { force, entries })
}

async function acquireModel({ force, lock, entries, checkOnly }) {
  const dest = join(WHISPER_DIR, MODEL.name)
  const key = MODEL_KEY
  const expected = lockEntry(lock, key, [MODEL_LEGACY_KEY])
  const existing = existsSync(dest)

  if (checkOnly) {
    if (!existing) fail(`缺少模型文件 ${dest}`)
    const hash = await hashFile(dest)
    if (!expected?.sha256)
      fail(`lock 中缺少模型期望哈希：${key}（请先执行获取脚本）`)
    if (hash.toUpperCase() !== expected.sha256.toUpperCase()) {
      fail(`模型哈希不匹配：期望 ${expected.sha256}，实际 ${hash}`)
    }
    if (fileSize(dest) !== MODEL.size) {
      fail(`模型大小异常：期望 ${MODEL.size}，实际 ${fileSize(dest)}`)
    }
    log(`[校验] 模型通过 ${relative(ROOT, dest)}`)
    return
  }

  if (!force && existing) {
    const hash = await hashFile(dest)
    if (
      !expected?.sha256 ||
      hash.toUpperCase() === expected.sha256.toUpperCase()
    ) {
      if (!expected?.sha256)
        log('[提示] lock 中暂无模型哈希，沿用已存在文件并登记哈希')
      log(`[跳过] 模型已存在且校验通过 ${relative(ROOT, dest)}`)
      entries[key] = {
        sha256: hash.toUpperCase(),
        size: fileSize(dest),
        source: expected?.source ?? 'existing'
      }
      return
    }
    log('[提示] 已存在的模型哈希与 lock 不符，重新下载')
  }

  mkdirSync(WHISPER_DIR, { recursive: true })
  const part = `${dest}.part`
  let lastErr = null
  for (const url of MODEL.urls) {
    try {
      log(`[下载] 模型（约 ${fmtBytes(MODEL.size)}）来源 ${url}`)
      await withRetries(async (attempt) => {
        await downloadToFile(url, part, {
          timeoutMs: 600000,
          label: `模型（第 ${attempt} 次）`
        })
        const size = fileSize(part)
        if (size !== MODEL.size) {
          throw new Error(`模型大小异常：期望 ${MODEL.size}，实际 ${size}`)
        }
        if (!force && expected?.sha256) {
          const hash = await hashFile(part)
          if (hash.toUpperCase() !== expected.sha256.toUpperCase()) {
            throw new Error(`哈希不匹配：期望 ${expected.sha256}，实际 ${hash}`)
          }
        }
      }, '模型下载')
      if (existsSync(part)) {
        rmSync(dest, { force: true })
        renameSync(part, dest)
      }
      const hash = await hashFile(dest)
      if (
        !force &&
        expected?.sha256 &&
        hash.toUpperCase() !== expected.sha256.toUpperCase()
      ) {
        fail(`模型哈希不匹配：期望 ${expected.sha256}，实际 ${hash}`)
      }
      entries[key] = {
        sha256: hash.toUpperCase(),
        size: fileSize(dest),
        source: url.includes('hf-mirror') ? 'hf-mirror' : 'huggingface'
      }
      log(`[完成] 模型 ${relative(ROOT, dest)}（${fmtBytes(fileSize(dest))}）`)
      return
    } catch (err) {
      lastErr = err
      rmSync(part, { force: true })
      log(`[警告] 来源失败：${err.message}`)
    }
  }
  fail(`模型获取失败：${lastErr?.message ?? '未知错误'}`)
}

async function acquireFfmpeg(plan, { force, lock, entries, checkOnly }) {
  const dest = join(FFMPEG_DIR, plan.ffmpegName)
  const key = `${plan.platform}/ffmpeg/${plan.ffmpegName}`
  const expected = lockEntry(lock, key, [`ffmpeg/${plan.ffmpegName}`])
  const existing = existsSync(dest)

  if (checkOnly) {
    if (!existing) fail(`缺少 ffmpeg：${dest}`)
    if (!expected?.sha256)
      fail(`lock 中缺少 ffmpeg 期望哈希：${key}（请先执行获取脚本）`)
    const hash = await hashFile(dest)
    if (hash.toUpperCase() !== expected.sha256.toUpperCase()) {
      fail(`ffmpeg 哈希不匹配：期望 ${expected.sha256}，实际 ${hash}`)
    }
    log(`[校验] ffmpeg 通过 ${relative(ROOT, dest)}`)
    return
  }

  if (!force && existing) {
    const hash = await hashFile(dest)
    if (
      !expected?.sha256 ||
      hash.toUpperCase() === expected.sha256.toUpperCase()
    ) {
      if (!expected?.sha256)
        log('[提示] lock 中暂无 ffmpeg 哈希，沿用已存在文件并登记哈希')
      log(`[跳过] ffmpeg 已存在且校验通过 ${relative(ROOT, dest)}`)
      entries[key] = { sha256: hash.toUpperCase(), size: fileSize(dest) }
      return
    }
    log('[提示] 已存在的 ffmpeg 哈希与 lock 不符，重新从 ffmpeg-static 拷贝')
  }

  let source
  try {
    source = require('ffmpeg-static')
  } catch (err) {
    fail(`无法解析 ffmpeg-static：${err.message}`)
  }
  if (typeof source !== 'string' || !existsSync(source)) {
    fail(`ffmpeg-static 未提供可用的 ${plan.ffmpegName}（请确认依赖已安装）`)
  }
  log(`[拷贝] ${plan.ffmpegName} 来源 ${source}`)
  mkdirSync(FFMPEG_DIR, { recursive: true })
  copyFileSync(source, dest)
  if (plan.chmod) chmodSync(dest, plan.executableMode ?? 0o755)

  const hash = await hashFile(dest)
  if (
    !force &&
    expected?.sha256 &&
    hash.toUpperCase() !== expected.sha256.toUpperCase()
  ) {
    fail(
      `ffmpeg 哈希与 lock 不符：期望 ${expected.sha256}，实际 ${hash}。` +
        '若已升级 ffmpeg-static，请使用 --force 更新 lock。'
    )
  }
  entries[key] = { sha256: hash.toUpperCase(), size: fileSize(dest) }
  log(`[完成] ffmpeg ${relative(ROOT, dest)}（${fmtBytes(fileSize(dest))}）`)
}

/** 校验 whisper 产物：Windows 看大小，macOS 看存在且可执行 */
function checkWhisper(plan) {
  if (plan.whisper.kind === 'prebuilt-zip') {
    for (const { name, size } of plan.whisper.files) {
      const path = join(WHISPER_DIR, name)
      if (!existsSync(path)) fail(`缺少 ${path}`)
      if (fileSize(path) !== size)
        fail(`${path} 大小异常：期望 ${size}，实际 ${fileSize(path)}`)
    }
    log('[校验] whisper 可执行文件通过')
    return
  }

  const { name } = plan.whisper.files[0]
  const dest = join(WHISPER_DIR, name)
  if (!existsSync(dest)) fail(`缺少 ${dest}`)
  if (!isExecutable(dest))
    fail(`${relative(ROOT, dest)} 不可执行（缺少执行权限）`)
  log(`[校验] ${name} 存在且可执行`)
}

function dirSize(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(full)
    else total += fileSize(full) ?? 0
  }
  return total
}

function printReport(plan) {
  log('')
  log('========== ASR 资源清单 ==========')
  const files = [
    ...plan.whisper.files.map((file) => join(WHISPER_DIR, file.name)),
    join(WHISPER_DIR, MODEL.name),
    join(FFMPEG_DIR, plan.ffmpegName)
  ]
  for (const file of files) {
    const size = fileSize(file)
    log(size === null ? `[缺失] ${file}` : `${file}  ${fmtBytes(size)}`)
  }
  const whisperTotal = dirSize(WHISPER_DIR)
  const ffmpegTotal = dirSize(FFMPEG_DIR)
  const total = whisperTotal + ffmpegTotal
  log(`resources/whisper 合计：${fmtBytes(whisperTotal)}`)
  log(`resources/ffmpeg 合计：${fmtBytes(ffmpegTotal)}`)
  log(`总大小：${fmtBytes(total)}（预算 ${fmtBytes(BUDGET_BYTES)}）`)
  if (total > BUDGET_BYTES) {
    console.error(
      `[超预算] ASR 资源总大小 ${fmtBytes(total)} 已超过 ${fmtBytes(BUDGET_BYTES)} 上限`
    )
    process.exitCode = 1
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    log('用法：node scripts/fetch-asr-assets.mjs [--check] [--force]')
    return
  }
  const checkOnly = args.includes('--check')
  const force = args.includes('--force')
  const plan = resolveAssetPlan(process.platform, process.arch)

  log(`[目标] ${RESOURCES_DIR}`)
  if (!plan.supported) {
    console.error(`[不支持] ${plan.unsupportedReason}`)
    process.exitCode = 1
    return
  }
  log(`[平台] ${plan.platform} ${plan.arch}（whisper ${plan.whisper.kind}）`)

  const lock = readLock()
  const entries = { ...(lock?.files ?? {}) }

  if (!checkOnly) {
    await acquireWhisper(plan, { force, entries })
    await acquireModel({ force, lock, entries, checkOnly })
    await acquireFfmpeg(plan, { force, lock, entries, checkOnly })
    // 迁移旧的平台无关键：新键已登记，旧键不再保留
    for (const key of Object.keys(entries)) {
      if (/^(whisper|ffmpeg)\//.test(key)) {
        delete entries[key]
      }
    }
    const changed =
      JSON.stringify(lock?.files ?? {}) !== JSON.stringify(entries)
    if (!lock || changed || force) writeLock(entries)
  } else {
    log('[校验] --check 模式，仅校验现有文件')
    await acquireModel({ force, lock, entries, checkOnly })
    await acquireFfmpeg(plan, { force, lock, entries, checkOnly })
    checkWhisper(plan)
  }

  printReport(plan)
  if (process.exitCode) return
  log(checkOnly ? '[结果] 校验通过' : '[结果] ASR 资源已就绪')
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1
  console.error(`[失败] ${err.message}`)
})
