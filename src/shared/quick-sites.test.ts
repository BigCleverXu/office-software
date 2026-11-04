import { describe, expect, it } from 'vitest'
import {
  QUICK_SITE_GROUP_NAME_MAX_LENGTH,
  QUICK_SITE_NAME_MAX_LENGTH,
  QUICK_SITE_PROFILE_ID_MAX_LENGTH,
  QUICK_SITE_URL_MAX_LENGTH,
  hostOf,
  isBrowserId,
  normalizeQuickSiteGroupName,
  normalizeQuickSiteGroupSiteIds,
  normalizeQuickSiteName,
  normalizeQuickSiteProfileId,
  normalizeQuickSiteUrl
} from './quick-sites'

describe('normalizeQuickSiteUrl', () => {
  it('缺少协议时补 https://', () => {
    expect(normalizeQuickSiteUrl('github.com')).toBe('https://github.com/')
    expect(normalizeQuickSiteUrl('  bilibili.com/video  ')).toBe(
      'https://bilibili.com/video'
    )
  })

  it('保留已有的 http / https 协议', () => {
    expect(normalizeQuickSiteUrl('http://example.com')).toBe(
      'http://example.com/'
    )
    expect(normalizeQuickSiteUrl('HTTPS://example.com/a?b=1')).toBe(
      'https://example.com/a?b=1'
    )
  })

  it('支持 // 开头的协议相对地址', () => {
    expect(normalizeQuickSiteUrl('//example.com/path')).toBe(
      'https://example.com/path'
    )
  })

  it('识别 host:port 形式并补 https', () => {
    expect(normalizeQuickSiteUrl('localhost:8080')).toBe(
      'https://localhost:8080/'
    )
    expect(normalizeQuickSiteUrl('example.com:8443/path')).toBe(
      'https://example.com:8443/path'
    )
  })

  it('拒绝危险 / 非 http 协议', () => {
    expect(normalizeQuickSiteUrl('javascript:alert(1)')).toBe('')
    expect(normalizeQuickSiteUrl('file:///etc/passwd')).toBe('')
    expect(normalizeQuickSiteUrl('data:text/html,<h1>x</h1>')).toBe('')
    expect(normalizeQuickSiteUrl('mailto:a@b.com')).toBe('')
  })

  it('空值、非字符串与超长网址返回空字符串', () => {
    expect(normalizeQuickSiteUrl('')).toBe('')
    expect(normalizeQuickSiteUrl('   ')).toBe('')
    expect(normalizeQuickSiteUrl(null)).toBe('')
    expect(normalizeQuickSiteUrl(42)).toBe('')
    const longUrl = `https://example.com/${'a'.repeat(QUICK_SITE_URL_MAX_LENGTH)}`
    expect(normalizeQuickSiteUrl(longUrl)).toBe('')
  })

  it('无法解析或主机名为空时返回空字符串', () => {
    expect(normalizeQuickSiteUrl('https://')).toBe('')
    expect(normalizeQuickSiteUrl('http://exa mple.com')).toBe('')
  })
})

describe('normalizeQuickSiteName', () => {
  it('去首尾空格并截断到 20 个字符', () => {
    expect(normalizeQuickSiteName('  工作台  ', 'https://x.com')).toBe('工作台')
    const longName = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸'
    expect(normalizeQuickSiteName(longName, 'https://x.com')).toHaveLength(
      QUICK_SITE_NAME_MAX_LENGTH
    )
  })

  it('为空时回退为去掉 www. 的域名', () => {
    expect(normalizeQuickSiteName('', 'https://www.bilibili.com/')).toBe(
      'bilibili.com'
    )
    expect(normalizeQuickSiteName('   ', 'https://github.com/a')).toBe(
      'github.com'
    )
    expect(normalizeQuickSiteName(undefined, 'https://x.com')).toBe('x.com')
  })

  it('网址非法时名称为空', () => {
    expect(normalizeQuickSiteName('', 'not a url')).toBe('')
  })
})

describe('hostOf', () => {
  it('解析成功返回 hostname', () => {
    expect(hostOf('https://www.example.com/path')).toBe('www.example.com')
  })

  it('解析失败返回空字符串', () => {
    expect(hostOf('not a url')).toBe('')
    expect(hostOf('')).toBe('')
  })
})

describe('isBrowserId', () => {
  it('只接受白名单内的浏览器标识', () => {
    expect(isBrowserId('chrome')).toBe(true)
    expect(isBrowserId('system')).toBe(true)
    expect(isBrowserId('edge')).toBe(true)
    expect(isBrowserId('unknown')).toBe(false)
    expect(isBrowserId('')).toBe(false)
    expect(isBrowserId(null)).toBe(false)
  })
})

describe('normalizeQuickSiteProfileId', () => {
  it('系统默认浏览器强制清空角色', () => {
    expect(normalizeQuickSiteProfileId('Default', 'system')).toBe('')
    expect(normalizeQuickSiteProfileId(null, 'system')).toBe('')
  })

  it('去首尾空格并截断到上限', () => {
    expect(normalizeQuickSiteProfileId('  Profile 1  ', 'chrome')).toBe(
      'Profile 1'
    )
    const longId = 'a'.repeat(QUICK_SITE_PROFILE_ID_MAX_LENGTH + 10)
    expect(normalizeQuickSiteProfileId(longId, 'chrome')).toHaveLength(
      QUICK_SITE_PROFILE_ID_MAX_LENGTH
    )
  })

  it('非字符串回退为空字符串', () => {
    expect(normalizeQuickSiteProfileId(123, 'chrome')).toBe('')
    expect(normalizeQuickSiteProfileId(undefined, 'chrome')).toBe('')
  })
})

describe('normalizeQuickSiteGroupName', () => {
  it('去首尾空格并截断到 20 个字符', () => {
    expect(normalizeQuickSiteGroupName('  日常办公  ')).toBe('日常办公')
    const longName = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸'
    expect(normalizeQuickSiteGroupName(longName)).toHaveLength(
      QUICK_SITE_GROUP_NAME_MAX_LENGTH
    )
  })

  it('空值与非字符串回退为空字符串', () => {
    expect(normalizeQuickSiteGroupName('   ')).toBe('')
    expect(normalizeQuickSiteGroupName(null)).toBe('')
    expect(normalizeQuickSiteGroupName(42)).toBe('')
    expect(normalizeQuickSiteGroupName(undefined)).toBe('')
  })
})

describe('normalizeQuickSiteGroupSiteIds', () => {
  it('去首尾空格、丢弃空串并去重保持首次顺序', () => {
    expect(
      normalizeQuickSiteGroupSiteIds([' a ', 'b', 'a', '', '   ', 'c', 'b'])
    ).toEqual(['a', 'b', 'c'])
  })

  it('非数组回退为空数组，非字符串项被丢弃', () => {
    expect(normalizeQuickSiteGroupSiteIds('a,b')).toEqual([])
    expect(normalizeQuickSiteGroupSiteIds(null)).toEqual([])
    expect(normalizeQuickSiteGroupSiteIds(undefined)).toEqual([])
    expect(
      normalizeQuickSiteGroupSiteIds(['a', 1, null, { id: 'b' }, 'b'])
    ).toEqual(['a', 'b'])
  })
})
