<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlarmClock, Plus } from 'lucide-vue-next'
import type { Alarm, AlarmDraft } from '@shared/types'
import AlarmCard from '@/components/AlarmCard.vue'
import AlarmFormDialog from '@/components/AlarmFormDialog.vue'
import { Button } from '@/components/ui/button'
import { confirm } from '@/composables/useConfirm'
import { useAlarms } from '@/composables/useAlarms'

const { alarms, create, update, remove, toggle } = useAlarms()

const dialogOpen = ref(false)
const editing = ref<Alarm | null>(null)
/** 提交中状态与提交失败提示，由弹窗内展示 */
const saving = ref(false)
const formError = ref('')

const enabledCount = computed(
  () => alarms.value.filter((alarm) => alarm.enabled).length
)

const openCreate = (): void => {
  editing.value = null
  formError.value = ''
  dialogOpen.value = true
}

const openEdit = (alarm: Alarm): void => {
  editing.value = alarm
  formError.value = ''
  dialogOpen.value = true
}

const handleSubmit = async (draft: AlarmDraft): Promise<void> => {
  saving.value = true
  formError.value = ''
  try {
    const result = editing.value
      ? await update(editing.value.id, draft)
      : await create(draft)
    if (result === null) {
      formError.value = '保存失败，请稍后重试'
      return
    }
    dialogOpen.value = false
    editing.value = null
  } catch {
    formError.value = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

const handleToggle = (alarm: Alarm, enabled: boolean): void => {
  void toggle(alarm.id, enabled)
}

const handleRemove = async (alarm: Alarm): Promise<void> => {
  const confirmed = await confirm({
    title: '删除提醒',
    description: `确定删除提醒「${alarm.label}」吗？`
  })
  if (confirmed) {
    void remove(alarm.id)
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-center justify-between px-6 py-4">
      <p class="text-muted-foreground text-sm">
        共
        <span class="text-foreground font-medium">{{ alarms.length }}</span>
        条提醒 ·
        <span class="text-foreground font-medium">{{ enabledCount }}</span>
        条已启用
      </p>
      <Button size="sm" @click="openCreate">
        <Plus data-icon="inline-start" />
        新建提醒
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto scroll-py-2 px-6 py-2">
      <div
        v-if="alarms.length === 0"
        class="empty-state text-muted-foreground h-full"
      >
        <span class="empty-state-icon"><AlarmClock class="size-6" /></span>
        <p class="text-sm">还没有提醒，点击右上角新建一个吧</p>
      </div>

      <div v-else class="stagger-list flex flex-col gap-2">
        <AlarmCard
          v-for="alarm in alarms"
          :key="alarm.id"
          :alarm="alarm"
          @toggle="(enabled) => handleToggle(alarm, enabled)"
          @edit="openEdit(alarm)"
          @remove="handleRemove(alarm)"
        />
      </div>
    </div>

    <footer
      class="bg-muted/30 text-muted-foreground border-t px-6 py-2 text-xs"
    >
      关闭窗口后应用会常驻系统托盘，并在到点时弹出系统通知。
    </footer>

    <AlarmFormDialog
      v-model:open="dialogOpen"
      :alarm="editing"
      :saving="saving"
      :error="formError"
      @submit="handleSubmit"
    />
  </div>
</template>
