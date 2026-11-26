<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { usePreferredReducedMotion } from '@vueuse/core'
import { CalendarPlus, Droplets, Loader2, Undo2 } from 'lucide-vue-next'
import {
  formatDrinkTime,
  formatWaterAmount,
  isValidCupMl,
  MAX_CUP_ML,
  MIN_CUP_ML,
  POUR_DURATION_MS,
  WATER_CUP_PRESETS
} from '@shared/water'
import WaterGlass from '@/components/WaterGlass.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useWater } from '@/composables/useWater'

const { state, error, todayKey, addCup, setCupMl, removeLast, syncCalendar } =
  useWater()

const reducedMotion = usePreferredReducedMotion()
const reduced = computed(() => reducedMotion.value === 'reduce')

/** 水杯当前水位（0–1）与注水状态 */
const level = ref(0)
const pouring = ref(false)

/** 水杯下方浮层提示（成功 2 秒后消失，失败常驻） */
const glassMessage = ref('')
const glassMessageFailed = ref(false)

/** 顶部同步结果提示 */
const syncMessage = ref('')
const syncFailed = ref(false)
const syncing = ref(false)

/** 单杯容量输入与行内校验提示 */
const cupInput = ref(String(state.value.settings.cupMl))
const cupError = ref('')
const savingCup = ref(false)

const cupMl = computed(() => state.value.settings.cupMl)
const records = computed(() => state.value.records)
const todayCount = computed(() => state.value.todayCount)
const todayTotalMl = computed(() => state.value.todayTotalMl)

const INVALID_CUP_MESSAGE = `容量需为 ${MIN_CUP_ML} 到 ${MAX_CUP_ML} 之间的整数`
const SYNC_FAIL_MESSAGE = '同步到应用日历失败，请稍后重试'
const CUP_SAVE_FAIL_MESSAGE = '保存容量失败，请稍后重试'

let messageTimer: number | null = null
let pourTimer: number | null = null

const clearMessageTimer = (): void => {
  if (messageTimer !== null) {
    window.clearTimeout(messageTimer)
    messageTimer = null
  }
}

const clearPourTimer = (): void => {
  if (pourTimer !== null) {
    window.clearTimeout(pourTimer)
    pourTimer = null
  }
}

/** 显示水杯提示；autoClear 为真时 2 秒后自动消失 */
const showGlassMessage = (
  text: string,
  failed: boolean,
  autoClear = false
): void => {
  clearMessageTimer()
  glassMessage.value = text
  glassMessageFailed.value = failed
  if (autoClear) {
    messageTimer = window.setTimeout(() => {
      glassMessage.value = ''
      messageTimer = null
    }, 2000)
  }
}

/** 等待两帧，确保复位到 0 的样式先落地再开始注水过渡 */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })

/** 注水结束延迟：减少动效时仅保留极短占用，避免重复触发 */
const pourEndDelay = computed(() =>
  reduced.value ? 150 : POUR_DURATION_MS + 150
)

const schedulePourEnd = (): void => {
  clearPourTimer()
  pourTimer = window.setTimeout(() => {
    pouring.value = false
    pourTimer = null
  }, pourEndDelay.value)
}

const handlePour = async (): Promise<void> => {
  if (pouring.value) {
    return
  }
  const amount = state.value.settings.cupMl
  pouring.value = true
  level.value = 0

  if (reduced.value) {
    level.value = 1
  } else {
    await nextTick()
    await nextFrame()
    level.value = 1
  }

  const next = await addCup()
  if (!next) {
    level.value = 0
    pouring.value = false
    showGlassMessage(error.value || '记录饮水失败，请稍后重试', true)
    return
  }

  showGlassMessage(`已记录 +${formatWaterAmount(amount)}`, false, true)
  schedulePourEnd()
}

/** 预设容量：直接保存，失败时在输入框下方提示 */
const selectPreset = async (ml: number): Promise<void> => {
  if (savingCup.value) {
    return
  }
  cupError.value = ''
  savingCup.value = true
  const ok = await setCupMl(ml)
  savingCup.value = false
  if (!ok) {
    cupError.value = CUP_SAVE_FAIL_MESSAGE
  }
}

/** 自定义容量：先本地校验，非法输入不调用 IPC */
const saveCustomCup = async (): Promise<void> => {
  if (savingCup.value) {
    return
  }
  const raw = cupInput.value.trim()
  const value = Number(raw)
  if (raw === '' || !isValidCupMl(value)) {
    cupError.value = INVALID_CUP_MESSAGE
    return
  }
  cupError.value = ''
  savingCup.value = true
  const ok = await setCupMl(value)
  savingCup.value = false
  if (!ok) {
    cupError.value = CUP_SAVE_FAIL_MESSAGE
    return
  }
  cupInput.value = String(value)
}

const handleUndo = async (): Promise<void> => {
  if (records.value.length === 0) {
    return
  }
  await removeLast()
  if (error.value !== '') {
    showGlassMessage(error.value, true)
    return
  }
  level.value = 0
  clearMessageTimer()
  glassMessage.value = ''
}

const handleSync = async (): Promise<void> => {
  if (syncing.value) {
    return
  }
  syncing.value = true
  syncMessage.value = ''
  syncFailed.value = false

  const result = await syncCalendar()
  syncing.value = false

  if (!result) {
    syncFailed.value = true
    syncMessage.value = error.value || SYNC_FAIL_MESSAGE
    return
  }
  if (!result.ok) {
    syncFailed.value = true
    syncMessage.value = result.message || SYNC_FAIL_MESSAGE
    return
  }
  syncMessage.value = result.message
}

/** 保存成功后以状态为准同步输入框 */
watch(cupMl, (value) => {
  cupInput.value = String(value)
})

/** 跨天时复位水杯与提示；杯容量、历史记录不受影响 */
watch(todayKey, () => {
  level.value = 0
  pouring.value = false
  glassMessage.value = ''
  glassMessageFailed.value = false
  syncMessage.value = ''
  syncFailed.value = false
  clearMessageTimer()
  clearPourTimer()
})

onUnmounted(() => {
  clearMessageTimer()
  clearPourTimer()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto scroll-py-2">
      <div class="flex flex-col gap-4 px-6 py-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <h1 class="text-sm font-semibold tracking-tight">喝水</h1>
            <div class="flex flex-wrap items-baseline gap-2" aria-live="polite">
              <span class="font-mono text-2xl font-semibold tabular-nums">
                {{ todayCount }} 杯
              </span>
              <span
                class="text-muted-foreground font-mono text-base tabular-nums"
              >
                {{ formatWaterAmount(todayTotalMl) }}
              </span>
            </div>
          </div>

          <Button
            size="sm"
            :disabled="syncing"
            aria-label="同步今日喝水记录到应用日历"
            @click="handleSync"
          >
            <Loader2
              v-if="syncing"
              class="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <CalendarPlus v-else aria-hidden="true" />
            {{ syncing ? '同步中…' : '同步到应用日历' }}
          </Button>
        </div>

        <p
          class="min-h-4 text-xs break-words"
          :class="syncFailed ? 'text-destructive' : 'text-muted-foreground'"
          aria-live="polite"
        >
          {{ syncMessage }}
        </p>

        <div
          class="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
        >
          <Card class="shadow-soft min-w-0">
            <CardContent
              class="relative flex flex-col items-center gap-3 px-5 py-5"
            >
              <div class="flex h-64 w-full items-center justify-center">
                <WaterGlass
                  :level="level"
                  :pouring="pouring"
                  :reduced="reduced"
                  :disabled="pouring"
                  :cup-ml="cupMl"
                  @pour="handlePour"
                />
              </div>

              <p
                v-if="glassMessage"
                class="animate-fade-in pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs shadow-soft"
                :class="
                  glassMessageFailed
                    ? 'border-destructive/30 bg-destructive/5 text-destructive'
                    : 'border-water-mid/40 bg-water-surface/60 text-water-deep'
                "
                aria-live="polite"
              >
                {{ glassMessage }}
              </p>

              <p class="text-muted-foreground text-xs break-words">
                今日累计 {{ todayCount }} 杯 ·
                {{ formatWaterAmount(todayTotalMl) }}
              </p>
            </CardContent>
          </Card>

          <div class="flex min-w-0 flex-col gap-4">
            <Card class="shadow-soft min-w-0">
              <CardContent class="flex flex-col gap-3 px-5 py-4">
                <div
                  class="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span class="text-sm font-medium">单杯容量</span>
                  <span class="text-muted-foreground text-xs tabular-nums">
                    当前 {{ cupMl }} ml
                  </span>
                </div>

                <div class="flex flex-wrap gap-2">
                  <Button
                    v-for="preset in WATER_CUP_PRESETS"
                    :key="preset"
                    size="sm"
                    :variant="cupMl === preset ? 'default' : 'outline'"
                    :class="
                      cupMl === preset
                        ? 'bg-primary text-primary-foreground'
                        : ''
                    "
                    :aria-pressed="cupMl === preset"
                    :aria-label="`设置单杯容量为 ${preset} 毫升`"
                    :disabled="savingCup"
                    @click="selectPreset(preset)"
                  >
                    {{ preset }}ml
                  </Button>
                </div>

                <form
                  class="flex flex-wrap items-center gap-2"
                  @submit.prevent="saveCustomCup"
                >
                  <Input
                    v-model="cupInput"
                    class="w-24"
                    type="text"
                    inputmode="numeric"
                    placeholder="自定义"
                    aria-label="自定义单杯容量（毫升）"
                    :aria-invalid="cupError ? 'true' : undefined"
                    @input="cupError = ''"
                  />
                  <span class="text-muted-foreground text-xs">ml</span>
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    :disabled="savingCup"
                    aria-label="保存自定义单杯容量"
                  >
                    保存
                  </Button>
                </form>

                <p v-if="cupError" class="text-destructive text-xs break-words">
                  {{ cupError }}
                </p>
              </CardContent>
            </Card>

            <Card class="shadow-soft min-w-0">
              <CardContent class="flex flex-col gap-3 px-5 py-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex min-w-0 items-baseline gap-2">
                    <span class="text-sm font-medium">今日记录</span>
                    <span class="text-muted-foreground text-xs tabular-nums">
                      {{ todayCount }} 杯
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="records.length === 0"
                    aria-label="撤销最后一杯饮水记录"
                    @click="handleUndo"
                  >
                    <Undo2 aria-hidden="true" />
                    撤销最后一杯
                  </Button>
                </div>

                <ul
                  v-if="records.length > 0"
                  class="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1"
                >
                  <li
                    v-for="record in records"
                    :key="record.id"
                    class="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-sm"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span
                        class="bg-water-surface text-water-deep flex size-5 shrink-0 items-center justify-center rounded-full"
                      >
                        <Droplets class="size-3" aria-hidden="true" />
                      </span>
                      <span class="font-mono tabular-nums">
                        {{ formatDrinkTime(record.drankAt) }}
                      </span>
                    </span>
                    <span
                      class="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
                    >
                      {{ formatWaterAmount(record.amountMl) }}
                    </span>
                  </li>
                </ul>

                <div v-else class="empty-state py-8">
                  <span class="empty-state-icon">
                    <Droplets class="size-5" aria-hidden="true" />
                  </span>
                  <p class="text-muted-foreground text-xs break-words">
                    还没有记录，长按左侧水杯开始吧
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>

    <footer
      class="bg-muted/30 text-muted-foreground border-t px-6 py-2 text-xs break-words"
    >
      记录仅保存在本机数据库；同步后可在「日历」模块查看
    </footer>
  </div>
</template>
