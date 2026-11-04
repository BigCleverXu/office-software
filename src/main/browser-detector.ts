// 主进程浏览器与角色探测：只依赖 node 内置能力，不依赖 electron
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  SYSTEM_BROWSER_ID,
  type BrowserId,
  type BrowserKind,
  type BrowserProfile,
  type DetectedBrowser
} from '../shared/quick-sites'

/** 探测依赖，可在测试中注入 */
export interface BrowserDetectOptions {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  homeDir?: string
  exists?: (path: string) => boolean
  readText?: (path: string) => string | null
}

/** 一个待探测的浏览器定义 */
interface BrowserCandidate {
  id: BrowserId
  name: string
  kind: BrowserKind
  executables: string[]
  /** Chromium 系用户数据目录 */
  userDataDir?: string
}

/** 解析后的 Firefox 角色段 */
interface FirefoxProfileSection {
  name?: string
  path: string
  isRelative: boolean
  isDefault: boolean
}

/** 系统默认浏览器，探测结果的第一项 */
const SYSTEM_BROWSER: DetectedBrowser = {
  id: SYSTEM_BROWSER_ID,
  name: '系统默认浏览器',
  kind: 'system',
  executable: '',
  profiles: []
}

/** 按平台取路径分隔符 */
function separatorOf(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '\\' : '/'
}

/** 按目标平台拼接路径（不依赖宿主机 path 实现） */
function joinPath(platform: NodeJS.Platform, ...parts: string[]): string {
  const separator = separatorOf(platform)
  let result = ''
  for (const part of parts) {
    if (part === '') {
      continue
    }
    if (result === '') {
      result = part
      continue
    }
    result =
      result.replace(/[\\/]+$/, '') + separator + part.replace(/^[\\/]+/, '')
  }
  return result
}

/** 从环境变量中按多个大小写形式取第一个非空值 */
function envOf(
  env: Record<string, string | undefined>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = env[name]
    if (typeof value === 'string' && value !== '') {
      return value
    }
  }
  return undefined
}

/** 取路径最后一段作为文件名 */
function basenameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : path
}

/** 取路径所在目录（按目标平台） */
function dirnameOf(platform: NodeJS.Platform, path: string): string {
  const separator = separatorOf(platform)
  const normalized = path.replace(/[\\/]+/g, separator)
  const index = normalized.lastIndexOf(separator)
  return index <= 0 ? normalized : normalized.slice(0, index)
}

/** 判断是否为绝对路径 */
function isAbsolutePath(platform: NodeJS.Platform, path: string): boolean {
  if (platform === 'win32') {
    return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
  }
  return path.startsWith('/')
}

/** 解析 Firefox profiles.ini 中的相对 / 绝对角色目录 */
function resolveProfilePath(
  platform: NodeJS.Platform,
  iniDir: string,
  rawPath: string
): string {
  const path = rawPath.trim()
  if (isAbsolutePath(platform, path)) {
    return path
  }
  return joinPath(platform, iniDir, path)
}

/** 默认读取文本实现：读取失败返回 null */
function defaultReadText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

/** 判断是否为普通对象（排除数组与 null） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 取非空字符串，否则返回 undefined */
function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 自然排序比较器：数字按数值大小，其余忽略大小写 */
const NATURAL_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base'
})

/**
 * 读取 Chromium 系浏览器的角色列表。
 * 从 `<userDataDir>/Local State` 的 `profile.info_cache` 枚举角色目录名与
 * 显示名称；仅保留目录真实存在的项，Default 排第一，其余按名称自然排序。
 * 文件缺失 / JSON 损坏 / 结构不符时降级为空数组。
 */
function readChromiumProfiles(
  platform: NodeJS.Platform,
  userDataDir: string | undefined,
  exists: (path: string) => boolean,
  readText: (path: string) => string | null
): BrowserProfile[] {
  if (userDataDir === undefined) {
    return []
  }
  const text = readText(joinPath(platform, userDataDir, 'Local State'))
  if (text === null) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!isRecord(parsed) || !isRecord(parsed.profile)) {
    return []
  }
  const infoCache = parsed.profile.info_cache
  if (!isRecord(infoCache)) {
    return []
  }
  const profiles: BrowserProfile[] = []
  for (const [key, rawValue] of Object.entries(infoCache)) {
    if (!exists(joinPath(platform, userDataDir, key))) {
      continue
    }
    const value = isRecord(rawValue) ? rawValue : {}
    const name =
      stringOrUndefined(value.name) ?? stringOrUndefined(value.gaia_name) ?? key
    profiles.push({ id: key, name })
  }
  profiles.sort((a, b) => {
    if (a.id === 'Default') {
      return -1
    }
    if (b.id === 'Default') {
      return 1
    }
    return NATURAL_COLLATOR.compare(a.name, b.name)
  })
  return profiles
}

/** 解析 profiles.ini 文本，仅收集 [ProfileN] 段 */
function parseFirefoxIni(text: string): FirefoxProfileSection[] {
  const sections: FirefoxProfileSection[] = []
  let current: Record<string, string> | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith(';') || line.startsWith('#')) {
      continue
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const sectionName = line.slice(1, -1).trim().toLowerCase()
      current = sectionName.startsWith('profile') ? {} : null
      if (current !== null) {
        sections.push({
          path: '',
          isRelative: true,
          isDefault: false
        })
      }
      continue
    }
    if (current === null) {
      continue
    }
    const separator = line.indexOf('=')
    if (separator <= 0) {
      continue
    }
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    const section = sections[sections.length - 1]
    if (key === 'name') {
      section.name = value
    } else if (key === 'path') {
      section.path = value
    } else if (key === 'isrelative') {
      section.isRelative = value !== '0'
    } else if (key === 'default') {
      section.isDefault = value === '1' || value.toLowerCase() === 'true'
    }
  }
  return sections.filter((section) => section.path !== '')
}

/**
 * 读取 Firefox 角色列表：解析 profiles.ini，角色 id 为配置目录绝对路径。
 * 相对路径按 ini 所在目录解析；Default=1 排第一；名称缺失用目录名。
 * 文件缺失 / 内容损坏时降级为空数组。
 */
function readFirefoxProfiles(
  platform: NodeJS.Platform,
  iniPath: string,
  readText: (path: string) => string | null
): BrowserProfile[] {
  const text = readText(iniPath)
  if (text === null) {
    return []
  }
  let sections: FirefoxProfileSection[]
  try {
    sections = parseFirefoxIni(text)
  } catch {
    return []
  }
  const iniDir = dirnameOf(platform, iniPath)
  const profiles = sections.map((section) => {
    const id = resolveProfilePath(platform, iniDir, section.path)
    const name = stringOrUndefined(section.name) ?? basenameOf(id)
    return { profile: { id, name }, isDefault: section.isDefault }
  })
  const defaults = profiles.filter((item) => item.isDefault)
  const rest = profiles.filter((item) => !item.isDefault)
  return [...defaults, ...rest].map((item) => item.profile)
}

/** Windows 常用目录 */
function windowsDirs(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  homeDir: string
): {
  programFiles: string
  programFilesX86: string
  localAppData: string
  appData: string
} {
  return {
    programFiles:
      envOf(env, 'PROGRAMFILES', 'ProgramFiles') ?? 'C:\\Program Files',
    programFilesX86:
      envOf(
        env,
        'PROGRAMFILES(X86)',
        'ProgramFiles(x86)',
        'ProgramFiles(X86)'
      ) ?? 'C:\\Program Files (x86)',
    localAppData:
      envOf(env, 'LOCALAPPDATA', 'LocalAppData') ??
      joinPath(platform, homeDir, 'AppData', 'Local'),
    appData:
      envOf(env, 'APPDATA', 'AppData') ??
      joinPath(platform, homeDir, 'AppData', 'Roaming')
  }
}

/** Windows 浏览器候选 */
function windowsCandidates(
  env: Record<string, string | undefined>,
  homeDir: string
): BrowserCandidate[] {
  const platform: NodeJS.Platform = 'win32'
  const { programFiles, programFilesX86, localAppData, appData } = windowsDirs(
    platform,
    env,
    homeDir
  )
  return [
    {
      id: 'chrome',
      name: 'Google Chrome',
      kind: 'chromium',
      executables: [
        joinPath(
          platform,
          programFiles,
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        ),
        joinPath(
          platform,
          programFilesX86,
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        ),
        joinPath(
          platform,
          localAppData,
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        )
      ],
      userDataDir: joinPath(
        platform,
        localAppData,
        'Google',
        'Chrome',
        'User Data'
      )
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      kind: 'chromium',
      executables: [
        joinPath(
          platform,
          programFilesX86,
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        ),
        joinPath(
          platform,
          programFiles,
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        ),
        joinPath(
          platform,
          localAppData,
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        )
      ],
      userDataDir: joinPath(
        platform,
        localAppData,
        'Microsoft',
        'Edge',
        'User Data'
      )
    },
    {
      id: 'firefox',
      name: 'Mozilla Firefox',
      kind: 'firefox',
      executables: [
        joinPath(platform, programFiles, 'Mozilla Firefox', 'firefox.exe'),
        joinPath(platform, programFilesX86, 'Mozilla Firefox', 'firefox.exe')
      ]
    },
    {
      id: 'brave',
      name: 'Brave',
      kind: 'chromium',
      executables: [
        joinPath(
          platform,
          programFiles,
          'BraveSoftware',
          'Brave-Browser',
          'Application',
          'brave.exe'
        ),
        joinPath(
          platform,
          programFilesX86,
          'BraveSoftware',
          'Brave-Browser',
          'Application',
          'brave.exe'
        ),
        joinPath(
          platform,
          localAppData,
          'BraveSoftware',
          'Brave-Browser',
          'Application',
          'brave.exe'
        )
      ],
      userDataDir: joinPath(
        platform,
        localAppData,
        'BraveSoftware',
        'Brave-Browser',
        'User Data'
      )
    },
    {
      id: 'vivaldi',
      name: 'Vivaldi',
      kind: 'chromium',
      executables: [
        joinPath(
          platform,
          localAppData,
          'Vivaldi',
          'Application',
          'vivaldi.exe'
        ),
        joinPath(
          platform,
          programFiles,
          'Vivaldi',
          'Application',
          'vivaldi.exe'
        )
      ],
      userDataDir: joinPath(platform, localAppData, 'Vivaldi', 'User Data')
    },
    {
      id: 'opera',
      name: 'Opera',
      kind: 'chromium',
      executables: [
        joinPath(platform, localAppData, 'Programs', 'Opera', 'opera.exe')
      ],
      userDataDir: joinPath(platform, appData, 'Opera Software', 'Opera Stable')
    }
  ]
}

/** macOS 应用包内的可执行文件路径 */
function macExecutable(appName: string, binary: string): string {
  const platform: NodeJS.Platform = 'darwin'
  return joinPath(
    platform,
    '/Applications',
    `${appName}.app`,
    'Contents',
    'MacOS',
    binary
  )
}

/** macOS 浏览器候选 */
function macCandidates(homeDir: string): BrowserCandidate[] {
  const platform: NodeJS.Platform = 'darwin'
  const support = joinPath(platform, homeDir, 'Library', 'Application Support')
  return [
    {
      id: 'chrome',
      name: 'Google Chrome',
      kind: 'chromium',
      executables: [macExecutable('Google Chrome', 'Google Chrome')],
      userDataDir: joinPath(platform, support, 'Google', 'Chrome')
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      kind: 'chromium',
      executables: [macExecutable('Microsoft Edge', 'Microsoft Edge')],
      userDataDir: joinPath(platform, support, 'Microsoft Edge')
    },
    {
      id: 'firefox',
      name: 'Mozilla Firefox',
      kind: 'firefox',
      executables: [macExecutable('Firefox', 'firefox')]
    },
    {
      id: 'brave',
      name: 'Brave',
      kind: 'chromium',
      executables: [macExecutable('Brave Browser', 'Brave Browser')],
      userDataDir: joinPath(platform, support, 'BraveSoftware', 'Brave-Browser')
    },
    {
      id: 'vivaldi',
      name: 'Vivaldi',
      kind: 'chromium',
      executables: [macExecutable('Vivaldi', 'Vivaldi')],
      userDataDir: joinPath(platform, support, 'Vivaldi')
    },
    {
      id: 'opera',
      name: 'Opera',
      kind: 'chromium',
      executables: [macExecutable('Opera', 'Opera')],
      userDataDir: joinPath(platform, support, 'com.operasoftware.Opera')
    },
    {
      id: 'safari',
      name: 'Safari',
      kind: 'safari',
      executables: [macExecutable('Safari', 'Safari')]
    }
  ]
}

/** Linux 可执行文件候选：常见目录 × 常见命令名 */
function linuxExecutables(names: string[], extra: string[] = []): string[] {
  const platform: NodeJS.Platform = 'linux'
  const dirs = ['/usr/bin', '/opt', '/snap/bin']
  const paths: string[] = []
  for (const dir of dirs) {
    for (const name of names) {
      paths.push(joinPath(platform, dir, name))
    }
  }
  return [...paths, ...extra]
}

/** Linux 浏览器候选 */
function linuxCandidates(homeDir: string): BrowserCandidate[] {
  const platform: NodeJS.Platform = 'linux'
  const config = joinPath(platform, homeDir, '.config')
  return [
    {
      id: 'chrome',
      name: 'Google Chrome',
      kind: 'chromium',
      executables: linuxExecutables(
        [
          'google-chrome',
          'google-chrome-stable',
          'chromium',
          'chromium-browser'
        ],
        ['/opt/google/chrome/chrome']
      ),
      userDataDir: joinPath(platform, config, 'google-chrome')
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      kind: 'chromium',
      executables: linuxExecutables(
        ['microsoft-edge', 'microsoft-edge-stable'],
        ['/opt/microsoft/msedge/msedge']
      ),
      userDataDir: joinPath(platform, config, 'microsoft-edge')
    },
    {
      id: 'firefox',
      name: 'Mozilla Firefox',
      kind: 'firefox',
      executables: linuxExecutables(['firefox'], ['/opt/firefox/firefox'])
    },
    {
      id: 'brave',
      name: 'Brave',
      kind: 'chromium',
      executables: linuxExecutables(
        ['brave-browser', 'brave'],
        ['/opt/brave.com/brave/brave']
      ),
      userDataDir: joinPath(platform, config, 'BraveSoftware', 'Brave-Browser')
    },
    {
      id: 'vivaldi',
      name: 'Vivaldi',
      kind: 'chromium',
      executables: linuxExecutables(['vivaldi'], ['/opt/vivaldi/vivaldi']),
      userDataDir: joinPath(platform, config, 'vivaldi')
    },
    {
      id: 'opera',
      name: 'Opera',
      kind: 'chromium',
      executables: linuxExecutables(['opera']),
      userDataDir: joinPath(platform, config, 'opera')
    }
  ]
}

/** Firefox profiles.ini 路径 */
function firefoxIniPath(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  homeDir: string
): string {
  if (platform === 'win32') {
    const { appData } = windowsDirs(platform, env, homeDir)
    return joinPath(platform, appData, 'Mozilla', 'Firefox', 'profiles.ini')
  }
  if (platform === 'darwin') {
    return joinPath(
      platform,
      homeDir,
      'Library',
      'Application Support',
      'Firefox',
      'profiles.ini'
    )
  }
  return joinPath(platform, homeDir, '.mozilla', 'firefox', 'profiles.ini')
}

/** 按平台构建浏览器候选，顺序即探测优先级 */
function buildCandidates(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  homeDir: string
): BrowserCandidate[] {
  if (platform === 'win32') {
    return windowsCandidates(env, homeDir)
  }
  if (platform === 'darwin') {
    return macCandidates(homeDir)
  }
  if (platform === 'linux') {
    return linuxCandidates(homeDir)
  }
  return []
}

/**
 * 探测本机浏览器与角色列表，结果始终以「系统默认浏览器」开头。
 * 同步只读本地文件，不发起网络请求；任何解析失败都降级为空角色列表。
 */
export function detectBrowsers(
  options?: BrowserDetectOptions
): DetectedBrowser[] {
  const platform = options?.platform ?? process.platform
  const env = options?.env ?? process.env
  const homeDir = options?.homeDir ?? homedir()
  const exists = options?.exists ?? existsSync
  const readText = options?.readText ?? defaultReadText
  const browsers: DetectedBrowser[] = [{ ...SYSTEM_BROWSER }]
  for (const candidate of buildCandidates(platform, env, homeDir)) {
    const executable = candidate.executables.find((path) => exists(path))
    if (executable === undefined) {
      continue
    }
    let profiles: BrowserProfile[] = []
    if (candidate.kind === 'chromium') {
      profiles = readChromiumProfiles(
        platform,
        candidate.userDataDir,
        exists,
        readText
      )
    } else if (candidate.kind === 'firefox') {
      profiles = readFirefoxProfiles(
        platform,
        firefoxIniPath(platform, env, homeDir),
        readText
      )
    }
    browsers.push({
      id: candidate.id,
      name: candidate.name,
      kind: candidate.kind,
      executable,
      profiles
    })
  }
  return browsers
}
