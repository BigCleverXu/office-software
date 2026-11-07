import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_ENGINE_CONFIG,
  DEFAULT_VIDEO_MODULE_SETTINGS,
  MAX_SHORT_LINK_HOPS,
  PARSE_TIMEOUT_MS,
  PLATFORM_META,
  RESOURCE_CACHE_TTL_MS,
  VIDEO_CHANNELS,
  VIDEO_CDN_ALLOWLIST,
  VIDEO_ERROR_MESSAGES,
  computeCer,
  decideResume,
  detectVideoPlatform,
  extractShareUrl,
  formatByteSize,
  formatDuration,
  isAllowedMediaUrl,
  isShortLinkUrl,
  normalizeVideoEngineConfig,
  percentOf,
  platformLabel,
  sanitizeVideoFileName,
  videoErrorMessage,
  type VideoErrorReason,
  type VideoPlatform
} from '../../src/shared/video'

describe('extractShareUrl', () => {
  it('从抖音分享文案提取短链', () => {
    const text =
      '复制打开抖音，看看【某某的作品】 https://v.douyin.com/abc123/ 精彩内容'
    expect(extractShareUrl(text)).toBe('https://v.douyin.com/abc123/')
  })

  it('从快手分享文案提取链接', () => {
    const text = '快手极速版 https://v.kuaishou.com/xyz789 复制此消息'
    expect(extractShareUrl(text)).toBe('https://v.kuaishou.com/xyz789')
  })

  it('小红书链接后紧跟中文标点会截止', () => {
    const text = '小红书笔记 https://xhslink.com/a/AbCdEf，复制本条信息'
    expect(extractShareUrl(text)).toBe('https://xhslink.com/a/AbCdEf')
  })

  it('哔哩哔哩链接后的中文句号会被去掉', () => {
    const text = '【哔哩哔哩】 https://b23.tv/BV1xx411c7mD。'
    expect(extractShareUrl(text)).toBe('https://b23.tv/BV1xx411c7mD')
  })

  it('去掉链接尾部的西文标点', () => {
    const text = '请看 https://www.bilibili.com/video/BV1xx411c7mD.'
    expect(extractShareUrl(text)).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD'
    )
  })

  it('普通文字返回 null', () => {
    expect(extractShareUrl('这是一段普通文字')).toBeNull()
    expect(extractShareUrl('')).toBeNull()
    expect(extractShareUrl('   ')).toBeNull()
  })

  it('非 HTTP(S) 协议与残缺链接返回 null', () => {
    expect(extractShareUrl('ftp://example.com/file')).toBeNull()
    expect(extractShareUrl('https://')).toBeNull()
  })

  it('多个链接时取第一个', () => {
    const text =
      'https://v.douyin.com/one/ 以及 https://www.bilibili.com/video/BV1'
    expect(extractShareUrl(text)).toBe('https://v.douyin.com/one/')
  })
})

describe('detectVideoPlatform', () => {
  it('识别四个平台及其子域', () => {
    expect(detectVideoPlatform('https://www.douyin.com/video/1')).toBe('douyin')
    expect(detectVideoPlatform('https://v.douyin.com/abc')).toBe('douyin')
    expect(detectVideoPlatform('https://www.kuaishou.com/short-video/1')).toBe(
      'kuaishou'
    )
    expect(detectVideoPlatform('https://v.kuaishou.com/abc')).toBe('kuaishou')
    expect(detectVideoPlatform('https://www.xiaohongshu.com/explore/1')).toBe(
      'xiaohongshu'
    )
    expect(detectVideoPlatform('https://xhslink.com/a')).toBe('xiaohongshu')
    expect(detectVideoPlatform('https://www.bilibili.com/video/BV1')).toBe(
      'bilibili'
    )
    expect(detectVideoPlatform('https://b23.tv/abc')).toBe('bilibili')
  })

  it('无法识别其他站点', () => {
    expect(detectVideoPlatform('https://example.com/video/1')).toBeNull()
    expect(detectVideoPlatform('https://notdouyin.com/video/1')).toBeNull()
  })

  it('伪装域名不会被误判', () => {
    expect(
      detectVideoPlatform('https://douyin.com.example.com/video/1')
    ).toBeNull()
    expect(detectVideoPlatform('https://fake-douyin.com/video/1')).toBeNull()
    expect(detectVideoPlatform('https://bilibili.com.evil.com/v/1')).toBeNull()
    expect(
      detectVideoPlatform('https://example.com/?next=douyin.com')
    ).toBeNull()
  })

  it('非法地址返回 null', () => {
    expect(detectVideoPlatform('')).toBeNull()
    expect(detectVideoPlatform('not-a-url')).toBeNull()
    expect(detectVideoPlatform('https://')).toBeNull()
  })
})

describe('isShortLinkUrl', () => {
  it('识别四类短链', () => {
    expect(isShortLinkUrl('https://v.douyin.com/abc')).toBe(true)
    expect(isShortLinkUrl('https://b23.tv/abc')).toBe(true)
    expect(isShortLinkUrl('https://xhslink.com/a/abc')).toBe(true)
    expect(isShortLinkUrl('https://v.kuaishou.com/abc')).toBe(true)
  })

  it('普通资源页与非法地址不算短链', () => {
    expect(isShortLinkUrl('https://www.douyin.com/video/1')).toBe(false)
    expect(isShortLinkUrl('https://www.bilibili.com/video/BV1')).toBe(false)
    expect(isShortLinkUrl('https://example.com/abc')).toBe(false)
    expect(isShortLinkUrl('not-a-url')).toBe(false)
    expect(isShortLinkUrl('')).toBe(false)
  })
})

describe('isAllowedMediaUrl', () => {
  it('命中各平台 CDN 子域且为 https 时通过', () => {
    expect(
      isAllowedMediaUrl('douyin', 'https://v3-dy.douyinpic.com/a.jpg')
    ).toBe(true)
    expect(isAllowedMediaUrl('kuaishou', 'https://v1.kwaicdn.com/a.mp4')).toBe(
      true
    )
    expect(
      isAllowedMediaUrl('xiaohongshu', 'https://sns-video-bd.xhscdn.com/a.mp4')
    ).toBe(true)
    expect(
      isAllowedMediaUrl(
        'bilibili',
        'https://upos-sz-mirrorcos.bilivideo.com/a.m4s'
      )
    ).toBe(true)
  })

  it('http 地址被拒绝', () => {
    expect(
      isAllowedMediaUrl('douyin', 'http://v3-dy.douyinpic.com/a.jpg')
    ).toBe(false)
  })

  it('非白名单域名被拒绝', () => {
    expect(isAllowedMediaUrl('douyin', 'https://example.com/a.mp4')).toBe(false)
    expect(isAllowedMediaUrl('bilibili', 'https://b23.tv/a.mp4')).toBe(false)
  })

  it('平台与域名不匹配被拒绝', () => {
    expect(
      isAllowedMediaUrl('douyin', 'https://upos.bilivideo.com/a.m4s')
    ).toBe(false)
  })

  it('后缀伪装地址被拒绝', () => {
    expect(
      isAllowedMediaUrl('douyin', 'https://douyin.com.evil.com/a.mp4')
    ).toBe(false)
    expect(isAllowedMediaUrl('douyin', 'https://fake-douyin.com/a.mp4')).toBe(
      false
    )
  })

  it('非法地址返回 false', () => {
    expect(isAllowedMediaUrl('douyin', 'not-a-url')).toBe(false)
    expect(isAllowedMediaUrl('douyin', '')).toBe(false)
  })
})

describe('sanitizeVideoFileName', () => {
  it('去掉路径与非法字符', () => {
    expect(sanitizeVideoFileName('C:\\tmp\\a:b*c?.mp4')).toBe('abc.mp4')
    expect(sanitizeVideoFileName('/home/user/视频 名称.mp4')).toBe(
      '视频 名称.mp4'
    )
  })

  it('折叠连续空白并去掉首尾空白', () => {
    expect(sanitizeVideoFileName('  多个   空格  .mp4 ')).toBe('多个 空格.mp4')
  })

  it('保留合法扩展名并限制总长度 80', () => {
    const base = 'a'.repeat(100)
    const cleaned = sanitizeVideoFileName(`${base}.mp4`)
    expect(cleaned.endsWith('.mp4')).toBe(true)
    expect(cleaned.length).toBe(80)
    expect(sanitizeVideoFileName(base)).toHaveLength(80)
  })

  it('清洗后为空时使用 fallback', () => {
    expect(sanitizeVideoFileName('???', '我的视频')).toBe('我的视频')
    expect(sanitizeVideoFileName('   ')).toBe('video')
  })

  it('去掉文件名尾部的点', () => {
    expect(sanitizeVideoFileName('视频...')).toBe('视频')
  })

  it('非法输入不抛异常', () => {
    expect(sanitizeVideoFileName(null as unknown as string)).toBe('video')
    expect(sanitizeVideoFileName(42 as unknown as string)).toBe('video')
  })
})

describe('decideResume', () => {
  it('没有 meta 时重新下载', () => {
    expect(
      decideResume({
        existingBytes: 1024,
        metaUrl: 'https://cdn.example.com/a.mp4',
        requestUrl: 'https://cdn.example.com/a.mp4',
        hasMeta: false
      })
    ).toBe('restart')
  })

  it('meta 地址缺失时重新下载', () => {
    expect(
      decideResume({
        existingBytes: 1024,
        metaUrl: null,
        requestUrl: 'https://cdn.example.com/a.mp4',
        hasMeta: true
      })
    ).toBe('restart')
  })

  it('已下载字节数为 0 或非法时重新下载', () => {
    expect(
      decideResume({
        existingBytes: 0,
        metaUrl: 'https://cdn.example.com/a.mp4',
        requestUrl: 'https://cdn.example.com/a.mp4',
        hasMeta: true
      })
    ).toBe('restart')
    expect(
      decideResume({
        existingBytes: Number.NaN,
        metaUrl: 'https://cdn.example.com/a.mp4',
        requestUrl: 'https://cdn.example.com/a.mp4',
        hasMeta: true
      })
    ).toBe('restart')
  })

  it('源地址变化时重新下载', () => {
    expect(
      decideResume({
        existingBytes: 1024,
        metaUrl: 'https://cdn.example.com/a.mp4',
        requestUrl: 'https://cdn.example.com/b.mp4',
        hasMeta: true
      })
    ).toBe('restart')
  })

  it('meta 存在且源地址一致时续传', () => {
    expect(
      decideResume({
        existingBytes: 1024,
        metaUrl: 'https://cdn.example.com/a.mp4',
        requestUrl: 'https://cdn.example.com/a.mp4',
        hasMeta: true
      })
    ).toBe('resume')
  })
})

describe('computeCer', () => {
  it('完全相同返回 0，忽略空白与标点', () => {
    expect(computeCer('你好世界', '你好世界')).toBe(0)
    expect(computeCer('你好，世界！', ' 你好世界 ')).toBe(0)
    expect(computeCer('Hello, world!', 'Hello world')).toBe(0)
  })

  it('完全不同返回 1', () => {
    expect(computeCer('你好世界', 'abcd')).toBe(1)
  })

  it('部分错误按字符距离计算', () => {
    expect(computeCer('今天天气很好', '今天天气不好')).toBeCloseTo(1 / 6)
  })

  it('参考为空与识别为空均返回 0', () => {
    expect(computeCer('', '')).toBe(0)
    expect(computeCer('，。！', '  ')).toBe(0)
  })

  it('参考为空但有识别输出返回 1', () => {
    expect(computeCer('', '你好')).toBe(1)
  })

  it('识别为空但有参考文本返回 1', () => {
    expect(computeCer('你好', '')).toBe(1)
  })
})

describe('错误文案', () => {
  it('覆盖全部失败原因且非空', () => {
    const reasons: VideoErrorReason[] = [
      'invalid-link',
      'unsupported-platform',
      'short-link-failed',
      'expired',
      'rate-limited',
      'signature-failed',
      'api-changed',
      'network',
      'empty',
      'engine-missing',
      'engine-failed',
      'ffmpeg-missing',
      'write',
      'busy',
      'unknown'
    ]
    for (const reason of reasons) {
      expect(VIDEO_ERROR_MESSAGES[reason]).toBeTruthy()
      expect(videoErrorMessage(reason).length).toBeGreaterThan(0)
    }
  })

  it('无效链接使用明确的中文提示', () => {
    expect(videoErrorMessage('invalid-link')).toBe(
      '未识别到有效链接，请粘贴完整分享链接'
    )
  })
})

describe('normalizeVideoEngineConfig', () => {
  it('合法配置会 trim 字符串并保留语言', () => {
    expect(
      normalizeVideoEngineConfig({
        whisperBinary: ' /opt/whisper ',
        whisperModel: ' /models/ggml.bin ',
        ffmpegPath: ' /usr/bin/ffmpeg ',
        outputDir: ' /tmp/out ',
        language: ' en '
      })
    ).toEqual({
      whisperBinary: '/opt/whisper',
      whisperModel: '/models/ggml.bin',
      ffmpegPath: '/usr/bin/ffmpeg',
      outputDir: '/tmp/out',
      language: 'en'
    })
  })

  it('非法语言回退 zh', () => {
    expect(normalizeVideoEngineConfig({ language: 'fr' }).language).toBe('zh')
  })

  it('非对象输入返回默认配置', () => {
    expect(normalizeVideoEngineConfig(null)).toEqual(
      DEFAULT_VIDEO_ENGINE_CONFIG
    )
    expect(normalizeVideoEngineConfig(undefined)).toEqual(
      DEFAULT_VIDEO_ENGINE_CONFIG
    )
    expect(normalizeVideoEngineConfig([])).toEqual(DEFAULT_VIDEO_ENGINE_CONFIG)
    expect(normalizeVideoEngineConfig('abc')).toEqual(
      DEFAULT_VIDEO_ENGINE_CONFIG
    )
  })

  it('非字符串字段回退空字符串', () => {
    expect(
      normalizeVideoEngineConfig({
        whisperBinary: 123,
        whisperModel: null,
        ffmpegPath: {},
        outputDir: []
      })
    ).toEqual(DEFAULT_VIDEO_ENGINE_CONFIG)
  })

  it('忽略未知字段', () => {
    const result = normalizeVideoEngineConfig({
      whisperBinary: '/bin/whisper',
      extra: 'unexpected'
    })
    expect(Object.keys(result).sort()).toEqual([
      'ffmpegPath',
      'language',
      'outputDir',
      'whisperBinary',
      'whisperModel'
    ])
  })

  it('返回新对象，不污染默认常量', () => {
    const result = normalizeVideoEngineConfig(null)
    result.whisperBinary = '/changed'
    expect(DEFAULT_VIDEO_ENGINE_CONFIG.whisperBinary).toBe('')
  })
})

describe('格式化工具', () => {
  it('formatDuration 处理缺省、短时长与长时长', () => {
    expect(formatDuration(null)).toBe('--')
    expect(formatDuration(undefined)).toBe('--')
    expect(formatDuration(Number.NaN)).toBe('--')
    expect(formatDuration(-5)).toBe('--')
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(59.9)).toBe('0:59')
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('percentOf 处理正常值与非法边界', () => {
    expect(percentOf(4, 10)).toBe(40)
    expect(percentOf(10, 4)).toBe(100)
    expect(percentOf(0, 10)).toBe(0)
    expect(percentOf(5, 0)).toBe(0)
    expect(percentOf(-5, 10)).toBe(0)
    expect(percentOf(Number.NaN, 10)).toBe(0)
  })

  it('formatByteSize 处理字节与单位换算', () => {
    expect(formatByteSize(0)).toBe('0 B')
    expect(formatByteSize(-1)).toBe('0 B')
    expect(formatByteSize(Number.NaN)).toBe('0 B')
    expect(formatByteSize(1023)).toBe('1023 B')
    expect(formatByteSize(1024)).toBe('1.0 KB')
    expect(formatByteSize(1536)).toBe('1.5 KB')
    expect(formatByteSize(1048576)).toBe('1.0 MB')
  })
})

describe('常量与平台信息', () => {
  it('平台元信息覆盖四个平台', () => {
    const platforms: VideoPlatform[] = [
      'douyin',
      'kuaishou',
      'xiaohongshu',
      'bilibili'
    ]
    for (const platform of platforms) {
      expect(PLATFORM_META[platform].label.length).toBeGreaterThan(0)
      expect(PLATFORM_META[platform].hosts.length).toBeGreaterThan(0)
    }
    expect(platformLabel('douyin')).toBe('抖音')
    expect(platformLabel('bilibili')).toBe('哔哩哔哩')
  })

  it('CDN 白名单覆盖四个平台', () => {
    expect(VIDEO_CDN_ALLOWLIST.douyin.length).toBeGreaterThan(0)
    expect(VIDEO_CDN_ALLOWLIST.kuaishou.length).toBeGreaterThan(0)
    expect(VIDEO_CDN_ALLOWLIST.xiaohongshu.length).toBeGreaterThan(0)
    expect(VIDEO_CDN_ALLOWLIST.bilibili.length).toBeGreaterThan(0)
  })

  it('IPC 通道与约束常量符合约定', () => {
    expect(VIDEO_CHANNELS.parse).toBe('video:parse')
    expect(MAX_SHORT_LINK_HOPS).toBe(5)
    expect(PARSE_TIMEOUT_MS).toBe(30000)
    expect(RESOURCE_CACHE_TTL_MS).toBe(10 * 60 * 1000)
  })

  it('默认设置符合约定', () => {
    expect(DEFAULT_VIDEO_MODULE_SETTINGS.downloadDir).toBe('')
    expect(DEFAULT_VIDEO_MODULE_SETTINGS.engine.outputDir).toBe('')
    expect(DEFAULT_VIDEO_MODULE_SETTINGS.engine.language).toBe('zh')
  })
})
