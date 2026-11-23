<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import {
  BatteryCharging,
  BatteryWarning,
  Gamepad2,
  Headphones,
  Keyboard,
  Monitor,
  Mouse,
  Speaker,
  Usb
} from 'lucide-vue-next'
import {
  batteryHintOf,
  batteryTierOf,
  DEVICE_CONNECTION_LABELS
} from '@shared/devices'
import type { BatteryTier, DeviceInfo, DeviceKind } from '@shared/devices'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

const props = defineProps<{
  device: DeviceInfo
}>()

/** 设备类别与图标映射，无法识别的类别统一使用 USB 图标 */
const KIND_ICONS: Record<DeviceKind, Component> = {
  mouse: Mouse,
  keyboard: Keyboard,
  headset: Headphones,
  speaker: Speaker,
  display: Monitor,
  gamepad: Gamepad2,
  other: Usb
}

const icon = computed<Component>(() => KIND_ICONS[props.device.kind])

const connectionLabel = computed(
  () => DEVICE_CONNECTION_LABELS[props.device.connection]
)

/** 厂商与型号拼接；两者都缺失时显示占位文案 */
const metaText = computed(() => {
  const parts = [props.device.vendor, props.device.model].filter(
    (value): value is string => Boolean(value)
  )
  return parts.length > 0 ? parts.join(' · ') : '未知厂商'
})

const tier = computed<BatteryTier>(() => batteryTierOf(props.device.battery))

const percent = computed(() => props.device.battery?.percent ?? null)

const charging = computed(() => props.device.battery?.charging ?? false)

const hint = computed(() => batteryHintOf(tier.value))

/** 百分比文字颜色：严重不足用危险色，偏低用琥珀色 */
const percentTone = computed(() => {
  switch (tier.value) {
    case 'critical':
      return 'text-destructive'
    case 'low':
      return 'text-amber-600 dark:text-amber-400'
    default:
      return 'text-foreground'
  }
})

/** 进度条颜色：覆盖 Progress 默认的 primary 指示条 */
const barClass = computed(() => {
  switch (tier.value) {
    case 'critical':
      return '[&>[data-slot=progress-indicator]]:bg-destructive'
    case 'low':
      return '[&>[data-slot=progress-indicator]]:bg-amber-500'
    default:
      return ''
  }
})

/** 分级文案颜色：仅异常分级着色，正常分级保持次要文字 */
const hintTone = computed(() => {
  switch (tier.value) {
    case 'critical':
      return 'text-destructive'
    case 'low':
      return 'text-amber-600 dark:text-amber-400'
    default:
      return 'text-muted-foreground'
  }
})
</script>

<template>
  <Card class="shadow-soft min-w-0">
    <CardContent class="flex flex-col gap-3 px-5 py-4">
      <div class="flex min-w-0 items-start gap-3">
        <span
          class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl"
        >
          <component :is="icon" class="size-4" aria-hidden="true" />
        </span>

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            class="truncate text-sm font-medium"
            :title="device.name || '未知设备'"
          >
            {{ device.name || '未知设备' }}
          </span>
          <span class="text-muted-foreground truncate text-xs" :title="metaText">
            {{ metaText }}
          </span>
        </div>

        <Badge variant="secondary" class="shrink-0">
          {{ connectionLabel }}
        </Badge>
      </div>

      <div v-if="percent !== null" class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-baseline gap-2">
          <span
            class="font-mono text-2xl font-semibold tabular-nums"
            :class="percentTone"
          >
            {{ Math.round(percent) }}%
          </span>
          <span
            v-if="charging"
            class="text-muted-foreground flex items-center gap-1 text-xs"
          >
            <BatteryCharging class="size-3.5" aria-hidden="true" />
            充电中
          </span>
        </div>

        <Progress
          :model-value="percent"
          class="h-1.5"
          :class="barClass"
          :aria-label="`${device.name || '设备'}电量`"
        />

        <span class="text-xs" :class="hintTone">{{ hint }}</span>
      </div>

      <div
        v-else
        class="text-muted-foreground flex items-center gap-1.5 text-xs"
      >
        <BatteryWarning class="size-3.5 shrink-0" aria-hidden="true" />
        不支持电量上报
      </div>
    </CardContent>
  </Card>
</template>
