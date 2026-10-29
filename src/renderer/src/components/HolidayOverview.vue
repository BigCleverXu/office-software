<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarRange } from 'lucide-vue-next'
import { daysUntil, parseDateOnly } from '@shared/calendar'
import { getYearFestivals } from '@/lib/festivals'
import type { FestivalEntry } from '@/lib/festivals'
import { useToday } from '@/composables/useToday'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const props = defineProps<{ year: number }>()

/** 节假日视图独立年份，避免切换时影响月历 */
const selectedYear = ref(props.year)

// 月历年份变化时同步过来
watch(
  () => props.year,
  (next) => {
    selectedYear.value = next
  }
)

/** 按月份聚合的节日分组 */
interface MonthGroup {
  month: number
  abbr: string
  items: FestivalEntry[]
}

/** 月份英文缩写，索引与月份一一对应 */
const MONTH_ABBRS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

/** 年份选项以当前年份为基准，前后各扩展 10 年 */
const BASE_YEAR = new Date().getFullYear()
const YEAR_RANGE = 10

/** 本地时区的今天，跨零点自动更新 */
const today = useToday()

/** 年份下拉选项，允许外部传入的年份超出默认范围 */
const yearOptions = computed<number[]>(() => {
  const years: number[] = []
  for (let offset = -YEAR_RANGE; offset <= YEAR_RANGE; offset += 1) {
    years.push(BASE_YEAR + offset)
  }
  if (!years.includes(selectedYear.value)) {
    years.push(selectedYear.value)
  }
  return years.sort((left, right) => left - right)
})

/** 该年份的节日按公历月份升序分组 */
const groups = computed<MonthGroup[]>(() => {
  const buckets = new Map<number, FestivalEntry[]>()
  for (const entry of getYearFestivals(selectedYear.value)) {
    const bucket = buckets.get(entry.month)
    if (bucket) {
      bucket.push(entry)
    } else {
      buckets.set(entry.month, [entry])
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([month, items]) => ({
      month,
      abbr: MONTH_ABBRS[month - 1],
      items
    }))
})

/** 切换年份，仅接受合法整数 */
function handleYearChange(value: unknown): void {
  const parsed = Number(value)
  if (Number.isInteger(parsed)) {
    selectedYear.value = parsed
  }
}

/** 是否为今天 */
function isToday(date: string): boolean {
  return date === today.value
}

/** 名称后的中括号信息，如「[冬月十三 01-01]」 */
function metaLabel(entry: FestivalEntry): string {
  return `[${entry.lunarLabel} ${entry.date.slice(5)}]`
}

/** 距离今天的状态文案 */
function statusLabel(date: string): string {
  const diff = daysUntil(date, parseDateOnly(today.value) ?? new Date())
  if (diff === null) {
    return ''
  }
  if (diff > 0) {
    return `还剩 ${diff} 天`
  }
  if (diff === 0) {
    return '今天'
  }
  return `已过 ${-diff} 天`
}

/** 今天条目使用前景色强调，其余保持弱化 */
function statusClass(date: string): string {
  return isToday(date) ? 'text-foreground font-medium' : 'text-muted-foreground'
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-3">
      <Select
        :model-value="String(selectedYear)"
        @update:model-value="handleYearChange"
      >
        <SelectTrigger class="w-32" aria-label="选择年份">
          <SelectValue placeholder="选择年份" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in yearOptions"
            :key="option"
            :value="String(option)"
          >
            {{ option }} 年
          </SelectItem>
        </SelectContent>
      </Select>
      <span class="text-muted-foreground text-xs">
        选择年份后自动更新节日状态
      </span>
    </div>

    <div
      class="bg-card shadow-soft rounded-2xl border border-border/70 px-4 py-5 sm:px-6"
    >
      <ol
        v-if="groups.length > 0"
        class="relative flex flex-col gap-6 before:absolute before:top-2 before:bottom-2 before:left-2 before:w-px before:bg-border"
      >
        <li v-for="group in groups" :key="group.month" class="relative pl-6">
          <span
            class="absolute top-3 left-[3px] size-2.5 rounded-full border border-border bg-background"
            aria-hidden="true"
          />
          <div class="flex items-baseline gap-2">
            <span class="text-4xl leading-none font-semibold tracking-tight">
              {{ group.month }}
            </span>
            <span class="text-muted-foreground text-xs">月</span>
            <span
              class="text-muted-foreground/40 ml-2 text-2xl font-semibold select-none"
            >
              {{ group.abbr }}
            </span>
          </div>

          <ul
            class="stagger-list mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2"
          >
            <li
              v-for="item in group.items"
              :key="`${item.date}-${item.name}`"
              class="flex flex-wrap items-baseline gap-x-2 text-sm"
            >
              <span class="text-foreground">
                {{ item.name }}
              </span>
              <span class="text-muted-foreground text-xs">
                {{ metaLabel(item) }}
              </span>
              <span class="text-xs" :class="statusClass(item.date)">
                {{ statusLabel(item.date) }}
              </span>
            </li>
          </ul>
        </li>
      </ol>

      <div v-else class="empty-state text-muted-foreground py-16">
        <span class="empty-state-icon">
          <CalendarRange class="size-6" aria-hidden="true" />
        </span>
        <p>该年份暂无节日数据</p>
      </div>
    </div>
  </section>
</template>
