import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  downloadAssetTypeLabel,
  downloadPlatformLabel,
  formatBytes,
  isNewerVersion,
  normalizeVersion,
  parseRelease,
  releasePageUrl,
  selectDownloadAsset
} from './update'
import type { ReleaseAsset } from './update'

/** 构造测试用安装包资产 */
function asset(name: string, size = 0): ReleaseAsset {
  return { name, size, downloadUrl: `https://example.com/${name}` }
}

describe('normalizeVersion', () => {
  it('去掉前导 v / V 与首尾空白', () => {
    expect(normalizeVersion('v1.0.0')).toBe('1.0.0')
    expect(normalizeVersion('V2.1')).toBe('2.1')
    expect(normalizeVersion(' 1.0.0 ')).toBe('1.0.0')
    expect(normalizeVersion('1.0.0')).toBe('1.0.0')
  })
})

describe('compareVersions', () => {
  it('相等返回 0', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('更高返回 1、更低返回 -1', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1)
  })

  it('段数不同时缺失段按 0 处理', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
  })

  it('纯数字段按数值比较而非字典序', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1)
  })

  it('前导 v 会被忽略', () => {
    expect(compareVersions('v1.2.0', '1.1.9')).toBe(1)
  })

  it('非数字段退化为字典序，结果稳定', () => {
    // '0-beta' 与 '0' 并非纯数字段，按字典序比较：
    // '0' 是 '0-beta' 的严格前缀，因此 '0-beta' 更大，结果为 1
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(1)
  })
})

describe('isNewerVersion', () => {
  it('更新为 true、不更新与相等为 false', () => {
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
  })
})

describe('releasePageUrl', () => {
  it('拼出 GitHub 发行版页面地址', () => {
    expect(releasePageUrl('BigCleverXu', 'office-software', 'v1.0.0')).toBe(
      'https://github.com/BigCleverXu/office-software/releases/tag/v1.0.0'
    )
  })
})

describe('parseRelease', () => {
  it('完整对象解析出各字段并规范化版本', () => {
    const result = parseRelease(
      {
        tag_name: 'v1.2.0',
        name: '第二版',
        body: '更新说明',
        created_at: '2026-01-01T00:00:00+08:00'
      },
      'BigCleverXu',
      'office-software'
    )
    expect(result).toEqual({
      version: '1.2.0',
      tag: 'v1.2.0',
      title: '第二版',
      notes: '更新说明',
      publishedAt: '2026-01-01T00:00:00+08:00',
      pageUrl:
        'https://github.com/BigCleverXu/office-software/releases/tag/v1.2.0',
      assets: []
    })
  })

  it('缺 name 时 title 回退为 tag', () => {
    const result = parseRelease(
      { tag_name: 'v1.0.0' },
      'BigCleverXu',
      'office-software'
    )
    expect(result?.title).toBe('v1.0.0')
  })

  it('缺 body 时 notes 为空字符串', () => {
    const result = parseRelease(
      { tag_name: 'v1.0.0' },
      'BigCleverXu',
      'office-software'
    )
    expect(result?.notes).toBe('')
  })

  it('缺 created_at 时 publishedAt 为 null', () => {
    const result = parseRelease(
      { tag_name: 'v1.0.0' },
      'BigCleverXu',
      'office-software'
    )
    expect(result?.publishedAt).toBeNull()
  })

  it('缺 tag_name 时返回 null', () => {
    expect(
      parseRelease({ name: 'x' }, 'BigCleverXu', 'office-software')
    ).toBeNull()
  })

  it('传入 null / 字符串 / 数字时返回 null', () => {
    expect(parseRelease(null, 'BigCleverXu', 'office-software')).toBeNull()
    expect(parseRelease('text', 'BigCleverXu', 'office-software')).toBeNull()
    expect(parseRelease(123, 'BigCleverXu', 'office-software')).toBeNull()
  })
})

describe('parseRelease 资产解析', () => {
  const owner = 'BigCleverXu'
  const repo = 'office-software'

  it('解析多项资产并映射 downloadUrl', () => {
    const result = parseRelease(
      {
        tag_name: 'v1.2.0',
        assets: [
          {
            name: 'app-setup.exe',
            size: 1024,
            browser_download_url: 'https://example.com/app-setup.exe'
          },
          {
            name: 'app-arm64.dmg',
            size: 2048,
            browser_download_url: 'https://example.com/app-arm64.dmg'
          }
        ]
      },
      owner,
      repo
    )
    expect(result?.assets).toEqual([
      {
        name: 'app-setup.exe',
        size: 1024,
        downloadUrl: 'https://example.com/app-setup.exe'
      },
      {
        name: 'app-arm64.dmg',
        size: 2048,
        downloadUrl: 'https://example.com/app-arm64.dmg'
      }
    ])
  })

  it('缺 assets 时为空数组', () => {
    const result = parseRelease({ tag_name: 'v1.0.0' }, owner, repo)
    expect(result?.assets).toEqual([])
  })

  it('assets 非数组时为空数组', () => {
    const text = parseRelease(
      { tag_name: 'v1.0.0', assets: 'invalid' },
      owner,
      repo
    )
    const object = parseRelease({ tag_name: 'v1.0.0', assets: {} }, owner, repo)
    expect(text?.assets).toEqual([])
    expect(object?.assets).toEqual([])
  })

  it('名称或下载地址缺失 / 非字符串的条目被忽略', () => {
    const result = parseRelease(
      {
        tag_name: 'v1.0.0',
        assets: [
          null,
          { size: 1 },
          { name: '', browser_download_url: 'https://example.com/a.exe' },
          { name: 12, browser_download_url: 'https://example.com/b.exe' },
          { name: 'no-url.exe' },
          { name: 'bad-url.exe', browser_download_url: 42 },
          {
            name: 'ok.exe',
            browser_download_url: 'https://example.com/ok.exe'
          }
        ]
      },
      owner,
      repo
    )
    expect(result?.assets).toEqual([
      {
        name: 'ok.exe',
        size: 0,
        downloadUrl: 'https://example.com/ok.exe'
      }
    ])
  })

  it('size 非法时记为 0', () => {
    const result = parseRelease(
      {
        tag_name: 'v1.0.0',
        assets: [
          {
            name: 'negative.exe',
            size: -1,
            browser_download_url: 'https://example.com/1'
          },
          {
            name: 'nan.exe',
            size: Number.NaN,
            browser_download_url: 'https://example.com/2'
          },
          {
            name: 'infinite.exe',
            size: Number.POSITIVE_INFINITY,
            browser_download_url: 'https://example.com/3'
          },
          {
            name: 'text.exe',
            size: '1024',
            browser_download_url: 'https://example.com/4'
          },
          {
            name: 'ok.exe',
            size: 100,
            browser_download_url: 'https://example.com/5'
          }
        ]
      },
      owner,
      repo
    )
    expect(result?.assets.map((item) => item.size)).toEqual([0, 0, 0, 0, 100])
  })
})

describe('selectDownloadAsset', () => {
  it('Windows 只考虑 exe', () => {
    const assets = [asset('app-x64.zip'), asset('app-x64.exe')]
    expect(selectDownloadAsset(assets, 'win32', 'x64')?.name).toBe(
      'app-x64.exe'
    )
  })

  it('Windows 按架构匹配度排序', () => {
    const assets = [
      asset('app.exe'),
      asset('app-arm64.exe'),
      asset('app-x64.exe')
    ]
    expect(selectDownloadAsset(assets, 'win32', 'x64')?.name).toBe(
      'app-x64.exe'
    )
    expect(selectDownloadAsset(assets, 'win32', 'arm64')?.name).toBe(
      'app-arm64.exe'
    )
  })

  it('macOS arm64 优先 arm64 dmg', () => {
    const assets = [
      asset('app.dmg'),
      asset('app-x64.dmg'),
      asset('app-arm64.dmg')
    ]
    expect(selectDownloadAsset(assets, 'darwin', 'arm64')?.name).toBe(
      'app-arm64.dmg'
    )
  })

  it('macOS x64 优先 x64 dmg，其次未标注 dmg', () => {
    const marked = [asset('app.dmg'), asset('app-x64.dmg')]
    expect(selectDownloadAsset(marked, 'darwin', 'x64')?.name).toBe(
      'app-x64.dmg'
    )
    const unmarked = [asset('app-arm64.dmg'), asset('app.dmg')]
    expect(selectDownloadAsset(unmarked, 'darwin', 'x64')?.name).toBe('app.dmg')
  })

  it('macOS 无 dmg 时回退 zip', () => {
    const assets = [asset('app-arm64.zip'), asset('app-x64.zip')]
    expect(selectDownloadAsset(assets, 'darwin', 'arm64')?.name).toBe(
      'app-arm64.zip'
    )
  })

  it('macOS dmg 优先于架构更匹配的 zip', () => {
    const assets = [asset('app-arm64.zip'), asset('app-x64.dmg')]
    expect(selectDownloadAsset(assets, 'darwin', 'arm64')?.name).toBe(
      'app-x64.dmg'
    )
  })

  it('Linux 优先 AppImage 且扩展名大小写不敏感', () => {
    const assets = [asset('app-1.0.deb'), asset('App-1.0.APPIMAGE')]
    expect(selectDownloadAsset(assets, 'linux', 'x64')?.name).toBe(
      'App-1.0.APPIMAGE'
    )
  })

  it('Linux 无 AppImage 时回退 deb', () => {
    const assets = [asset('app-1.0.AppImage'), asset('app-1.0.deb')]
    expect(selectDownloadAsset(assets, 'linux', 'x64')?.name).toBe(
      'app-1.0.AppImage'
    )
    expect(
      selectDownloadAsset([asset('app-1.0.deb')], 'linux', 'x64')?.name
    ).toBe('app-1.0.deb')
  })

  it('其他平台或无匹配返回 null', () => {
    expect(selectDownloadAsset([asset('app.exe')], 'freebsd', 'x64')).toBeNull()
    expect(selectDownloadAsset([asset('app.dmg')], 'win32', 'x64')).toBeNull()
    expect(selectDownloadAsset([], 'darwin', 'arm64')).toBeNull()
  })

  it('得分相同保持原有顺序', () => {
    const assets = [asset('b.exe'), asset('a.exe')]
    expect(selectDownloadAsset(assets, 'win32', 'x64')?.name).toBe('b.exe')
  })
})

describe('downloadPlatformLabel', () => {
  it('已知平台返回展示名，未知平台返回原值', () => {
    expect(downloadPlatformLabel('win32')).toBe('Windows')
    expect(downloadPlatformLabel('darwin')).toBe('macOS')
    expect(downloadPlatformLabel('linux')).toBe('Linux')
    expect(downloadPlatformLabel('freebsd')).toBe('freebsd')
  })
})

describe('downloadAssetTypeLabel', () => {
  it('按扩展名返回类型名且大小写不敏感', () => {
    expect(downloadAssetTypeLabel(asset('app.exe'))).toBe('安装程序')
    expect(downloadAssetTypeLabel(asset('app.DMG'))).toBe('磁盘映像')
    expect(downloadAssetTypeLabel(asset('app.zip'))).toBe('压缩包')
    expect(downloadAssetTypeLabel(asset('app.AppImage'))).toBe('AppImage')
    expect(downloadAssetTypeLabel(asset('app.deb'))).toBe('deb 安装包')
    expect(downloadAssetTypeLabel(asset('app.msi'))).toBe('安装包')
  })
})

describe('formatBytes', () => {
  it('0 或非法值返回未知大小', () => {
    expect(formatBytes(0)).toBe('未知大小')
    expect(formatBytes(-1)).toBe('未知大小')
    expect(formatBytes(Number.NaN)).toBe('未知大小')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('未知大小')
  })

  it('按 B/KB/MB/GB 保留一位小数', () => {
    expect(formatBytes(512)).toBe('512.0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 130.8)).toBe('130.8 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
  })
})
