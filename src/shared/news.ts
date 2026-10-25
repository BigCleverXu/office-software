// 热点新闻模块共享契约：主进程 / preload / 渲染层共用

/** 平台标识 */
export type NewsPlatformId =
  | 'baidu'
  | 'shaoshupai'
  | 'weibo'
  | 'zhihu'
  | '36kr'
  | '52pojie'
  | 'bilibili'
  | 'douban'
  | 'hupu'
  | 'tieba'
  | 'juejin'
  | 'douyin'
  | 'v2ex'
  | 'jinritoutiao'
  | 'tenxunwang'
  | 'stackoverflow'
  | 'github'
  | 'hackernews'
  | 'sina_finance'
  | 'eastmoney'
  | 'xueqiu'
  | 'cls'

/** 平台元信息 */
export interface NewsPlatformMeta {
  id: NewsPlatformId
  name: string
}

/** 全部平台，顺序即选择弹窗与卡片展示顺序 */
export const NEWS_PLATFORMS: readonly NewsPlatformMeta[] = [
  { id: 'baidu', name: '百度热搜' },
  { id: 'shaoshupai', name: '少数派' },
  { id: 'weibo', name: '微博热搜' },
  { id: 'zhihu', name: '知乎热榜' },
  { id: '36kr', name: '36氪' },
  { id: '52pojie', name: '吾爱破解' },
  { id: 'bilibili', name: '哔哩哔哩' },
  { id: 'douban', name: '豆瓣' },
  { id: 'hupu', name: '虎扑' },
  { id: 'tieba', name: '百度贴吧' },
  { id: 'juejin', name: '掘金' },
  { id: 'douyin', name: '抖音' },
  { id: 'v2ex', name: 'V2EX' },
  { id: 'jinritoutiao', name: '今日头条' },
  { id: 'tenxunwang', name: '腾讯网' },
  { id: 'stackoverflow', name: 'Stack Overflow' },
  { id: 'github', name: 'GitHub Trending' },
  { id: 'hackernews', name: 'Hacker News' },
  { id: 'sina_finance', name: '新浪财经' },
  { id: 'eastmoney', name: '东方财富' },
  { id: 'xueqiu', name: '雪球' },
  { id: 'cls', name: '财联社' }
]

/** 默认选中的平台 */
export const DEFAULT_NEWS_PLATFORMS: readonly NewsPlatformId[] = [
  'baidu',
  'weibo',
  'zhihu',
  '36kr'
]

/** 单条新闻 */
export interface NewsItem {
  title: string
  url: string
  /** 摘要，无则为空字符串 */
  content: string
  /** 发布时间原样字符串，无则为空字符串 */
  publishTime: string
}

/** 单个平台的新闻分组 */
export interface NewsSection {
  platform: NewsPlatformId
  items: NewsItem[]
  /** 拉取失败原因，成功为 null */
  error: string | null
}

/** 热点模块完整状态 */
export interface NewsState {
  /** 归一化后的选中平台 */
  selected: NewsPlatformId[]
  /** 与 selected 同序的分组 */
  sections: NewsSection[]
  /** 拉取完成时间戳（毫秒），0 表示尚未拉取 */
  updatedAt: number
}

/** IPC 通道名称 */
export const NEWS_CHANNELS = {
  get: 'news:get',
  setPlatforms: 'news:setPlatforms',
  changed: 'news:changed'
} as const

/** 渲染进程可用的热点新闻 API（由 preload 暴露） */
export interface NewsApi {
  get: () => Promise<NewsState>
  setPlatforms: (platforms: NewsPlatformId[]) => Promise<NewsState>
  onChanged: (callback: (state: NewsState) => void) => () => void
}

/** 判断 value 是否为合法平台代码（白名单校验） */
export function isNewsPlatformId(value: unknown): value is NewsPlatformId {
  return (
    typeof value === 'string' &&
    NEWS_PLATFORMS.some((platform) => platform.id === value)
  )
}

/**
 * 归一化平台列表：非数组回退默认；过滤非法项、去重，
 * 按 NEWS_PLATFORMS 顺序输出；结果为空时回退默认值。
 * 返回新数组，绝不返回 DEFAULT_NEWS_PLATFORMS 原引用。
 */
export function normalizeNewsPlatforms(value: unknown): NewsPlatformId[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_NEWS_PLATFORMS]
  }
  const chosen = new Set<NewsPlatformId>()
  for (const item of value as unknown[]) {
    if (isNewsPlatformId(item)) {
      chosen.add(item)
    }
  }
  const normalized = NEWS_PLATFORMS.filter((platform) =>
    chosen.has(platform.id)
  ).map((platform) => platform.id)
  return normalized.length > 0 ? normalized : [...DEFAULT_NEWS_PLATFORMS]
}
