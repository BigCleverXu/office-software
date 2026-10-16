import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { Alarm, AlarmDraft } from '../shared/types'
import { getIntervalMs } from '../shared/interval'

/** 补齐缺失字段，兼容旧版本数据 */
function normalizeAlarm(raw: Partial<Alarm>): Alarm {
  return {
    id: raw.id ?? randomUUID(),
    label: raw.label ?? '',
    time: raw.time ?? '',
    repeat: raw.repeat ?? 'none',
    weekdays: raw.weekdays ?? [],
    intervalValue: raw.intervalValue ?? 0,
    intervalUnit: raw.intervalUnit ?? 'minutes',
    nextFireAt: raw.nextFireAt ?? null,
    enabled: raw.enabled ?? true,
    createdAt: raw.createdAt ?? Date.now(),
    lastFiredAt: raw.lastFiredAt ?? null
  }
}

/**
 * 提醒的本地持久化存储。
 *
 * 数据以 JSON 数组形式保存在 `app.getPath('userData')/alarms.json`。
 * 为避免单元测试依赖 electron，`app.getPath` 只在需要真实路径时通过
 * 惰性 getter 调用；构造函数也可传入自定义 filePath。
 */
export class AlarmStore {
  private readonly explicitPath?: string
  private alarms: Alarm[] | null = null

  constructor(filePath?: string) {
    this.explicitPath = filePath
  }

  private get filePath(): string {
    if (this.explicitPath) {
      return this.explicitPath
    }
    return join(app.getPath('userData'), 'alarms.json')
  }

  /** 读取内存缓存，首次访问时从磁盘加载（损坏/不存在返回 []） */
  private load(): Alarm[] {
    if (this.alarms) {
      return this.alarms
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      this.alarms = Array.isArray(parsed)
        ? parsed.map((item) => normalizeAlarm(item as Partial<Alarm>))
        : []
    } catch {
      this.alarms = []
    }
    return this.alarms
  }

  /** 写回磁盘并更新内存缓存 */
  private persist(list: Alarm[]): void {
    this.alarms = list
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8')
    } catch (error) {
      console.error('保存提醒数据失败:', error)
    }
  }

  getAll(): Alarm[] {
    return [...this.load()]
  }

  create(draft: AlarmDraft): Alarm {
    const alarm: Alarm = {
      id: randomUUID(),
      label: draft.label,
      time: draft.time,
      repeat: draft.repeat,
      weekdays: [...draft.weekdays],
      intervalValue: draft.intervalValue,
      intervalUnit: draft.intervalUnit,
      nextFireAt:
        draft.repeat === 'interval'
          ? Date.now() + getIntervalMs(draft.intervalValue, draft.intervalUnit)
          : null,
      enabled: draft.enabled,
      createdAt: Date.now(),
      lastFiredAt: null
    }
    this.persist([...this.load(), alarm])
    return alarm
  }

  update(id: string, draft: AlarmDraft): Alarm | null {
    const list = this.load()
    const index = list.findIndex((alarm) => alarm.id === id)
    if (index === -1) {
      return null
    }
    const updated: Alarm = {
      ...list[index],
      label: draft.label,
      time: draft.time,
      repeat: draft.repeat,
      weekdays: [...draft.weekdays],
      intervalValue: draft.intervalValue,
      intervalUnit: draft.intervalUnit,
      nextFireAt:
        draft.repeat === 'interval'
          ? Date.now() + getIntervalMs(draft.intervalValue, draft.intervalUnit)
          : null,
      enabled: draft.enabled
    }
    const next = [...list]
    next[index] = updated
    this.persist(next)
    return updated
  }

  remove(id: string): void {
    const list = this.load()
    const next = list.filter((alarm) => alarm.id !== id)
    if (next.length !== list.length) {
      this.persist(next)
    }
  }

  setEnabled(id: string, enabled: boolean): Alarm | null {
    const list = this.load()
    const index = list.findIndex((alarm) => alarm.id === id)
    if (index === -1) {
      return null
    }
    const current = list[index]
    const updated: Alarm = { ...current, enabled }
    if (enabled && current.repeat === 'interval') {
      updated.nextFireAt =
        Date.now() + getIntervalMs(current.intervalValue, current.intervalUnit)
    }
    const next = [...list]
    next[index] = updated
    this.persist(next)
    return updated
  }

  markFired(id: string, at: number, nextFireAt?: number | null): Alarm | null {
    const list = this.load()
    const index = list.findIndex((alarm) => alarm.id === id)
    if (index === -1) {
      return null
    }
    const updated: Alarm = {
      ...list[index],
      lastFiredAt: at,
      nextFireAt: nextFireAt ?? list[index].nextFireAt
    }
    const next = [...list]
    next[index] = updated
    this.persist(next)
    return updated
  }
}
