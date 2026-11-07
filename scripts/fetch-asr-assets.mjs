#!/usr/bin/env node
/**
 * 获取 ASR 内置资源（仅 Windows）
 *
 * 用法：
 *   node scripts/fetch-asr-assets.mjs            首次获取 / 增量补齐（已存在的文件校验通过则跳过）
 *   node scripts/fetch-asr-assets.mjs --check    只校验，不下载
 *   node scripts/fetch-asr-assets.mjs --force    强制重新获取并更新 scripts/asr-assets.lock.json
 *
 * 产物：
 *   resources/whisper/main.exe
 *   resources/whisper/whisper.dll
 *   resources/whisper/ggml-base-q5_1.bin
 *   resources/ffmpeg/ffmpeg.exe
 *
 * 仅使用 Node 内置模块，不新增依赖。
 */

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
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

const require = createRequire(import.meta.url)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESOURCES_DIR = join(ROOT, 'resources')
const WHISPER_DIR = join(RESOURCES_DIR, 'whisper')
const FFMPEG_DIR = join(RESOURCES_DIR, 'ffmpeg')
const LOCK_PATH = join(ROOT, 'scripts', 'asr-assets.lock.json')

/** whisper.cpp v1.6.0 Windows x64 预编译包（直连 GitHub，失败时走加速镜像，仍以 SHA-256 校验） */
const WHISPER_ZIP = {
  urls: [
    'https://github.com/ggml-org/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip',
    'https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip',
    'https://ghproxy.net/https://github.com/ggml-org/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip'
  ],
  sha256: '0F60FC3318772F4D678E0EB022B08E143D7E8F43C647C0ACFF5C68BB126B1B02',
  size: 2249966
}

const WHISPER_FILES = [
  { name: 'main.exe', size: 148480 },
  { name: 'whisper.dll', size: 933888 }
]

const MODEL = {
  name: 'ggml-base-q5_1.bin',
  size: 59707625,
  urls: [
    'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin'
  ]
}

const FFMPEG = { name: 'ffmpeg.exe' }

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

function lockEntry(lock, key) {
  return lock?.files?.[key] ?? null
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

function whisperFilesOk() {
  return WHISPER_FILES.every(({ name, size }) => {
    const p = join(WHISPER_DIR, name)
    return existsSync(p) && fileSize(p) === size
  })
}

async function acquireWhisperBinaries({ force }) {
  if (!force && whisperFilesOk()) {
    log('[跳过] resources/whisper 下 main.exe 与 whisper.dll 已存在且大小正确')
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
    for (const url of WHISPER_ZIP.urls) {
      try {
        log(`[下载] whisper.cpp Windows 预编译包（约 2.2 MB）来源 ${url}`)
        await withRetries(async (attempt) => {
          const { received } = await downloadToFile(url, tmpZip, {
            timeoutMs: 180000,
            label: `whisper zip（第 ${attempt} 次）`
          })
          if (received !== WHISPER_ZIP.size) {
            throw new Error(
              `压缩包大小异常：期望 ${WHISPER_ZIP.size}，实际 ${received}`
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
    if (actual.toUpperCase() !== WHISPER_ZIP.sha256.toUpperCase()) {
      fail(
        `whisper zip SHA-256 不匹配：期望 ${WHISPER_ZIP.sha256}，实际 ${actual}`
      )
    }
    log('[校验] whisper zip SHA-256 通过')

    const tool = extractZip(tmpZip, tmpExtract)
    log(`[解压] 使用 ${tool} 完成`)

    mkdirSync(WHISPER_DIR, { recursive: true })
    for (const { name } of WHISPER_FILES) {
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
}

async function acquireModel({ force, lock, entries, checkOnly }) {
  const dest = join(WHISPER_DIR, MODEL.name)
  const key = `whisper/${MODEL.name}`
  const expected = lockEntry(lock, key)
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

async function acquireFfmpeg({ force, lock, entries, checkOnly }) {
  const dest = join(FFMPEG_DIR, FFMPEG.name)
  const key = `ffmpeg/${FFMPEG.name}`
  const expected = lockEntry(lock, key)
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
    fail('ffmpeg-static 未提供可用的 ffmpeg.exe（请确认依赖已安装）')
  }
  log(`[拷贝] ffmpeg.exe 来源 ${source}`)
  mkdirSync(FFMPEG_DIR, { recursive: true })
  copyFileSync(source, dest)

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

function printReport() {
  log('')
  log('========== ASR 资源清单 ==========')
  const files = [
    join(WHISPER_DIR, 'main.exe'),
    join(WHISPER_DIR, 'whisper.dll'),
    join(WHISPER_DIR, MODEL.name),
    join(FFMPEG_DIR, FFMPEG.name)
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

  log(`[目标] ${RESOURCES_DIR}`)
  if (process.platform !== 'win32') {
    log(`[跳过] 仅 Windows 内置组件，跳过（当前平台 ${process.platform}）`)
    return
  }

  const lock = readLock()
  const entries = { ...(lock?.files ?? {}) }

  if (!checkOnly) {
    await acquireWhisperBinaries({ force })
    await acquireModel({ force, lock, entries, checkOnly })
    await acquireFfmpeg({ force, lock, entries, checkOnly })
    const changed =
      JSON.stringify(lock?.files ?? {}) !== JSON.stringify(entries)
    if (!lock || changed || force) writeLock(entries)
  } else {
    log('[校验] --check 模式，仅校验现有文件')
    await acquireModel({ force, lock, entries, checkOnly })
    await acquireFfmpeg({ force, lock, entries, checkOnly })
    for (const { name, size } of WHISPER_FILES) {
      const p = join(WHISPER_DIR, name)
      if (!existsSync(p)) fail(`缺少 ${p}`)
      if (fileSize(p) !== size)
        fail(`${p} 大小异常：期望 ${size}，实际 ${fileSize(p)}`)
    }
    log('[校验] whisper 可执行文件通过')
  }

  printReport()
  if (process.exitCode) return
  log(checkOnly ? '[结果] 校验通过' : '[结果] ASR 资源已就绪')
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1
  console.error(`[失败] ${err.message}`)
})
