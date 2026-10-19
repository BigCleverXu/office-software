<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { AlarmClock, Bell, LineChart, Plus } from 'lucide-vue-next'
import type { Alarm, AlarmDraft } from '@shared/types'
import type { MarketPage } from '@shared/market'
import AlarmCard from '@/components/AlarmCard.vue'
import AlarmFormDialog from '@/components/AlarmFormDialog.vue'
import MarketPanel from '@/components/MarketPanel.vue'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAlarms } from '@/composables/useAlarms'

const { alarms, create, update, remove, toggle } = useAlarms()

const dialogOpen = ref(false)
const editing = ref<Alarm | null>(null)
const page = ref<MarketPage>('alarms')

let unsubscribeNavigate: (() => void) | null = null

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

const switchTo = (target: MarketPage): void => {
  page.value = target
  void window.api.market.setLastPage(target)
}

onMounted(async () => {
  const state = await window.api.market.getState()
  page.value = state.settings.lastPage
  unsubscribeNavigate = window.api.market.onNavigate((target) => {
    page.value = target
  })
})

onUnmounted(() => {
  unsubscribeNavigate?.()
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex h-full flex-col">
      <header class="flex items-center justify-between px-6 py-4">
        <div class="flex items-center gap-3">
          <div
            class="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg"
          >
            <Bell class="size-5" />
          </div>
          <div class="flex flex-col">
            <h1 class="text-base font-semibold">定时提醒</h1>
            <p class="text-muted-foreground text-xs">
              共 {{ alarms.length }} 条提醒 · {{ enabledCount }} 条已启用
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1">
            <Button
              :variant="page === 'alarms' ? 'default' : 'ghost'"
              size="sm"
              @click="switchTo('alarms')"
            >
              <Bell />
              提醒
            </Button>
            <Button
              :variant="page === 'market' ? 'default' : 'ghost'"
              size="sm"
              @click="switchTo('market')"
            >
              <LineChart />
              行情
            </Button>
          </div>

          <Button v-show="page === 'alarms'" @click="openCreate">
            <Plus data-icon="inline-start" />
            新建提醒
          </Button>
        </div>
      </header>

      <Separator />

      <div class="flex-1 overflow-hidden">
        <div v-show="page === 'alarms'" class="flex h-full flex-col">
          <main class="flex-1 overflow-y-auto px-6 py-4">
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
          </main>

          <footer class="text-muted-foreground border-t px-6 py-2 text-xs">
            关闭窗口后应用会常驻系统托盘，并在到点时弹出系统通知。
          </footer>
        </div>

        <MarketPanel v-show="page === 'market'" />
      </div>

      <AlarmFormDialog
        v-model:open="dialogOpen"
        :alarm="editing"
        @submit="handleSubmit"
      />
    </div>
  </TooltipProvider>
</template>
