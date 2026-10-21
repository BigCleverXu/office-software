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

/** 一条便签 */
export interface Note {
  /** 唯一标识 */
  id: string
  /** 标题 */
  title: string
  /** 正文 */
  content: string
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
  color: NoteColor
  pinned: boolean
}

/** IPC 通道名称 */
export const NOTE_CHANNELS = {
  list: 'notes:list',
  create: 'notes:create',
  update: 'notes:update',
  remove: 'notes:delete',
  changed: 'notes:changed'
} as const

/** 渲染进程可用的便签 API（由 preload 暴露） */
export interface NoteApi {
  list: () => Promise<Note[]>
  create: (draft: NoteDraft) => Promise<Note>
  update: (id: string, draft: NoteDraft) => Promise<Note | null>
  remove: (id: string) => Promise<void>
  onChanged: (callback: (notes: Note[]) => void) => () => void
}

/** 判断 value 是否为合法的便签颜色（白名单校验） */
export function isNoteColor(value: unknown): value is NoteColor {
  return (
    typeof value === 'string' &&
    (NOTE_COLORS as readonly string[]).includes(value)
  )
}
