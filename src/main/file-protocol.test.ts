import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  contentTypeOf,
  createFileResponse,
  parseAppFilePath,
  parseRange,
  toAppFileUrl
} from './file-protocol'

const tempDirs: string[] = []

/** 创建临时目录并登记，供 afterEach 统一清理 */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'file-protocol-'))
  tempDirs.push(dir)
  return dir
}

/** 在临时目录下写入文件，返回绝对路径 */
function createFile(name: string, content: string): string {
  const dir = makeTempDir()
  const fullPath = join(dir, name)
  writeFileSync(fullPath, content)
  return fullPath
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.length = 0
})

describe('toAppFileUrl / parseAppFilePath 往返', () => {
  it.each([
    ['/home/a.png'],
    ['/home/中文图片.png'],
    ['/home/a b.png'],
    ['/home/a#b.png'],
    ['C:\\Users\\a.png']
  ])('%s 编码后能还原为原路径', (filePath) => {
    const url = toAppFileUrl(filePath)
    expect(url.startsWith('app-file://local/')).toBe(true)
    expect(parseAppFilePath(url)).toBe(filePath)
  })

  it('普通路径编码为百分号形式，避开分隔符歧义', () => {
    expect(toAppFileUrl('/home/a.png')).toBe('app-file://local/%2Fhome%2Fa.png')
  })
})

describe('parseAppFilePath 非法输入', () => {
  it('错误 host / 非 app-file 协议返回 null', () => {
    expect(parseAppFilePath('app-file://other/%2Fhome%2Fa.png')).toBe(null)
    expect(parseAppFilePath('file:///home/a.png')).toBe(null)
  })

  it('无法解析、解码失败或空路径返回 null', () => {
    expect(parseAppFilePath('not a url')).toBe(null)
    expect(parseAppFilePath('app-file://local/%E0%A4%A')).toBe(null)
    expect(parseAppFilePath('app-file://local/')).toBe(null)
  })
})

describe('contentTypeOf', () => {
  it.each([
    ['/home/a.png', 'image/png'],
    ['/home/a.mp3', 'audio/mpeg'],
    ['/home/a.mp4', 'video/mp4'],
    ['/home/a.md', 'text/plain; charset=utf-8'],
    ['/home/a.bin', 'application/octet-stream']
  ])('%s 的 MIME 为 %s', (filePath, expected) => {
    expect(contentTypeOf(filePath)).toBe(expected)
  })
})

describe('parseRange', () => {
  const size = 1000

  it('解析 start-end / start- / -suffix 三种形式', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=100-', size)).toEqual({ start: 100, end: 999 })
    expect(parseRange('bytes=-50', size)).toEqual({ start: 950, end: 999 })
  })

  it('end 越界夹取到 size-1，suffix 超长取整文件', () => {
    expect(parseRange('bytes=0-2000', size)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=-5000', size)).toEqual({ start: 0, end: 999 })
  })

  it('多段、非法格式、start 越界或 size 非正数返回 null', () => {
    expect(parseRange('bytes=0-99,200-299', size)).toBe(null)
    expect(parseRange('items=0-99', size)).toBe(null)
    expect(parseRange('bytes=abc-99', size)).toBe(null)
    expect(parseRange('bytes=99-0', size)).toBe(null)
    expect(parseRange('bytes=1000-', size)).toBe(null)
    expect(parseRange(null, size)).toBe(null)
    expect(parseRange('bytes=0-99', 0)).toBe(null)
  })
})

describe('createFileResponse', () => {
  it('常规请求返回 200、完整头与文件内容', async () => {
    const filePath = createFile('note.txt', 'abcdefghij')
    const response = await createFileResponse(filePath, null)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8'
    )
    expect(response.headers.get('content-length')).toBe('10')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(await response.text()).toBe('abcdefghij')
  })

  it('Range 请求返回 206、切片头与切片内容', async () => {
    const filePath = createFile('note.txt', 'abcdefghij')
    const response = await createFileResponse(filePath, 'bytes=2-5')

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('cdef')
  })

  it('文件不存在或不是普通文件返回 404', async () => {
    const missing = join(makeTempDir(), 'missing.txt')
    const dirPath = makeTempDir()

    expect((await createFileResponse(missing, null)).status).toBe(404)
    expect((await createFileResponse(dirPath, null)).status).toBe(404)
  })
})
