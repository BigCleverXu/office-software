import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  SYSTEM_BROWSER_ID,
  isBrowserId,
  normalizeQuickSiteName,
  normalizeQuickSiteProfileId,
  normalizeQuickSiteUrl,
  type QuickSite,
  type QuickSiteDraft,
  type QuickSiteSaveResult
} from '../shared/quick-sites'
import type { QuickSiteRow } from './database'

/** 非法网址的提示 */
const INVALID_URL_ERROR = '请输入 http / https 开头的网址'

/** 站点不存在的提示 */
const NOT_FOUND_ERROR = '站点不存在'

/** 读取当前最大排序序号后的下一个值 */
interface SortRow {
  next: number
}

/** 行转站点：非法网址返回 null（调用方跳过该行） */
function rowToQuickSite(row: QuickSiteRow): QuickSite | null {
  const url = normalizeQuickSiteUrl(row.url)
  if (url === '') {
    return null
  }
  const browserId = isBrowserId(row.browser_id)
    ? row.browser_id
    : SYSTEM_BROWSER_ID
  return {
    id: row.id,
    name: normalizeQuickSiteName(row.name, url),
    url,
    browserId,
    profileId: normalizeQuickSiteProfileId(row.profile_id, browserId),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 快捷站点的本地持久化存储。
 *
 * 数据保存在注入的 SQLite 数据库（`quick_sites` 表）中，由 database.ts
 * 负责建表；本类只做单表读写，并在读写边界统一规整脏数据。
 */
export class QuickSiteStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 按 id 读取单个站点；不存在或数据非法返回 null */
  getById(id: string): QuickSite | null {
    const row = this.db
      .prepare('SELECT * FROM quick_sites WHERE id = ?')
      .get(id) as unknown as QuickSiteRow | undefined
    return row ? rowToQuickSite(row) : null
  }

  /** 按排序序号升序读取全部站点，脏数据行被过滤 */
  getAll(): QuickSite[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM quick_sites
        ORDER BY sort_order ASC, created_at ASC`
      )
      .all() as unknown as QuickSiteRow[]
    return rows
      .map((row) => rowToQuickSite(row))
      .filter((site): site is QuickSite => site !== null)
  }

  /** 读取下一个排序序号（追加到末尾） */
  private nextSortOrder(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
        FROM quick_sites`
      )
      .get() as unknown as SortRow | undefined
    return row?.next ?? 0
  }

  create(draft: QuickSiteDraft): QuickSiteSaveResult {
    const input: Partial<QuickSiteDraft> = draft ?? {}
    const url = normalizeQuickSiteUrl(input.url)
    if (url === '') {
      return { ok: false, error: INVALID_URL_ERROR }
    }
    const browserId = isBrowserId(input.browserId)
      ? input.browserId
      : SYSTEM_BROWSER_ID
    const now = Date.now()
    const site: QuickSite = {
      id: randomUUID(),
      name: normalizeQuickSiteName(input.name, url),
      url,
      browserId,
      profileId: normalizeQuickSiteProfileId(input.profileId, browserId),
      sortOrder: this.nextSortOrder(),
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO quick_sites (
          id, name, url, browser_id, profile_id, sort_order,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        site.id,
        site.name,
        site.url,
        site.browserId,
        site.profileId,
        site.sortOrder,
        site.createdAt,
        site.updatedAt
      )
    return { ok: true, site }
  }

  update(id: string, draft: QuickSiteDraft): QuickSiteSaveResult {
    const current = this.getById(id)
    if (current === null) {
      return { ok: false, error: NOT_FOUND_ERROR }
    }
    const input: Partial<QuickSiteDraft> = draft ?? {}
    const url = normalizeQuickSiteUrl(input.url)
    if (url === '') {
      return { ok: false, error: INVALID_URL_ERROR }
    }
    const browserId = isBrowserId(input.browserId)
      ? input.browserId
      : SYSTEM_BROWSER_ID
    const site: QuickSite = {
      ...current,
      name: normalizeQuickSiteName(input.name, url),
      url,
      browserId,
      profileId: normalizeQuickSiteProfileId(input.profileId, browserId),
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        `UPDATE quick_sites SET
          name = ?, url = ?, browser_id = ?, profile_id = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        site.name,
        site.url,
        site.browserId,
        site.profileId,
        site.updatedAt,
        id
      )
    return { ok: true, site }
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM quick_sites WHERE id = ?').run(id)
  }
}
