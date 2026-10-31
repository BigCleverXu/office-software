// 便签模块共享契约：主进程 / preload / 渲染层共用

/** 便签可选颜色 */
export type NoteColor = 'default' | 'yellow' | 'green' | 'blue' | 'pink'

/** 全部合法便签颜色，顺序即选择器展示顺序 */
export const NOTE_COLORS: readonly NoteColor[] = [
  'default',
  'yellow',
  'green',
  'blue',
  'pink'
]

/** 分类最大字符数 */
export const NOTE_CATEGORY_MAX_LENGTH = 12

/** 一条便签 */
export interface Note {
  /** 唯一标识 */
  id: string
  /** 标题 */
  title: string
  /** 正文 */
  content: string
  /** 分类，空字符串表示未分类 */
  category: string
  /** 卡片颜色 */
  color: NoteColor
  /** 是否置顶 */
  pinned: boolean
  /** 创建时间戳（毫秒） */
  createdAt: number
  /** 最近更新时间戳（毫秒） */
  updatedAt: number
}

/** 创建 / 编辑便签时提交的数据 */
export interface NoteDraft {
  title: string
  content: string
  /** 分类（可为空） */
  category: string
  color: NoteColor
  pinned: boolean
}

/** IPC 通道名称 */
export const NOTE_CHANNELS = {
  list: 'notes:list',
  create: 'notes:create',
  update: 'notes:update',
  remove: 'notes:delete',
  setCategory: 'notes:set-category',
  renameCategory: 'notes:rename-category',
  removeCategory: 'notes:remove-category',
  changed: 'notes:changed'
} as const

/** 渲染进程可用的便签 API（由 preload 暴露） */
export interface NoteApi {
  list: () => Promise<Note[]>
  create: (draft: NoteDraft) => Promise<Note>
  update: (id: string, draft: NoteDraft) => Promise<Note | null>
  remove: (id: string) => Promise<void>
  /** 批量设置指定便签的分类，返回受影响条数 */
  setCategory: (ids: string[], category: string) => Promise<number>
  /** 重命名分类，返回受影响条数（目标分类已存在时合并） */
  renameCategory: (from: string, to: string) => Promise<number>
  /** 删除分类，便签回落为未分类，返回受影响条数 */
  removeCategory: (name: string) => Promise<number>
  onChanged: (callback: (notes: Note[]) => void) => () => void
}

/** 判断 value 是否为合法的便签颜色（白名单校验） */
export function isNoteColor(value: unknown): value is NoteColor {
  return (
    typeof value === 'string' &&
    (NOTE_COLORS as readonly string[]).includes(value)
  )
}

/** 规整分类：非字符串回退为空，去首尾空格并截断到上限 */
export function normalizeNoteCategory(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim().slice(0, NOTE_CATEGORY_MAX_LENGTH)
}
