<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { useVideo } from '@/composables/useVideo'
import { VIDEO_SUBMODULES } from '@/lib/video-submodules'

/** 子模块选择持久化；非法值回退到「链接解析下载」 */
const stored = useLocalStorage<string>('reminder:video-submodule', 'parse')

const {
  subModule,
  setSubModule,
  loadEngine,
  subscribeDownload,
  subscribeTranscript
} = useVideo()

const initial = stored.value === 'transcript' ? 'transcript' : 'parse'
if (stored.value !== initial) {
  stored.value = initial
}
setSubModule(initial)

watch(subModule, (value) => {
  stored.value = value
})

/** 当前子模块元信息，未匹配时回退到首个 */
const activeMeta = computed(
  () =>
    VIDEO_SUBMODULES.find((item) => item.id === subModule.value) ??
    VIDEO_SUBMODULES[0]
)

/** 左右方向键在 tab 间循环切换，并同步焦点 */
const handleTabKeydown = (event: KeyboardEvent, index: number): void => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const delta = event.key === 'ArrowRight' ? 1 : -1
  const next =
    VIDEO_SUBMODULES[
      (index + delta + VIDEO_SUBMODULES.length) % VIDEO_SUBMODULES.length
    ]
  setSubModule(next.id)
  document.getElementById(`video-submodule-tab-${next.id}`)?.focus()
}

let unsubscribeDownload: (() => void) | null = null
let unsubscribeTranscript: (() => void) | null = null

onMounted(() => {
  void loadEngine()
  unsubscribeDownload = subscribeDownload()
  unsubscribeTranscript = subscribeTranscript()
})

onUnmounted(() => {
  unsubscribeDownload?.()
  unsubscribeDownload = null
  unsubscribeTranscript?.()
  unsubscribeTranscript = null
})
</script>

<template>
  <div class="flex h-full min-w-0 flex-col overflow-hidden">
    <div
      class="border-border/60 shrink-0 border-b px-3 pt-3 sm:px-5 sm:pt-5"
    >
      <div
        role="tablist"
        aria-label="短视频子模块切换"
        class="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-2"
      >
        <button
          v-for="(item, index) in VIDEO_SUBMODULES"
          :id="`video-submodule-tab-${item.id}`"
          :key="item.id"
          type="button"
          role="tab"
          :aria-selected="subModule === item.id"
          :aria-controls="`video-submodule-panel-${item.id}`"
          :tabindex="subModule === item.id ? 0 : -1"
          :title="item.description"
          class="focus-visible:ring-ring/50 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3"
          :class="
            subModule === item.id
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted/60'
          "
          @click="setSubModule(item.id)"
          @keydown="handleTabKeydown($event, index)"
        >
          <component :is="item.icon" class="size-3.5" aria-hidden="true" />
          {{ item.label }}
        </button>
      </div>
    </div>

    <div
      :id="`video-submodule-panel-${subModule}`"
      role="tabpanel"
      :aria-labelledby="`video-submodule-tab-${subModule}`"
      class="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <component :is="activeMeta.component" class="min-h-0 flex-1" />
    </div>
  </div>
</template>
