import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { Note, NoteDraft } from '@shared/notes'

interface UseNotes {
  notes: Ref<Note[]>
  refresh: () => Promise<void>
  create: (draft: NoteDraft) => Promise<Note>
  update: (id: string, draft: NoteDraft) => Promise<Note | null>
  remove: (id: string) => Promise<void>
}

/**
 * 便签数据 composable：封装与主进程的 IPC 交互与响应式状态。
 * 挂载时拉取列表并订阅主进程推送的变更。
 */
export function useNotes(): UseNotes {
  const notes = ref<Note[]>([])
  let unsubscribe: (() => void) | null = null

  const refresh = async (): Promise<void> => {
    notes.value = await window.api.notes.list()
  }

  const create = (draft: NoteDraft): Promise<Note> =>
    window.api.notes.create(draft)

  const update = (id: string, draft: NoteDraft): Promise<Note | null> =>
    window.api.notes.update(id, draft)

  const remove = (id: string): Promise<void> => window.api.notes.remove(id)

  onMounted(async () => {
    await refresh()
    unsubscribe = window.api.notes.onChanged((list) => {
      notes.value = list
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  return { notes, refresh, create, update, remove }
}
