import { describe, expect, it } from 'vitest'
import { detectBrowsers } from './browser-detector'

/** 构造注入依赖：paths 表示存在的文件 / 目录，files 表示可读取的文本 */
function makeDeps(
  paths: string[],
  files: Record<string, string> = {}
): {
  exists: (path: string) => boolean
  readText: (path: string) => string | null
} {
  const existing = new Set(paths)
  return {
    exists: (path) => existing.has(path),
    readText: (path) => files[path] ?? null
  }
}

/** Windows 测试环境变量与用户目录 */
const windowsEnv = {
  PROGRAMFILES: 'C:\\Program Files',
  'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local',
  APPDATA: 'C:\\Users\\alice\\AppData\\Roaming'
}
const windowsHome = 'C:\\Users\\alice'
const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const chromeUserData =
  'C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data'
const chromeLocalState = `${chromeUserData}\\Local State`

describe('detectBrowsers', () => {
  it('Windows 识别 Chrome 多角色：Default 优先、过滤不存在目录、支持中文名', () => {
    const infoCache = {
      profile: {
        info_cache: {
          'Profile 10': { name: 'Profile 10' },
          'Profile 2': { name: 'Profile 2' },
          'Profile 1': { name: 'Profile 1' },
          Default: { name: '工作' },
          'Guest Profile': { name: '访客' }
        }
      }
    }
    const { exists, readText } = makeDeps(
      [
        chromeExe,
        `${chromeUserData}\\Default`,
        `${chromeUserData}\\Profile 1`,
        `${chromeUserData}\\Profile 2`,
        `${chromeUserData}\\Profile 10`
      ],
      { [chromeLocalState]: JSON.stringify(infoCache) }
    )

    const browsers = detectBrowsers({
      platform: 'win32',
      env: windowsEnv,
      homeDir: windowsHome,
      exists,
      readText
    })

    expect(browsers).toHaveLength(2)
    expect(browsers[0]).toMatchObject({
      id: 'system',
      name: '系统默认浏览器',
      kind: 'system',
      executable: '',
      profiles: []
    })
    expect(browsers[1]).toMatchObject({
      id: 'chrome',
      name: 'Google Chrome',
      kind: 'chromium',
      executable: chromeExe
    })
    expect(browsers[1].profiles.map((profile) => profile.id)).toEqual([
      'Default',
      'Profile 1',
      'Profile 2',
      'Profile 10'
    ])
    expect(browsers[1].profiles.map((profile) => profile.name)).toEqual([
      '工作',
      'Profile 1',
      'Profile 2',
      'Profile 10'
    ])
  })

  it('Windows 识别 Edge', () => {
    const edgeExe =
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    const edgeUserData =
      'C:\\Users\\alice\\AppData\\Local\\Microsoft\\Edge\\User Data'
    const { exists, readText } = makeDeps(
      [edgeExe, `${edgeUserData}\\Default`],
      {
        [`${edgeUserData}\\Local State`]: JSON.stringify({
          profile: { info_cache: { Default: { name: 'Personal' } } }
        })
      }
    )

    const browsers = detectBrowsers({
      platform: 'win32',
      env: windowsEnv,
      homeDir: windowsHome,
      exists,
      readText
    })

    expect(browsers.map((browser) => browser.id)).toEqual(['system', 'edge'])
    expect(browsers[1]).toMatchObject({
      name: 'Microsoft Edge',
      kind: 'chromium',
      executable: edgeExe
    })
    expect(browsers[1].profiles).toEqual([{ id: 'Default', name: 'Personal' }])
  })

  it('损坏的 Local State 降级为空角色，但浏览器仍可用', () => {
    const { exists, readText } = makeDeps([chromeExe], {
      [chromeLocalState]: '{'
    })

    const browsers = detectBrowsers({
      platform: 'win32',
      env: windowsEnv,
      homeDir: windowsHome,
      exists,
      readText
    })

    expect(browsers).toHaveLength(2)
    expect(browsers[1].id).toBe('chrome')
    expect(browsers[1].profiles).toEqual([])
  })

  it('macOS 解析 Firefox profiles.ini 的相对与绝对路径', () => {
    const firefoxExe = '/Applications/Firefox.app/Contents/MacOS/firefox'
    const iniPath =
      '/Users/alice/Library/Application Support/Firefox/profiles.ini'
    const ini = [
      '[General]',
      'StartWithLastProfile=1',
      '',
      '[Profile0]',
      'Name=default-release',
      'IsRelative=1',
      'Path=Profiles/abc.default-release',
      'Default=1',
      '',
      '[Profile1]',
      'Name=Work',
      'IsRelative=0',
      'Path=/Volumes/Data/firefox-work',
      ''
    ].join('\n')
    const { exists, readText } = makeDeps([firefoxExe], {
      [iniPath]: ini
    })

    const browsers = detectBrowsers({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/alice',
      exists,
      readText
    })

    expect(browsers.map((browser) => browser.id)).toEqual(['system', 'firefox'])
    expect(browsers[1].kind).toBe('firefox')
    expect(browsers[1].profiles).toEqual([
      {
        id: '/Users/alice/Library/Application Support/Firefox/Profiles/abc.default-release',
        name: 'default-release'
      },
      { id: '/Volumes/Data/firefox-work', name: 'Work' }
    ])
  })

  it('Safari 角色列表恒为空', () => {
    const safariExe = '/Applications/Safari.app/Contents/MacOS/Safari'
    const { exists, readText } = makeDeps([safariExe])

    const browsers = detectBrowsers({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/alice',
      exists,
      readText
    })

    expect(browsers.map((browser) => browser.id)).toEqual(['system', 'safari'])
    expect(browsers[1].profiles).toEqual([])
  })

  it('Linux 未安装任何浏览器时只返回系统默认浏览器', () => {
    const { exists, readText } = makeDeps([])

    const browsers = detectBrowsers({
      platform: 'linux',
      env: {},
      homeDir: '/home/alice',
      exists,
      readText
    })

    expect(browsers).toEqual([
      {
        id: 'system',
        name: '系统默认浏览器',
        kind: 'system',
        executable: '',
        profiles: []
      }
    ])
  })

  it('Linux 识别 Chrome 并读取角色', () => {
    const chromeExe = '/usr/bin/google-chrome'
    const userData = '/home/alice/.config/google-chrome'
    const { exists, readText } = makeDeps([chromeExe, `${userData}/Default`], {
      [`${userData}/Local State`]: JSON.stringify({
        profile: { info_cache: { Default: { gaia_name: 'Alice' } } }
      })
    })

    const browsers = detectBrowsers({
      platform: 'linux',
      env: {},
      homeDir: '/home/alice',
      exists,
      readText
    })

    expect(browsers.map((browser) => browser.id)).toEqual(['system', 'chrome'])
    expect(browsers[1].profiles).toEqual([{ id: 'Default', name: 'Alice' }])
  })
})
