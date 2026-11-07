import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../../src/main/database'
import { VideoEngineSettingsStore } from '../../src/main/video/engine-settings'
import {
  evaluateTranscriptSamples,
  formatTranscriptEvalReport,
  loadTranscriptSamplesFromDir,
  type TranscriptEvalSample
} from '../../src/main/video/transcript-eval'
import { VideoTranscriptService } from '../../src/main/video/transcript-service'

/** 夹具目录 */
const FIXTURE_DIR = fileURLToPath(
  new URL('../fixtures/video/transcripts', import.meta.url)
)

/** 真实引擎评测所需的环境变量 */
const EVAL_DIR = process.env.VIDEO_ASR_EVAL_DIR?.trim() ?? ''
const WHISPER_BIN = process.env.VIDEO_WHISPER_BIN?.trim() ?? ''
const WHISPER_MODEL = process.env.VIDEO_WHISPER_MODEL?.trim() ?? ''

let openDatabases: ReturnType<typeof openDatabase>[] = []

afterEach(() => {
  for (const db of openDatabases) {
    closeDatabase(db)
  }
  openDatabases = []
})

/** 真实评测跳过原因；空串表示可以执行 */
function skipReasonOf(): string {
  if (EVAL_DIR === '') {
    return '未设置 VIDEO_ASR_EVAL_DIR'
  }
  if (!existsSync(EVAL_DIR)) {
    return 'VIDEO_ASR_EVAL_DIR 指向的目录不存在'
  }
  if (WHISPER_BIN === '') {
    return '未设置 VIDEO_WHISPER_BIN'
  }
  if (!existsSync(WHISPER_BIN)) {
    return 'VIDEO_WHISPER_BIN 指向的文件不存在'
  }
  if (WHISPER_MODEL === '') {
    return '未设置 VIDEO_WHISPER_MODEL'
  }
  if (!existsSync(WHISPER_MODEL)) {
    return 'VIDEO_WHISPER_MODEL 指向的文件不存在'
  }
  return ''
}

describe('口播评测 CER 汇总', () => {
  it('读取夹具并逐条计算 CER、按总编辑距离加权汇总', async () => {
    const samples = await loadTranscriptSamplesFromDir(FIXTURE_DIR)
    expect(samples).toHaveLength(3)
    expect(samples.map((sample) => sample.id)).toEqual(['s1', 's2', 's3'])

    const result = evaluateTranscriptSamples(samples)
    expect(result.samples.map((sample) => sample.id)).toEqual([
      's1',
      's2',
      's3'
    ])
    expect(result.samples[0]?.cer).toBe(0)
    expect(result.samples[1]?.cer).toBeCloseTo(0.2, 10)
    expect(result.samples[2]?.cer).toBeCloseTo(4 / 11, 10)
    // 总编辑距离 6 / 总参考字符 27
    expect(result.overallCer).toBeCloseTo(6 / 27, 10)
    expect(result.passed).toBe(false)
  })

  it('总体 CER 等于 10% 时判定通过', () => {
    const sample: TranscriptEvalSample = {
      id: 'boundary',
      reference: 'abcdefghij',
      hypothesis: 'abcdefghiX'
    }
    const result = evaluateTranscriptSamples([sample])
    expect(result.overallCer).toBeCloseTo(0.1, 10)
    expect(result.passed).toBe(true)
  })

  it('报告包含每条样本 CER、总体 CER 与结论', async () => {
    const samples = await loadTranscriptSamplesFromDir(FIXTURE_DIR)
    const report = formatTranscriptEvalReport(
      evaluateTranscriptSamples(samples)
    )
    expect(report).toContain('0.00%')
    expect(report).toContain('20.00%')
    expect(report).toContain('36.36%')
    expect(report).toContain('22.22%')
    expect(report).toContain('未通过')
  })
})

const realEvalSkipReason = skipReasonOf()
if (realEvalSkipReason !== '') {
  console.info(`跳过真实口播评测：${realEvalSkipReason}`)
}

const realEvalIt = realEvalSkipReason === '' ? it : it.skip

describe('真实引擎评测（需本地 whisper 与样本）', () => {
  realEvalIt(
    realEvalSkipReason === ''
      ? '使用本地引擎评测标注样本，总体 CER 不高于 10%'
      : `本地引擎评测（跳过：${realEvalSkipReason}）`,
    async () => {
      const db = openDatabase({ path: ':memory:' })
      openDatabases.push(db)
      const store = new VideoEngineSettingsStore(db)
      store.update({
        engine: {
          whisperBinary: WHISPER_BIN,
          whisperModel: WHISPER_MODEL,
          ffmpegPath: '',
          outputDir: '',
          language: 'zh'
        }
      })
      const service = new VideoTranscriptService({ store })

      const samples = await loadTranscriptSamplesFromDir(EVAL_DIR)
      const entries = await readdir(EVAL_DIR)
      const wavNames = entries
        .filter((name) => name.toLowerCase().endsWith('.wav'))
        .sort((left, right) => left.localeCompare(right))
      const references: TranscriptEvalSample[] = []
      for (const sample of samples) {
        const wavName = wavNames.find(
          (name) => name.toLowerCase() === `${sample.id ?? ''}.wav`
        )
        if (wavName === undefined) {
          continue
        }
        const snapshot = await service.start({
          filePath: join(EVAL_DIR, wavName)
        })
        if (snapshot.status !== 'completed') {
          throw new Error(
            `样本 ${sample.id ?? wavName} 提取失败：${
              snapshot.status === 'failed'
                ? (snapshot.detail ?? snapshot.message)
                : snapshot.status
            }`
          )
        }
        references.push({
          id: sample.id,
          reference: sample.reference,
          hypothesis: snapshot.text
        })
      }
      // 未找到与标注同名的音频时跳过评测，避免把空样本误判为通过
      if (references.length === 0) {
        console.info('跳过真实口播评测：目录中没有与标注同名的 wav 文件')
        return
      }
      const result = evaluateTranscriptSamples(references)
      console.info(formatTranscriptEvalReport(result))
      expect(result.overallCer).toBeLessThanOrEqual(0.1)
    }
  )
})
