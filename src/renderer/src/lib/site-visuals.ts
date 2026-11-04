// 快捷站点展示辅助：浏览器名称、常用站点、首字母与确定性配色

import type { BrowserId } from '@shared/quick-sites'

/** 浏览器标识对应的展示名称 */
export const BROWSER_LABELS: Record<BrowserId, string> = {
  system: '系统默认浏览器',
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  firefox: 'Mozilla Firefox',
  brave: 'Brave',
  vivaldi: 'Vivaldi',
  opera: 'Opera',
  safari: 'Safari'
}

/** 常用站点推荐：空状态点击后预填新增对话框 */
export interface QuickSitePreset {
  name: string
  url: string
}

/** 常用站点列表 */
export const QUICK_SITE_PRESETS: readonly QuickSitePreset[] = [
  { name: 'GitHub', url: 'https://github.com' },
  { name: '哔哩哔哩', url: 'https://www.bilibili.com' },
  { name: '知乎', url: 'https://www.zhihu.com' },
  { name: '微博', url: 'https://weibo.com' },
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'Google', url: 'https://www.google.com' }
]

/** 汉字范围：用于判断名称是否以中文开头 */
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 拆分英文单词：兼容空格、连字符与 camelCase（如 GitHub -> Git / Hub） */
const WORD_PATTERN = /[A-Z]?[a-z0-9]+|[A-Z]+/g

/**
 * 取站点首字母：中文取前两个字符，英文 / 数字取前两个单词首字母；
 * 空名称回退为 `?`。
 */
export function siteInitials(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') {
    return '?'
  }

  if (CJK_PATTERN.test(trimmed[0] ?? '')) {
    return Array.from(trimmed).slice(0, 2).join('')
  }

  const words = trimmed
    .split(/[\s_-]+/)
    .flatMap((word) => word.match(WORD_PATTERN) ?? [])
    .filter((word) => word !== '')

  if (words.length === 0) {
    return '?'
  }

  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')

  return initials === '' ? '?' : initials
}

/**
 * 低饱和色块样式：完整写出类名，避免动态拼接导致 Tailwind 扫描不到。
 * 索引由 seed（建议使用站点 url）确定性决定，同域名始终同色。
 */
const SITE_ACCENTS: readonly string[] = [
  'bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/15 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20',
  'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20',
  'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/15 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/20',
  'bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/15 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/20',
  'bg-teal-500/10 text-teal-700 ring-1 ring-teal-500/15 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-400/20',
  'bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/15 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/20'
]

/** 确定性哈希：逐字符累积，同 seed 结果稳定 */
function hashSeed(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return hash
}

/** 根据 seed 返回一组低饱和色块样式 */
export function siteAccent(seed: string): string {
  const index = hashSeed(seed) % SITE_ACCENTS.length
  return SITE_ACCENTS[index] ?? SITE_ACCENTS[0]
}
