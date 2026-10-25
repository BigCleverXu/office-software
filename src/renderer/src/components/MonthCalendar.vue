<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { buildMonthGrid } from '@shared/calendar'
import type {
  Countdown,
  HolidayEntry,
  HolidayType,
  MonthCell
} from '@shared/calendar'
import { Button } from '@/components/ui/button'
import { getLunarLabel } from '@/lib/almanac'

/** 单元格内直接展示的倒计日条数上限 */
const MAX_VISIBLE_COUNTDOWNS = 2

const props = withDefaults(
  defineProps<{
    holidays: HolidayEntry[]
    year: number
    month: number
    selectedDate?: string | null
    /** 按日期分组的倒计日，用于在月历格子内展示 */
    countdownsByDate?: Record<string, Countdown[]>
  }>(),
  {
    countdownsByDate: () => ({})
  }
)

const emit = defineEmits<{
  'update:year': [year: number]
  'update:month': [month: number]
  select: [cell: MonthCell]
  'context-menu': [payload: { cell: MonthCell; x: number; y: number }]
  'open-countdown': [countdown: Countdown]
}>()

/** 周一为每周第一天的表头 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** 节假日标签样式（显式映射静态类名，避免动态拼接） */
const TAG_STYLES: Record<HolidayType, string> = {
  holiday: 'bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-300',
  workday: 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300'
}

/** 节假日标签文案：休=法定休假，班=调休补班 */
const TAG_LABELS: Record<HolidayType, string> = {
  holiday: '休',
  workday: '班'
}

/** 按本地时区格式化为 YYYY-MM-DD */
function formatDateOnly(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const todayKey = formatDateOnly(new Date())

const grid = computed(() => buildMonthGrid(props.year, props.month))

/** 节假日按日期建立索引，便于单元格查询 */
const holidayMap = computed<Record<string, HolidayEntry>>(() => {
  const map: Record<string, HolidayEntry> = {}
  for (const entry of props.holidays) {
    map[entry.date] = entry
  }
  return map
})

const monthLabel = computed(() => `${props.year} 年 ${props.month} 月`)

/** 当前网格的农历文案，按日期建索引，避免模板内重复计算 */
const lunarLabels = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const cell of grid.value) {
    if (!cell.inMonth) continue
    const label = getLunarLabel(cell.date)
    if (label) {
      map[cell.date] = label
    }
  }
  return map
})

/** 查询某日的农历文案，无文案返回空字符串 */
function lunarLabelOf(date: string): string {
  return lunarLabels.value[date] ?? ''
}

/** 查询某日的节假日记录，无记录返回 null */
function holidayOf(date: string): HolidayEntry | null {
  return holidayMap.value[date] ?? null
}

/** 是否法定休假日期（数字与节日名称需要标红） */
function isHolidayDate(date: string): boolean {
  return holidayOf(date)?.type === 'holiday'
}

/** 是否选中日期 */
function isSelected(date: string): boolean {
  return props.selectedDate === date
}

/** 右上角「休 / 班」标签基础样式 */
const TAG_BASE_CLASS = [
  'absolute top-1 right-1 rounded px-1',
  'text-[10px] leading-4 font-medium'
]

/** 右上角标签的样式：定位 + 类型配色 */
function tagClass(date: string): string[] {
  const entry = holidayOf(date)
  return entry ? [...TAG_BASE_CLASS, TAG_STYLES[entry.type]] : TAG_BASE_CLASS
}

/** 右上角标签文案 */
function tagLabel(date: string): string {
  const entry = holidayOf(date)
  return entry ? TAG_LABELS[entry.type] : ''
}

/** 节日 / 补班名称 */
function holidayName(date: string): string {
  return holidayOf(date)?.name ?? ''
}

/**
 * 日期数字是否标红：法定假期优先标红，调休补班不标红，
 * 其余周末（列索引 5、6）标红
 */
function shouldMarkRed(cell: MonthCell, index: number): boolean {
  const type = holidayOf(cell.date)?.type
  if (type === 'holiday') return true
  if (type === 'workday') return false
  return isWeekend(index)
}

/** 日期数字样式：选中用前景色，法定假期与周末标红 */
function dayClass(cell: MonthCell, index: number): string[] {
  if (!cell.inMonth) return []
  if (isSelected(cell.date)) return ['text-primary-foreground']
  return shouldMarkRed(cell, index) ? ['text-red-600 dark:text-red-400'] : []
}

/** 节日名称样式：选中用前景色，法定休假标红 */
function holidayNameClass(cell: MonthCell): string[] {
  if (isSelected(cell.date)) return ['text-primary-foreground']
  return isHolidayDate(cell.date)
    ? ['text-red-600 dark:text-red-400']
    : ['text-muted-foreground']
}

/** 某日全部倒计日 */
function countdownsOf(date: string): Countdown[] {
  return props.countdownsByDate[date] ?? []
}

/** 某日直接展示的倒计日（最多两条） */
function visibleCountdownsOf(date: string): Countdown[] {
  return countdownsOf(date).slice(0, MAX_VISIBLE_COUNTDOWNS)
}

/** 超出展示上限的倒计日数量 */
function hiddenCountdownCount(date: string): number {
  return Math.max(countdownsOf(date).length - MAX_VISIBLE_COUNTDOWNS, 0)
}

/** 倒计日条目基础样式：单项一行，左侧小圆点 + 浅色底 */
const COUNTDOWN_ITEM_CLASS = [
  'flex w-full min-w-0 cursor-pointer items-center gap-1 rounded px-1',
  'text-[10px] leading-4'
]

/** 倒计日条目样式：选中态用前景色浅底，普通态用主色浅底 */
function countdownClass(cell: MonthCell): string[] {
  return isSelected(cell.date)
    ? [
        ...COUNTDOWN_ITEM_CLASS,
        'bg-primary-foreground/20 text-primary-foreground'
      ]
    : [...COUNTDOWN_ITEM_CLASS, 'bg-primary/10 text-primary']
}

/** 跨月切换：1 月上一月回到上一年 12 月 */
function shiftMonth(offset: number): void {
  const target = new Date(props.year, props.month - 1 + offset, 1)
  emit('update:year', target.getFullYear())
  emit('update:month', target.getMonth() + 1)
}

/** 回到今天所在月份并选中今天 */
function goToday(): void {
  const now = new Date()
  emit('update:year', now.getFullYear())
  emit('update:month', now.getMonth() + 1)
  emit('select', {
    date: formatDateOnly(now),
    day: now.getDate(),
    inMonth: true
  })
}

/** 周一为第一列，最后两列为周六、周日 */
function isWeekend(index: number): boolean {
  return index % 7 >= 5
}

/** 右键当月单元格发出菜单事件；补位单元格仅拦截默认菜单 */
function handleContextMenu(cell: MonthCell, event: MouseEvent): void {
  if (!cell.inMonth) return
  emit('context-menu', { cell, x: event.clientX, y: event.clientY })
}

/** 单元格样式：补位、周末、今天、选中分别为独立静态类名 */
function cellClass(cell: MonthCell, index: number): string[] {
  const selected = props.selectedDate === cell.date
  return [
    'relative flex min-h-[88px] flex-col items-start gap-0.5',
    'overflow-hidden rounded-lg border border-transparent p-1.5 text-left transition-all duration-200',
    cell.inMonth ? '' : 'text-muted-foreground/40 cursor-default',
    cell.inMonth && !selected
      ? 'hover:border-foreground/10 hover:bg-muted'
      : '',
    cell.inMonth && isWeekend(index) && !selected ? 'bg-muted/40' : '',
    cell.inMonth && cell.date === todayKey && !selected
      ? 'ring-1 ring-primary/60'
      : '',
    selected ? 'bg-primary text-primary-foreground shadow-soft' : ''
  ]
}
</script>

<template>
  <div class="flex flex-col">
    <div class="mb-3 flex items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="上个月"
          @click="shiftMonth(-1)"
        >
          <ChevronLeft />
        </Button>
        <span class="min-w-[8.5rem] text-center text-sm font-medium">
          {{ monthLabel }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="下个月"
          @click="shiftMonth(1)"
        >
          <ChevronRight />
        </Button>
      </div>
      <Button variant="outline" size="sm" @click="goToday">今天</Button>
    </div>

    <div class="mb-1 grid grid-cols-7 gap-1">
      <div
        v-for="(label, index) in WEEKDAY_LABELS"
        :key="label"
        class="py-1 text-center text-xs font-medium"
        :class="
          index >= 5 ? 'text-muted-foreground/60' : 'text-muted-foreground'
        "
      >
        {{ label }}
      </div>
    </div>

    <div class="grid grid-cols-7 gap-1" @contextmenu.prevent>
      <button
        v-for="(cell, index) in grid"
        :key="cell.date"
        type="button"
        :disabled="!cell.inMonth"
        :aria-label="cell.date"
        :aria-pressed="selectedDate === cell.date"
        :class="cellClass(cell, index)"
        @click="emit('select', cell)"
        @contextmenu.prevent="handleContextMenu(cell, $event)"
      >
        <span
          class="text-xs font-medium tabular-nums"
          :class="dayClass(cell, index)"
        >
          {{ cell.day }}
        </span>

        <span
          v-if="cell.inMonth && lunarLabelOf(cell.date)"
          class="w-full min-w-0 truncate text-[10px] leading-4"
          :class="
            isSelected(cell.date)
              ? 'text-primary-foreground/80'
              : 'text-muted-foreground'
          "
        >
          {{ lunarLabelOf(cell.date) }}
        </span>

        <span
          v-if="cell.inMonth && holidayOf(cell.date)"
          :class="tagClass(cell.date)"
        >
          {{ tagLabel(cell.date) }}
        </span>

        <span
          v-if="cell.inMonth && holidayOf(cell.date)"
          class="w-full min-w-0 truncate text-[10px] leading-4"
          :class="holidayNameClass(cell)"
        >
          {{ holidayName(cell.date) }}
        </span>

        <span
          v-if="cell.inMonth && countdownsOf(cell.date).length > 0"
          class="flex w-full min-w-0 flex-col gap-0.5"
        >
          <span
            v-for="item in visibleCountdownsOf(cell.date)"
            :key="item.id"
            :class="countdownClass(cell)"
            @click.stop="emit('open-countdown', item)"
          >
            <span
              class="size-1 shrink-0 rounded-full bg-current opacity-60"
            ></span>
            <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
          </span>
          <span
            v-if="hiddenCountdownCount(cell.date) > 0"
            class="text-[10px] leading-4 font-medium"
            :class="
              isSelected(cell.date)
                ? 'text-primary-foreground/80'
                : 'text-muted-foreground'
            "
          >
            +{{ hiddenCountdownCount(cell.date) }}
          </span>
        </span>
      </button>
    </div>

    <div class="text-muted-foreground mt-3 flex items-center gap-3 text-xs">
      <span class="flex items-center gap-1.5">
        <span
          class="rounded px-1 text-[10px] leading-4 font-medium"
          :class="TAG_STYLES.holiday"
        >
          休
        </span>
        = 法定节假日
      </span>
      <span class="flex items-center gap-1.5">
        <span
          class="rounded px-1 text-[10px] leading-4 font-medium"
          :class="TAG_STYLES.workday"
        >
          班
        </span>
        = 调休补班
      </span>
    </div>
  </div>
</template>
