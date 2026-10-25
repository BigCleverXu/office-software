<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarDays, Plus } from 'lucide-vue-next'
import { describeCountdown } from '@shared/calendar'
import type { Countdown } from '@shared/calendar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollContent,
  DialogTitle
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { getDayAlmanac } from '@/lib/almanac'

interface FactItem {
  label: string
  value: string
}

interface CountdownRow {
  item: Countdown
  remainingLabel: string
}

type DetailTab = 'basic' | 'almanac' | 'positions' | 'countdowns'

const open = defineModel<boolean>('open', { default: false })

const activeTab = ref<DetailTab>('basic')

/** 每次打开弹窗都回到第一个分类 */
watch(open, (isOpen) => {
  if (isOpen) activeTab.value = 'basic'
})

const props = withDefaults(
  defineProps<{
    date?: string | null
    countdowns?: Countdown[]
  }>(),
  {
    countdowns: () => []
  }
)

const emit = defineEmits<{
  create: []
  'open-countdown': [countdown: Countdown]
}>()

const almanac = computed(() => (props.date ? getDayAlmanac(props.date) : null))

/** 基础信息栅格 */
const facts = computed<FactItem[]>(() => {
  const data = almanac.value
  if (!data) return []
  return [
    { label: '周数', value: `第 ${data.weekOfYear} 周` },
    { label: '年内天数', value: `第 ${data.dayOfYear} 天` },
    { label: '生肖', value: data.shengXiao },
    { label: '星座', value: data.xingZuo },
    { label: '月相', value: data.yueXiang },
    { label: '物候', value: data.hou }
  ]
})

/** 五神方位 */
const positions = computed<FactItem[]>(() => {
  const data = almanac.value
  if (!data) return []
  return [
    { label: '喜神', value: data.positions.xi },
    { label: '阳贵神', value: data.positions.yangGui },
    { label: '阴贵神', value: data.positions.yinGui },
    { label: '福神', value: data.positions.fu },
    { label: '财神', value: data.positions.cai }
  ]
})

const yiItems = computed(() => almanac.value?.yi ?? [])
const jiItems = computed(() => almanac.value?.ji ?? [])

/** 剩余天数文案：未来、今天、已过去、非法日期 */
function remainingLabel(date: string): string {
  const info = describeCountdown(date)
  if (!info) return '日期无效'
  if (info.status === 'today') return '就是今天'
  const prefix = info.status === 'future' ? '还有' : '已过去'
  return `${prefix} ${info.days} 天`
}

const countdownRows = computed<CountdownRow[]>(() =>
  props.countdowns.map((item) => ({
    item,
    remainingLabel: remainingLabel(item.date)
  }))
)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>日期详情</DialogTitle>
        <DialogDescription>查看该日期的农历与黄历信息。</DialogDescription>
      </DialogHeader>

      <div v-if="almanac" class="flex flex-col gap-4">
        <div class="flex items-start gap-3">
          <span class="text-4xl leading-none font-semibold tabular-nums">
            {{ almanac.day }}
          </span>
          <div class="flex min-w-0 flex-col gap-1">
            <p class="text-sm font-medium">
              {{ almanac.date }} {{ almanac.weekdayLabel }}
            </p>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-muted-foreground text-xs">
                {{ almanac.lunarFull }}
              </span>
              <Badge variant="secondary">{{ almanac.yearLabel }}</Badge>
            </div>
          </div>
        </div>

        <Separator />

        <div
          role="tablist"
          aria-label="日期详情分类"
          class="bg-muted flex w-fit flex-wrap items-center gap-1 rounded-lg p-1"
        >
          <Button
            id="day-detail-tab-basic"
            role="tab"
            size="sm"
            :variant="activeTab === 'basic' ? 'default' : 'ghost'"
            :aria-selected="activeTab === 'basic'"
            :tabindex="activeTab === 'basic' ? 0 : -1"
            aria-controls="day-detail-panel-basic"
            @click="activeTab = 'basic'"
          >
            基础
          </Button>
          <Button
            id="day-detail-tab-almanac"
            role="tab"
            size="sm"
            :variant="activeTab === 'almanac' ? 'default' : 'ghost'"
            :aria-selected="activeTab === 'almanac'"
            :tabindex="activeTab === 'almanac' ? 0 : -1"
            aria-controls="day-detail-panel-almanac"
            @click="activeTab = 'almanac'"
          >
            宜忌
          </Button>
          <Button
            id="day-detail-tab-positions"
            role="tab"
            size="sm"
            :variant="activeTab === 'positions' ? 'default' : 'ghost'"
            :aria-selected="activeTab === 'positions'"
            :tabindex="activeTab === 'positions' ? 0 : -1"
            aria-controls="day-detail-panel-positions"
            @click="activeTab = 'positions'"
          >
            神位
          </Button>
          <Button
            id="day-detail-tab-countdowns"
            role="tab"
            size="sm"
            :variant="activeTab === 'countdowns' ? 'default' : 'ghost'"
            :aria-selected="activeTab === 'countdowns'"
            :tabindex="activeTab === 'countdowns' ? 0 : -1"
            aria-controls="day-detail-panel-countdowns"
            @click="activeTab = 'countdowns'"
          >
            倒计日 {{ countdownRows.length }}
          </Button>
        </div>

        <div
          v-show="activeTab === 'basic'"
          id="day-detail-panel-basic"
          role="tabpanel"
          aria-labelledby="day-detail-tab-basic"
          class="flex flex-col gap-3 pt-1"
        >
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div
              v-for="fact in facts"
              :key="fact.label"
              class="rounded-md border p-2"
            >
              <p class="text-muted-foreground text-xs">
                {{ fact.label }}
              </p>
              <p class="text-sm">{{ fact.value }}</p>
            </div>
          </div>
        </div>

        <div
          v-show="activeTab === 'almanac'"
          id="day-detail-panel-almanac"
          role="tabpanel"
          aria-labelledby="day-detail-tab-almanac"
          class="flex flex-col gap-3 pt-1"
        >
          <div class="flex flex-col gap-1.5">
            <h3 class="text-sm font-medium">宜</h3>
            <div
              v-if="yiItems.length > 0"
              class="flex flex-wrap items-center gap-1.5"
            >
              <Badge v-for="item in yiItems" :key="item" variant="secondary">
                {{ item }}
              </Badge>
            </div>
            <p v-else class="text-muted-foreground text-xs">—</p>
          </div>

          <div class="flex flex-col gap-1.5">
            <h3 class="text-sm font-medium">忌</h3>
            <div
              v-if="jiItems.length > 0"
              class="flex flex-wrap items-center gap-1.5"
            >
              <Badge v-for="item in jiItems" :key="item" variant="secondary">
                {{ item }}
              </Badge>
            </div>
            <p v-else class="text-muted-foreground text-xs">—</p>
          </div>
        </div>

        <div
          v-show="activeTab === 'positions'"
          id="day-detail-panel-positions"
          role="tabpanel"
          aria-labelledby="day-detail-tab-positions"
          class="flex flex-col gap-3 pt-1"
        >
          <h3 class="text-sm font-medium">神位方位</h3>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div
              v-for="position in positions"
              :key="position.label"
              class="rounded-md border p-2"
            >
              <p class="text-muted-foreground text-xs">
                {{ position.label }}
              </p>
              <p class="text-sm">{{ position.value }}</p>
            </div>
          </div>
        </div>

        <div
          v-show="activeTab === 'countdowns'"
          id="day-detail-panel-countdowns"
          role="tabpanel"
          aria-labelledby="day-detail-tab-countdowns"
          class="flex flex-col gap-3 pt-1"
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-medium">该日倒计日</h3>
            <span class="text-muted-foreground text-xs">
              共 {{ countdownRows.length }} 个
            </span>
          </div>

          <div v-if="countdownRows.length > 0" class="flex flex-col gap-1">
            <button
              v-for="row in countdownRows"
              :key="row.item.id"
              type="button"
              class="hover:bg-muted flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors"
              @click="emit('open-countdown', row.item)"
            >
              <CalendarDays
                class="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate text-sm">
                {{ row.item.title }}
              </span>
              <span class="text-muted-foreground shrink-0 text-xs">
                {{ row.remainingLabel }}
              </span>
            </button>
          </div>
          <div
            v-else
            class="text-muted-foreground flex flex-col items-center gap-2 py-6"
          >
            <CalendarDays class="size-8 opacity-40" aria-hidden="true" />
            <p class="text-xs">这一天没有倒计日</p>
          </div>
        </div>
      </div>

      <p v-else class="text-muted-foreground py-6 text-center text-sm">
        无法获取该日期的信息
      </p>

      <DialogFooter>
        <Button variant="outline" @click="open = false">关闭</Button>
        <Button @click="emit('create')">
          <Plus data-icon="inline-start" />
          新增倒计日
        </Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
