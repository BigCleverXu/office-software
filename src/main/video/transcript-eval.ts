// 短视频模块：口播准确率评测（中文 CER）
// 读取人工标注样本，比较参考文本与识别文本，按总编辑距离加权汇总结论
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { computeCer } from '../../shared/video'

/** CER 通过阈值：总体字错率不高于 10% */
export const TRANSCRIPT_CER_THRESHOLD = 0.1

/** 单条评测样本 */
export interface TranscriptEvalSample {
  id?: string
  /** 人工标注文本 */
  reference: string
  /** 识别输出文本 */
  hypothesis: string
}

/** 单条评测结果 */
export interface TranscriptEvalSampleResult {
  id: string
  cer: number
}

/** 汇总评测结果 */
export interface TranscriptEvalResult {
  samples: TranscriptEvalSampleResult[]
  /** 按总编辑距离 / 总参考字符数加权 */
  overallCer: number
  passed: boolean
}

/** 与共享 CER 实现一致的归一化：去除空白与中英文标点 */
function normalizeForCer(value: string): string {
  return value.replace(/\s+/gu, '').replace(/\p{P}/gu, '')
}

/** 归一化后的字符长度 */
function characterLength(value: string): number {
  return Array.from(normalizeForCer(value)).length
}

/** 从单条 CER 还原编辑距离，避免浮点误差 */
function editDistanceOf(reference: string, hypothesis: string): number {
  const referenceLength = characterLength(reference)
  // 参考为空时 CER 只能是 0 或 1，不贡献加权距离
  if (referenceLength === 0) {
    return 0
  }
  return Math.round(computeCer(reference, hypothesis) * referenceLength)
}

/** 百分比格式化，保留两位小数 */
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

/**
 * 评测样本集合。
 *
 * 单条 CER 使用共享 computeCer；总体 CER 为总编辑距离 / 总参考字符数，
 * 阈值按 overallCer <= 0.1 判定通过。
 */
export function evaluateTranscriptSamples(
  samples: readonly TranscriptEvalSample[]
): TranscriptEvalResult {
  let totalDistance = 0
  let totalReferenceLength = 0
  let totalHypothesisLength = 0
  const results: TranscriptEvalSampleResult[] = samples.map((sample, index) => {
    const id =
      typeof sample.id === 'string' && sample.id.trim() !== ''
        ? sample.id.trim()
        : `sample-${String(index + 1)}`
    const reference =
      typeof sample.reference === 'string' ? sample.reference : ''
    const hypothesis =
      typeof sample.hypothesis === 'string' ? sample.hypothesis : ''
    const referenceLength = characterLength(reference)
    const distance = editDistanceOf(reference, hypothesis)
    totalDistance += distance
    totalReferenceLength += referenceLength
    totalHypothesisLength += characterLength(hypothesis)
    return { id, cer: computeCer(reference, hypothesis) }
  })
  const overallCer =
    totalReferenceLength === 0
      ? totalHypothesisLength === 0
        ? 0
        : 1
      : totalDistance / totalReferenceLength
  return {
    samples: results,
    overallCer,
    passed: overallCer <= TRANSCRIPT_CER_THRESHOLD + 1e-9
  }
}

/**
 * 生成中文可读评测报告：逐条列出 CER，并给出总体 CER 与阈值结论。
 */
export function formatTranscriptEvalReport(
  result: TranscriptEvalResult
): string {
  const lines = ['口播评测报告', `样本数：${String(result.samples.length)}`]
  for (const sample of result.samples) {
    lines.push(`${sample.id}：CER ${formatPercent(sample.cer)}`)
  }
  lines.push(
    `总体 CER：${formatPercent(result.overallCer)}（阈值 ${formatPercent(
      TRANSCRIPT_CER_THRESHOLD
    )}）`
  )
  lines.push(
    result.passed
      ? '结论：通过（总体 CER 不高于阈值）'
      : '结论：未通过（总体 CER 高于阈值）'
  )
  return lines.join('\n')
}

/** 把任意 JSON 节点收敛为样本，字段不合法返回 null */
function sampleFrom(
  raw: unknown,
  fallbackId: string
): TranscriptEvalSample | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  if (typeof record.reference !== 'string') {
    return null
  }
  const sample: TranscriptEvalSample = {
    reference: record.reference,
    hypothesis: typeof record.hypothesis === 'string' ? record.hypothesis : ''
  }
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  sample.id = id === '' ? fallbackId : id
  return sample
}

/**
 * 读取目录下全部 `*.json` 样本。
 *
 * 单个文件可以是对象或数组；只保留含 reference 的条目，
 * 非法 JSON 与非法结构直接跳过，不抛异常。
 */
export async function loadTranscriptSamplesFromDir(
  directory: string
): Promise<TranscriptEvalSample[]> {
  let names: string[]
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    names = entries
      .filter((entry) => entry.isFile() && extname(entry.name) === '.json')
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
  const samples: TranscriptEvalSample[] = []
  for (const name of names) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(join(directory, name), 'utf8'))
    } catch {
      continue
    }
    const fileBase = basename(name, '.json')
    if (Array.isArray(parsed)) {
      parsed.forEach((item, index) => {
        const sample = sampleFrom(item, `${fileBase}-${String(index + 1)}`)
        if (sample !== null) {
          samples.push(sample)
        }
      })
      continue
    }
    const sample = sampleFrom(parsed, fileBase)
    if (sample !== null) {
      samples.push(sample)
    }
  }
  return samples
}
