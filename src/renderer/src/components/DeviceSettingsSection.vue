<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RotateCcw, Volume2 } from 'lucide-vue-next'
import { pointerPercentToSpeed, pointerSpeedToPercent } from '@shared/devices'
import type {
  AudioOutputDevice,
  AudioSnapshot,
  PointerSnapshot
} from '@shared/devices'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

const props = withDefaults(
  defineProps<{
    audio: AudioSnapshot
    pointer: PointerSnapshot
    platform: string
    disabled?: boolean
    busy?: boolean
  }>(),
  {
    disabled: false,
    busy: false
  }
)

const emits = defineEmits<{
  master: [value: number]
  output: [id: string, value: number]
  mute: [muted: boolean]
  pointer: [value: number]
  reset: []
}>()

/** 任意写操作进行中或外部禁用时，所有滑块都不可拖动 */
const sliderDisabled = computed(() => props.disabled || props.busy)

/** 主音量拖动草稿：松手后才提交，避免拖动过程产生大量写请求 */
const masterDraft = ref<number | null>(props.audio.masterVolume)

watch(
  () => props.audio.masterVolume,
  (value) => {
    masterDraft.value = value
  }
)

const masterPercent = computed(() => masterDraft.value ?? 0)

const masterText = computed(() =>
  masterDraft.value === null ? '--' : `${Math.round(masterDraft.value)}%`
)

const onMasterInput = (value: number): void => {
  masterDraft.value = value
}

const onMasterCommit = (): void => {
  if (masterDraft.value === null) {
    return
  }
  emits('master', masterDraft.value)
}

const onMuteChange = (muted: boolean): void => {
  emits('mute', muted)
}

/** 输出设备音量草稿，按设备 id 缓存 */
const volumeDrafts = ref<Record<string, number>>({})

watch(
  () => props.audio.outputs,
  (outputs) => {
    const next: Record<string, number> = {}
    for (const output of outputs) {
      next[output.id] = output.volume ?? volumeDrafts.value[output.id] ?? 0
    }
    volumeDrafts.value = next
  },
  { immediate: true, deep: true }
)

/** 可读且允许单独调节才启用滑块 */
const isControllable = (output: AudioOutputDevice): boolean =>
  output.controllable && output.volume !== null

const outputPercent = (output: AudioOutputDevice): number =>
  volumeDrafts.value[output.id] ?? output.volume ?? 0

const outputText = (output: AudioOutputDevice): string =>
  isControllable(output) ? `${Math.round(outputPercent(output))}%` : '--'

const onOutputInput = (output: AudioOutputDevice, value: number): void => {
  volumeDrafts.value = { ...volumeDrafts.value, [output.id]: value }
}

const onOutputCommit = (output: AudioOutputDevice): void => {
  if (!isControllable(output)) {
    return
  }
  emits('output', output.id, Math.round(outputPercent(output)))
}

/** 指针速度以百分比展示，提交时再按平台步长换算回系统档位 */
const pointerBase = computed(
  () =>
    pointerSpeedToPercent(
      props.pointer.speed,
      props.pointer.min,
      props.pointer.max
    ) ?? 0
)

const pointerDraft = ref(pointerBase.value)

watch(pointerBase, (value) => {
  pointerDraft.value = value
})

/** 百分比步长：Windows 20 档约为 5%，最小为 1 */
const pointerStep = computed(() => {
  const span = props.pointer.max - props.pointer.min
  if (
    !Number.isFinite(span) ||
    span <= 0 ||
    !Number.isFinite(props.pointer.step) ||
    props.pointer.step <= 0
  ) {
    return 1
  }
  return Math.max(1, 100 / (span / props.pointer.step))
})

const pointerText = computed(() => {
  if (props.pointer.speed === null) {
    return '--'
  }
  if (props.platform === 'darwin') {
    return `${Math.round(pointerDraft.value)}%`
  }
  const speed = pointerPercentToSpeed(
    pointerDraft.value,
    props.pointer.min,
    props.pointer.max,
    props.pointer.step
  )
  return `系统档位 ${speed === null ? '--' : Math.round(speed)}/${props.pointer.max}`
})

const onPointerInput = (value: number): void => {
  pointerDraft.value = value
}

const onPointerCommit = (): void => {
  const speed = pointerPercentToSpeed(
    pointerDraft.value,
    props.pointer.min,
    props.pointer.max,
    props.pointer.step
  )
  if (speed === null) {
    return
  }
  emits('pointer', speed)
}

const handleReset = (): void => {
  emits('reset')
}
</script>

<template>
  <Card class="shadow-soft min-w-0">
    <CardContent class="flex flex-col gap-4 px-5 py-4">
      <section class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-sm font-medium">
            <Volume2 class="size-4" aria-hidden="true" />
            主音量
          </span>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground font-mono text-sm tabular-nums">
              {{ masterText }}
            </span>
            <Switch
              :model-value="audio.masterMuted"
              :disabled="sliderDisabled"
              aria-label="系统静音"
              @update:model-value="onMuteChange"
            />
            <span class="text-muted-foreground text-xs">静音</span>
          </div>
        </div>

        <Slider
          :model-value="masterPercent"
          :min="0"
          :max="100"
          :step="1"
          :disabled="sliderDisabled"
          aria-label="系统主音量"
          @update:model-value="onMasterInput"
          @commit="onMasterCommit"
        />
      </section>

      <Separator />

      <section class="flex flex-col gap-1">
        <span class="text-sm font-medium">输出设备</span>

        <div
          v-for="output in audio.outputs"
          :key="output.id"
          class="flex flex-col gap-2 py-2 md:flex-row md:items-center md:gap-3"
        >
          <div class="flex min-w-0 flex-col gap-0.5 md:w-2/5">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate text-sm" :title="output.name">
                {{ output.name || '未命名设备' }}
              </span>
              <Badge
                v-if="output.isDefault"
                variant="secondary"
                class="shrink-0"
              >
                默认
              </Badge>
            </div>
            <span
              v-if="platform === 'darwin' && !isControllable(output)"
              class="text-muted-foreground text-xs"
            >
              系统不支持单独调节
            </span>
          </div>

          <div class="flex min-w-0 flex-1 items-center gap-3">
            <Slider
              class="min-w-0 flex-1"
              :model-value="outputPercent(output)"
              :min="0"
              :max="100"
              :step="1"
              :disabled="sliderDisabled || !isControllable(output)"
              :aria-label="`${output.name || '输出设备'}音量`"
              @update:model-value="onOutputInput(output, $event)"
              @commit="onOutputCommit(output)"
            />
            <span
              class="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
            >
              {{ outputText(output) }}
            </span>
          </div>
        </div>

        <p
          v-if="audio.outputs.length === 0"
          class="text-muted-foreground text-xs"
        >
          未检测到输出设备
        </p>
      </section>

      <Separator />

      <section class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm font-medium">指针速度</span>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">
            {{ pointerText }}
          </span>
        </div>

        <Slider
          :model-value="pointerDraft"
          :min="0"
          :max="100"
          :step="pointerStep"
          :disabled="sliderDisabled"
          aria-label="指针移动速度"
          @update:model-value="onPointerInput"
          @commit="onPointerCommit"
        />

        <p class="text-muted-foreground text-xs">
          {{
            platform === 'darwin'
              ? '按百分比调整指针移动速度，可能需要重新登录后生效'
              : '按系统档位调整指针移动速度'
          }}
        </p>
      </section>

      <div class="flex justify-end border-t border-border/60 pt-3">
        <Button
          variant="outline"
          size="sm"
          :disabled="sliderDisabled"
          @click="handleReset"
        >
          <RotateCcw aria-hidden="true" />
          恢复默认设置
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
