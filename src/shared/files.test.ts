import { describe, expect, it } from 'vitest'
import {
  ALL_KIND_LABEL,
  FILE_KINDS,
  FILE_KIND_LABELS,
  IMAGE_EXTENSIONS,
  MAX_RESULTS,
  MAX_TEXT_PREVIEW_BYTES,
  fileExtensionOf,
  fileKindOf
} from './files'

describe('fileKindOf', () => {
  it('常见扩展名分类正确', () => {
    expect(fileKindOf('photo.png')).toBe('image')
    expect(fileKindOf('report.pdf')).toBe('document')
    expect(fileKindOf('movie.mp4')).toBe('video')
    expect(fileKindOf('song.mp3')).toBe('audio')
    expect(fileKindOf('bundle.zip')).toBe('archive')
    expect(fileKindOf('main.ts')).toBe('code')
    expect(fileKindOf('App.vue')).toBe('code')
  })

  it('扩展名大小写不敏感', () => {
    expect(fileKindOf('PHOTO.PNG')).toBe('image')
    expect(fileKindOf('REPORT.PDF')).toBe('document')
    expect(fileKindOf('Song.Mp3')).toBe('audio')
  })

  it('多级扩展名按最后一个点判定', () => {
    expect(fileKindOf('a.tar.gz')).toBe('archive')
    expect(fileKindOf('a.min.js')).toBe('code')
    expect(fileKindOf('backup.json.gz')).toBe('archive')
  })

  it('无扩展名归为 other', () => {
    expect(fileKindOf('README')).toBe('other')
    expect(fileKindOf('a-b-c')).toBe('other')
    expect(fileKindOf('')).toBe('other')
  })

  it('以点开头的隐藏文件无扩展名，归为 other', () => {
    expect(fileExtensionOf('.env')).toBe('')
    expect(fileKindOf('.env')).toBe('other')
    expect(fileKindOf('.gitignore')).toBe('other')
  })

  it('隐藏文件带第二段扩展名时仍按该扩展名判定', () => {
    expect(fileExtensionOf('.env.local')).toBe('local')
    expect(fileKindOf('.env.local')).toBe('other')
    expect(fileKindOf('.eslintrc.json')).toBe('code')
  })

  it('未知扩展名归为 other', () => {
    expect(fileKindOf('data.xyz')).toBe('other')
    expect(fileKindOf('font.woff2')).toBe('other')
  })

  it('含路径时只看最后一段文件名', () => {
    expect(fileKindOf('/home/user/photo.PNG')).toBe('image')
    expect(fileKindOf('C:\\Users\\me\\report.pdf')).toBe('document')
    expect(fileKindOf('dir.with.dots/README')).toBe('other')
  })
})

describe('fileExtensionOf', () => {
  it('返回小写且不含点', () => {
    expect(fileExtensionOf('photo.PNG')).toBe('png')
    expect(fileExtensionOf('Report.Pdf')).toBe('pdf')
    expect(fileExtensionOf('a.tar.gz')).toBe('gz')
    expect(fileExtensionOf('/tmp/a.B.C.D')).toBe('d')
  })

  it('无扩展名、空串、末尾为点返回空字符串', () => {
    expect(fileExtensionOf('README')).toBe('')
    expect(fileExtensionOf('')).toBe('')
    expect(fileExtensionOf('weird.')).toBe('')
  })
})

describe('常量', () => {
  it('FILE_KINDS 顺序固定', () => {
    expect(FILE_KINDS).toEqual([
      'image',
      'document',
      'video',
      'audio',
      'archive',
      'code',
      'other'
    ])
  })

  it('FILE_KIND_LABELS 与 FILE_KINDS 一一对应', () => {
    for (const kind of FILE_KINDS) {
      expect(FILE_KIND_LABELS[kind]).toBeTruthy()
    }
    expect(FILE_KIND_LABELS.image).toBe('图片')
    expect(FILE_KIND_LABELS.archive).toBe('压缩包')
    expect(ALL_KIND_LABEL).toBe('全部')
  })

  it('预览与结果上限常量取值正确', () => {
    expect(MAX_RESULTS).toBe(200)
    expect(MAX_TEXT_PREVIEW_BYTES).toBe(204800)
    expect(IMAGE_EXTENSIONS).toContain('png')
    expect(IMAGE_EXTENSIONS).toContain('avif')
  })
})
