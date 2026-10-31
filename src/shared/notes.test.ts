import { describe, expect, it } from 'vitest'
import { normalizeNoteCategory } from './notes'

describe('normalizeNoteCategory', () => {
  it('非字符串回退为空字符串', () => {
    expect(normalizeNoteCategory(null)).toBe('')
    expect(normalizeNoteCategory(undefined)).toBe('')
    expect(normalizeNoteCategory(123)).toBe('')
    expect(normalizeNoteCategory({ name: '工作' })).toBe('')
  })

  it('普通字符串原样返回', () => {
    expect(normalizeNoteCategory('工作')).toBe('工作')
    expect(normalizeNoteCategory('life')).toBe('life')
  })

  it('去除首尾空格', () => {
    expect(normalizeNoteCategory('  工作  ')).toBe('工作')
    expect(normalizeNoteCategory('\t学习\n')).toBe('学习')
  })

  it('仅空格返回空字符串', () => {
    expect(normalizeNoteCategory('   ')).toBe('')
  })

  it('超过 12 个字符截断到 12 个字符', () => {
    const source = '一二三四五六七八九十甲乙丙'
    const result = normalizeNoteCategory(source)
    expect(result).toHaveLength(12)
    expect(result).toBe('一二三四五六七八九十甲乙')
  })
})
