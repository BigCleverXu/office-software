<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarDays, Plus } from 'lucide-vue-next'
import type { Countdown, CountdownDraft, MonthCell } from '@shared/calendar'
import CountdownCard from '@/components/CountdownCard.vue'
import CountdownDetailDialog from '@/components/CountdownDetailDialog.vue'
import CountdownFormDialog from '@/components/CountdownFormDialog.vue'
import MonthCalendar from '@/components/MonthCalendar.vue'
import { Button } from '@/components/ui/button'
import { useCalendar } from '@/composables/useCalendar'

/** Tab 视图标识 */
type CalendarTab = 'calendar' | 'countdowns'

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth() + 1)

/** 月历选中的日期，作为新建倒计日的默认日期 */
const selectedDate = ref<string | null>(null)

/** 当前 Tab，默认展示日历 */
const activeTab = ref<CalendarTab>('calendar')

const {
  countdowns,
  sortedCountdowns,
  holidays,
  holidaySource,
  holidayLoading,
  loadHolidays,
  create,
  update,
  remove
} = useCalendar()

// 切月或切年都重新按年份加载节假日（同一年命中缓存）
watch(
  [year, month],
  () => {
    void loadHolidays(year.value)
  },
  { immediate: true }
)

const showHolidayFallback = computed(
  () =>
    !holidayLoading.value &&
    (holidaySource.value === 'none' || holidays.value.length === 0)
)

/** 倒计日按目标日期分组，沿用列表已有的排序 */
const countdownsByDate = computed<Record<string, Countdown[]>>(() => {
  const map: Record<string, Countdown[]> = {}
  for (const item of sortedCountdowns.value) {
    const group = map[item.date]
    if (group) {
      group.push(item)
    } else {
      map[item.date] = [item]
    }
  }
  return map
})

const dialogOpen = ref(false)
const editing = ref<Countdown | null>(null)

/** 新建表单的默认日期：右键新建时使用被点击的日期，不改变选中态 */
const formDefaultDate = ref<string | undefined>(undefined)

const detailOpen = ref(false)
const detailTarget = ref<Countdown | null>(null)

/** 切换 Tab */
const selectTab = (tab: CalendarTab): void => {
  activeTab.value = tab
}

const handleSelect = (cell: MonthCell): void => {
  selectedDate.value = cell.date
}

const openCreate = (): void => {
  editing.value = null
  formDefaultDate.value = selectedDate.value ?? undefined
  dialogOpen.value = true
}

/** 右键单元格新建：使用该单元格日期，不改变日历选中态 */
const handleCreateAt = (cell: MonthCell): void => {
  editing.value = null
  formDefaultDate.value = cell.date
  dialogOpen.value = true
}

const openEdit = (countdown: Countdown): void => {
  editing.value = countdown
  dialogOpen.value = true
}

const handleSubmit = async (draft: CountdownDraft): Promise<void> => {
  if (editing.value) {
    await update(editing.value.id, draft)
  } else {
    await create(draft)
  }
}

const handleRemove = (countdown: Countdown): void => {
  const confirmed = window.confirm(`确定删除倒计日「${countdown.title}」吗？`)
  if (confirmed) {
    void remove(countdown.id)
  }
}

/** 打开倒计日详情弹窗 */
const openDetail = (countdown: Countdown): void => {
  detailTarget.value = countdown
  detailOpen.value = true
}

/** 详情中编辑：关闭详情并复用表单的编辑模式 */
const handleDetailEdit = (): void => {
  const target = detailTarget.value
  detailOpen.value = false
  if (!target) return
  editing.value = target
  formDefaultDate.value = target.date
  dialogOpen.value = true
}

/** 详情中删除：确认后删除并关闭详情，取消则保留详情弹窗 */
const handleDetailRemove = (): void => {
  const target = detailTarget.value
  if (!target) return
  const confirmed = window.confirm(`确定删除倒计日「${target.title}」吗？`)
  if (!confirmed) return
  void remove(target.id)
  detailOpen.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-center justify-between gap-3 px-6 py-4">
      <div
        role="tablist"
        aria-label="日历视图切换"
        class="bg-muted flex items-center gap-1 rounded-lg p-1"
      >
        <Button
          id="calendar-tab-calendar"
          role="tab"
          size="sm"
          :variant="activeTab === 'calendar' ? 'default' : 'ghost'"
          :aria-selected="activeTab === 'calendar'"
          :tabindex="activeTab === 'calendar' ? 0 : -1"
          aria-controls="calendar-panel-calendar"
          :class="activeTab === 'calendar' ? '' : 'text-muted-foreground'"
          @click="selectTab('calendar')"
        >
          日历
        </Button>
        <Button
          id="calendar-tab-countdowns"
          role="tab"
          size="sm"
          :variant="activeTab === 'countdowns' ? 'default' : 'ghost'"
          :aria-selected="activeTab === 'countdowns'"
          :tabindex="activeTab === 'countdowns' ? 0 : -1"
          aria-controls="calendar-panel-countdowns"
          :class="activeTab === 'countdowns' ? '' : 'text-muted-foreground'"
          @click="selectTab('countdowns')"
        >
          倒计日
        </Button>
      </div>

      <Button size="sm" @click="openCreate">
        <Plus data-icon="inline-start" />
        新建倒计日
      </Button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
      <section
        v-show="activeTab === 'calendar'"
        id="calendar-panel-calendar"
        role="tabpanel"
        aria-labelledby="calendar-tab-calendar"
        class="min-h-0"
      >
        <div class="w-full rounded-xl border p-3">
          <MonthCalendar
            v-model:year="year"
            v-model:month="month"
            :holidays="holidays"
            :selected-date="selectedDate"
            :countdowns-by-date="countdownsByDate"
            @select="handleSelect"
            @create="handleCreateAt"
            @open-countdown="openDetail"
          />
        </div>

        <p
          v-if="showHolidayFallback"
          class="text-muted-foreground mt-3 text-xs"
        >
          {{ year }} 年节假日数据暂不可用，仅显示周末
        </p>
      </section>

      <section
        v-show="activeTab === 'countdowns'"
        id="calendar-panel-countdowns"
        role="tabpanel"
        aria-labelledby="calendar-tab-countdowns"
        class="flex min-h-0 flex-col"
      >
        <div class="mb-2 flex shrink-0 items-center justify-between gap-2">
          <h2 class="text-sm font-medium">倒计日</h2>
          <span class="text-muted-foreground text-xs">
            共 {{ countdowns.length }} 个
          </span>
        </div>

        <div
          v-if="countdowns.length === 0"
          class="text-muted-foreground flex flex-col items-center gap-3 py-10"
        >
          <CalendarDays class="size-10 opacity-40" aria-hidden="true" />
          <p class="text-sm">还没有倒计日，点击新建添加一个吧</p>
        </div>

        <div v-else class="flex flex-col gap-2">
          <CountdownCard
            v-for="countdown in sortedCountdowns"
            :key="countdown.id"
            :countdown="countdown"
            @edit="openEdit(countdown)"
            @remove="handleRemove(countdown)"
          />
        </div>
      </section>
    </div>

    <CountdownFormDialog
      v-model:open="dialogOpen"
      :countdown="editing"
      :default-date="formDefaultDate"
      @submit="handleSubmit"
    />

    <CountdownDetailDialog
      v-model:open="detailOpen"
      :countdown="detailTarget"
      @edit="handleDetailEdit"
      @remove="handleDetailRemove"
    />
  </div>
</template>
