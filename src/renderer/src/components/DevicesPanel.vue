<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useElementVisibility } from '@vueuse/core'
import {
  AlertCircle,
  MonitorOff,
  RefreshCw,
  RotateCcw,
  Usb,
  X
} from 'lucide-vue-next'
import {
  DEVICE_WARNING_MAC_POINTER,
  DEVICE_WARNING_MAC_VOLUME,
  DEVICE_WARNING_UNSUPPORTED
} from '@shared/devices'
import DeviceBatteryCard from '@/components/DeviceBatteryCard.vue'
import DeviceSettingsSection from '@/components/DeviceSettingsSection.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { confirm } from '@/composables/useConfirm'
import { useDevices } from '@/composables/useDevices'

const {
  snapshot,
  refreshing,
  lastError,
  setVisible,
  refresh,
  setMasterVolume,
  setOutputVolume,
  setMuted,
  setPointerSpeed,
  reset
} = useDevices()

/** 根节点用于可见性检测：面板常驻挂载，只能靠可见性控制轮询 */
const rootRef = ref<HTMLElement | null>(null)
const visible = useElementVisibility(rootRef)

/** 面板常驻挂载（v-show），只在真正可见时才触发扫描与轮询 */
watch(
  visible,
  (value) => {
    setVisible(value)
    if (value) {
      void refresh()
    }
  },
  { immediate: true }
)

/** 写操作进行中，用于禁用调节控件 */
const saving = ref(false)

const submit = async (action: () => Promise<boolean>): Promise<void> => {
  saving.value = true
  try {
    await action()
  } finally {
    saving.value = false
  }
}

const handleRefresh = (): void => {
  void refresh()
}

const handleMaster = (value: number): void => {
  void submit(() => setMasterVolume(value))
}

const handleOutput = (id: string, value: number): void => {
  void submit(() => setOutputVolume(id, value))
}

const handleMute = (muted: boolean): void => {
  void submit(() => setMuted(muted))
}

const handlePointer = (value: number): void => {
  void submit(() => setPointerSpeed(value))
}

const RESET_DESCRIPTION =
  '将把系统音量、静音、各输出设备音量与指针速度还原到进入本模块时的状态。'

/** 恢复默认设置：确认后执行，成功再重新拉取一次快照 */
const handleReset = async (): Promise<void> => {
  const confirmed = await confirm({
    title: '恢复默认设置',
    description: RESET_DESCRIPTION,
    confirmText: '恢复'
  })
  if (!confirmed) {
    return
  }
  saving.value = true
  try {
    const ok = await reset()
    if (ok) {
      await refresh()
    }
  } finally {
    saving.value = false
  }
}

const dismissError = (): void => {
  lastError.value = null
}

/** 顶部状态文案：刷新优先，其次按快照状态与更新时间组合 */
const updatedText = computed(() => {
  if (refreshing.value) {
    return '刷新中…'
  }
  const { status, updatedAtLabel } = snapshot.value
  switch (status) {
    case 'loading':
      return '加载中…'
    case 'partial':
      return updatedAtLabel ? `部分可用 · 已更新 ${updatedAtLabel}` : '部分可用'
    case 'failed':
      return '读取失败'
    default:
      return updatedAtLabel ? `已更新 ${updatedAtLabel}` : '暂无数据'
  }
})

const statusTone = computed(() =>
  snapshot.value.status === 'failed'
    ? 'text-destructive'
    : 'text-muted-foreground'
)

const devices = computed(() => snapshot.value.devices)

const showSkeleton = computed(
  () => snapshot.value.status === 'loading' && devices.value.length === 0
)

const showEmpty = computed(
  () => !showSkeleton.value && devices.value.length === 0
)

/** 平台限制说明已在对应控件旁展示，提示条只保留真正的异常 */
const INLINE_WARNINGS: readonly string[] = [
  DEVICE_WARNING_MAC_VOLUME,
  DEVICE_WARNING_MAC_POINTER
]

const actionableWarnings = computed(() =>
  snapshot.value.warnings.filter(
    (warning) => !INLINE_WARNINGS.includes(warning)
  )
)

const visibleWarnings = computed(() => actionableWarnings.value.slice(0, 3))

const extraWarningCount = computed(() =>
  Math.max(0, actionableWarnings.value.length - 3)
)

const audioUnavailable = computed(
  () =>
    snapshot.value.audio.masterVolume === null &&
    snapshot.value.audio.outputs.length === 0
)

const FOOTER_TEXT =
  '数据来源：Windows PnP / CoreAudio 与 macOS system_profiler，电量由设备自身上报。'
</script>

<template>
  <div ref="rootRef" class="flex h-full flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto scroll-py-2">
      <div class="flex flex-col gap-4 px-6 py-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <h1 class="text-sm font-semibold tracking-tight">设备</h1>
            <span class="truncate text-xs" :class="statusTone">
              {{ updatedText }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="refreshing || !snapshot.supported"
              aria-label="刷新设备状态"
              @click="handleRefresh"
            >
              <RefreshCw
                aria-hidden="true"
                :class="{
                  'animate-spin motion-reduce:animate-none': refreshing
                }"
              />
              刷新
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="saving || !snapshot.supported"
              aria-label="恢复默认设置"
              @click="handleReset"
            >
              <RotateCcw aria-hidden="true" />
              恢复默认设置
            </Button>
          </div>
        </div>

        <div
          v-if="!snapshot.supported"
          class="bg-card shadow-soft empty-state text-muted-foreground animate-fade-in rounded-2xl border border-border/70 px-6 py-16"
        >
          <span class="empty-state-icon">
            <MonitorOff class="size-6" aria-hidden="true" />
          </span>
          <p class="text-sm">{{ DEVICE_WARNING_UNSUPPORTED }}</p>
        </div>

        <template v-else>
          <div
            v-if="actionableWarnings.length > 0"
            class="flex flex-wrap items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-300"
          >
            <AlertCircle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                v-for="(warning, index) in visibleWarnings"
                :key="index"
                class="break-words"
              >
                {{ warning }}
              </span>
              <span v-if="extraWarningCount > 0" class="opacity-80">
                等 {{ extraWarningCount }} 项
              </span>
            </div>
          </div>

          <div
            v-if="lastError"
            class="border-destructive/30 bg-destructive/5 text-destructive flex items-center justify-between gap-2 rounded-xl border px-4 py-2 text-xs"
          >
            <span class="flex min-w-0 items-center gap-2">
              <AlertCircle class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="truncate">{{ lastError }}</span>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              class="shrink-0"
              aria-label="关闭错误提示"
              @click="dismissError"
            >
              <X aria-hidden="true" />
            </Button>
          </div>

          <div
            v-if="showSkeleton"
            class="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
            role="status"
            aria-busy="true"
          >
            <span class="sr-only">正在加载设备状态</span>
            <Card
              v-for="index in 3"
              :key="index"
              class="skeleton-shimmer h-32"
            />
          </div>

          <section
            v-else-if="showEmpty"
            class="bg-card shadow-soft empty-state text-muted-foreground rounded-2xl border border-border/70 px-6 py-16"
          >
            <span class="empty-state-icon">
              <Usb class="size-6" aria-hidden="true" />
            </span>
            <p class="text-sm">未发现已连接的外设</p>
            <Button
              variant="outline"
              size="sm"
              aria-label="重新扫描设备"
              @click="handleRefresh"
            >
              <RefreshCw aria-hidden="true" />
              重新扫描
            </Button>
          </section>

          <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DeviceBatteryCard
              v-for="device in devices"
              :key="device.id"
              :device="device"
            />
          </div>

          <p
            v-if="devices.length > 0 && snapshot.hiddenDeviceCount > 0"
            class="text-muted-foreground text-xs"
          >
            另有 {{ snapshot.hiddenDeviceCount }} 个系统内部 / 虚拟设备已隐藏
          </p>

          <p
            v-if="!showSkeleton && audioUnavailable"
            class="text-muted-foreground rounded-xl border border-dashed px-4 py-2 text-xs"
          >
            音频状态不可用
          </p>

          <DeviceSettingsSection
            v-if="!showSkeleton"
            :audio="snapshot.audio"
            :pointer="snapshot.pointer"
            :platform="snapshot.platform"
            :busy="saving"
            @master="handleMaster"
            @output="handleOutput"
            @mute="handleMute"
            @pointer="handlePointer"
            @reset="handleReset"
          />
        </template>
      </div>
    </div>

    <footer
      class="bg-muted/30 text-muted-foreground border-t px-6 py-2 text-xs"
    >
      {{ FOOTER_TEXT }}
    </footer>
  </div>
</template>
