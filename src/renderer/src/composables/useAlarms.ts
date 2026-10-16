import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { Alarm, AlarmDraft } from '@shared/types'

interface UseAlarms {
  alarms: Ref<Alarm[]>
  refresh: () => Promise<void>
  create: (draft: AlarmDraft) => Promise<Alarm>
  update: (id: string, draft: AlarmDraft) => Promise<Alarm | null>
  remove: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<Alarm | null>
}

/**
 * 提醒数据 composable：封装与主进程的 IPC 交互与响应式状态。
 * 挂载时拉取列表并订阅主进程推送的变更。
 */
export function useAlarms(): UseAlarms {
  const alarms = ref<Alarm[]>([])
  let unsubscribe: (() => void) | null = null

  const refresh = async (): Promise<void> => {
    alarms.value = await window.api.alarms.list()
  }

  const create = (draft: AlarmDraft): Promise<Alarm> =>
    window.api.alarms.create(draft)

  const update = (id: string, draft: AlarmDraft): Promise<Alarm | null> =>
    window.api.alarms.update(id, draft)

  const remove = (id: string): Promise<void> => window.api.alarms.remove(id)

  const toggle = (id: string, enabled: boolean): Promise<Alarm | null> =>
    window.api.alarms.toggle(id, enabled)

  onMounted(async () => {
    await refresh()
    unsubscribe = window.api.alarms.onChanged((list) => {
      alarms.value = list
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  return { alarms, refresh, create, update, remove, toggle }
}
