import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  normalizeQuickSiteGroupName,
  normalizeQuickSiteGroupSiteIds,
  type QuickSiteGroup,
  type QuickSiteGroupDraft,
  type QuickSiteGroupSaveResult
} from '../shared/quick-sites'
import type { QuickSiteGroupRow } from './database'

/** 编组名称为空的提示 */
const EMPTY_NAME_ERROR = '请输入编组名称'

/** 编组未选择站点的提示 */
const EMPTY_SITES_ERROR = '请至少选择一个网站'

/** 编组不存在的提示 */
const NOT_FOUND_ERROR = '编组不存在'

/** 读取当前最大排序序号后的下一个值 */
interface SortRow {
  next: number
}

/** quick_sites 表 id 查询结果 */
interface SiteIdRow {
  id: string
}

/** 解析 site_ids 列：非法 JSON 回退空数组后统一规整 */
function parseSiteIds(value: unknown): string[] {
  if (typeof value !== 'string') {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  return normalizeQuickSiteGroupSiteIds(parsed)
}

/**
 * 快捷网站编组的本地持久化存储。
 *
 * 数据保存在注入的 SQLite 数据库（`quick_site_groups` 表）中，由
 * database.ts 负责建表；本类只做单表读写，并在读写边界统一规整脏数据。
 * 编组内的站点 id 始终与 `quick_sites` 表做存在性过滤，过滤后仍保留
 * 空编组（不删除、不报错）。
 */
export class QuickSiteGroupStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 读取全部有效站点 id */
  private existingSiteIds(): Set<string> {
    const rows = this.db
      .prepare('SELECT id FROM quick_sites')
      .all() as unknown as SiteIdRow[]
    return new Set(rows.map((row) => row.id))
  }

  /** 行转编组：站点 id 按现存站点过滤并去重 */
  private rowToGroup(
    row: QuickSiteGroupRow,
    existing: Set<string>
  ): QuickSiteGroup {
    return {
      id: row.id,
      name: normalizeQuickSiteGroupName(row.name),
      siteIds: parseSiteIds(row.site_ids).filter((id) => existing.has(id)),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /** 按排序序号、创建时间升序读取全部编组 */
  getAll(): QuickSiteGroup[] {
    const existing = this.existingSiteIds()
    const rows = this.db
      .prepare(
        `SELECT * FROM quick_site_groups
        ORDER BY sort_order ASC, created_at ASC`
      )
      .all() as unknown as QuickSiteGroupRow[]
    return rows.map((row) => this.rowToGroup(row, existing))
  }

  /** 按 id 读取单个编组；不存在返回 null */
  getById(id: string): QuickSiteGroup | null {
    const row = this.db
      .prepare('SELECT * FROM quick_site_groups WHERE id = ?')
      .get(id) as unknown as QuickSiteGroupRow | undefined
    return row ? this.rowToGroup(row, this.existingSiteIds()) : null
  }

  /** 读取下一个排序序号（追加到末尾） */
  private nextSortOrder(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
        FROM quick_site_groups`
      )
      .get() as unknown as SortRow | undefined
    return row?.next ?? 0
  }

  /** 规整草稿并过滤不存在站点；校验失败返回错误提示 */
  private normalizeDraft(
    draft: QuickSiteGroupDraft | undefined,
    existing: Set<string>
  ): { name: string; siteIds: string[] } | { error: string } {
    const input: Partial<QuickSiteGroupDraft> = draft ?? {}
    const name = normalizeQuickSiteGroupName(input.name)
    if (name === '') {
      return { error: EMPTY_NAME_ERROR }
    }
    const siteIds = normalizeQuickSiteGroupSiteIds(input.siteIds).filter((id) =>
      existing.has(id)
    )
    if (siteIds.length === 0) {
      return { error: EMPTY_SITES_ERROR }
    }
    return { name, siteIds }
  }

  create(draft: QuickSiteGroupDraft): QuickSiteGroupSaveResult {
    const normalized = this.normalizeDraft(draft, this.existingSiteIds())
    if ('error' in normalized) {
      return { ok: false, error: normalized.error }
    }
    const now = Date.now()
    const group: QuickSiteGroup = {
      id: randomUUID(),
      name: normalized.name,
      siteIds: normalized.siteIds,
      sortOrder: this.nextSortOrder(),
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO quick_site_groups (
          id, name, site_ids, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        group.id,
        group.name,
        JSON.stringify(group.siteIds),
        group.sortOrder,
        group.createdAt,
        group.updatedAt
      )
    return { ok: true, group }
  }

  update(id: string, draft: QuickSiteGroupDraft): QuickSiteGroupSaveResult {
    const current = this.getById(id)
    if (current === null) {
      return { ok: false, error: NOT_FOUND_ERROR }
    }
    const normalized = this.normalizeDraft(draft, this.existingSiteIds())
    if ('error' in normalized) {
      return { ok: false, error: normalized.error }
    }
    const group: QuickSiteGroup = {
      ...current,
      name: normalized.name,
      siteIds: normalized.siteIds,
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        `UPDATE quick_site_groups SET
          name = ?, site_ids = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(group.name, JSON.stringify(group.siteIds), group.updatedAt, id)
    return { ok: true, group }
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM quick_site_groups WHERE id = ?').run(id)
  }
}
