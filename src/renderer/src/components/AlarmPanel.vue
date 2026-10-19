<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlarmClock, Plus } from 'lucide-vue-next'
import type { Alarm, AlarmDraft } from '@shared/types'
import AlarmCard from '@/components/AlarmCard.vue'
import AlarmFormDialog from '@/components/AlarmFormDialog.vue'
import { Button } from '@/components/ui/button'
import { useAlarms } from '@/composables/useAlarms'

const { alarms, create, update, remove, toggle } = useAlarms()

const dialogOpen = ref(false)
const editing = ref<Alarm | null>(null)

const enabledCount = computed(
  () => alarms.value.filter((alarm) => alarm.enabled).length
)

const openCreate = (): void => {
  editing.value = null
  dialogOpen.value = true
}

const openEdit = (alarm: Alarm): void => {
  editing.value = alarm
  dialogOpen.value = true
}

const handleSubmit = async (draft: AlarmDraft): Promise<void> => {
  if (editing.value) {
    await update(editing.value.id, draft)
  } else {
    await create(draft)
  }
}

const handleToggle = (alarm: Alarm, enabled: boolean): void => {
  void toggle(alarm.id, enabled)
}

const handleRemove = (alarm: Alarm): void => {
  const confirmed = window.confirm(`确定删除提醒「${alarm.label}」吗？`)
  if (confirmed) {
    void remove(alarm.id)
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between px-6 py-4">
      <p class="text-muted-foreground text-sm">
        共 {{ alarms.length }} 条提醒 · {{ enabledCount }} 条已启用
      </p>
      <Button size="sm" @click="openCreate">
        <Plus data-icon="inline-start" />
        新建提醒
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto px-6">
      <div
        v-if="alarms.length === 0"
        class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3"
      >
        <AlarmClock class="size-10 opacity-40" />
        <p class="text-sm">还没有提醒，点击右上角新建一个吧</p>
      </div>

      <div v-else class="flex flex-col gap-2">
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

    <footer class="text-muted-foreground border-t px-6 py-2 text-xs">
      关闭窗口后应用会常驻系统托盘，并在到点时弹出系统通知。
    </footer>

    <AlarmFormDialog
      v-model:open="dialogOpen"
      :alarm="editing"
      @submit="handleSubmit"
    />
  </div>
</template>
