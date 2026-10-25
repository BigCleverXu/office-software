<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLocalStorage, usePreferredDark } from '@vueuse/core'
import { Loader2, Settings } from 'lucide-vue-next'
import type { AppModuleId } from '@shared/navigation'
import { DEFAULT_MODULE } from '@shared/navigation'
import type { AppTheme } from '@shared/settings'
import AppSidebar from '@/components/AppSidebar.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import UpdateCheckDialog from '@/components/UpdateCheckDialog.vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { applyTheme, useSettings } from '@/composables/useSettings'
import { useUpdateCheck } from '@/composables/useUpdateCheck'
import { useUpdateDownload } from '@/composables/useUpdateDownload'
import { MODULES, moduleById } from '@/lib/modules'

const active = ref<AppModuleId>(DEFAULT_MODULE)
const collapsed = useLocalStorage('reminder:sidebar-collapsed', false)
const showSettings = ref(false)

const { settings } = useSettings()
const {
  checking: updateChecking,
  open: updateOpen,
  result: updateResult,
  showResult
} = useUpdateCheck()
const { isDownloading: updateDownloading, progress: updateDownloadProgress } =
  useUpdateDownload()
const preferredDark = usePreferredDark()

const currentModule = computed(() => moduleById(active.value))

/** 顶栏模块徽章图标：设置页使用齿轮，其余沿用当前模块图标 */
const headerIcon = computed(() =>
  showSettings.value ? Settings : currentModule.value.icon
)

const pageTitle = computed(() =>
  showSettings.value ? '设置' : currentModule.value.label
)

const pageDescription = computed(() =>
  showSettings.value ? '应用偏好与数据管理' : currentModule.value.description
)

/** 设置未加载时沿用 preload 注入的初始主题，避免首帧与挂载前不一致 */
const theme = computed<AppTheme>(
  () => settings.value?.theme ?? window.api.settings.initialTheme
)

// system 模式下系统外观变化也会触发重新应用
watch(
  [theme, preferredDark],
  () => {
    applyTheme(theme.value)
  },
  { immediate: true }
)

let unsubscribeNavigate: (() => void) | null = null
let unsubscribeUpdate: (() => void) | null = null

/** 选择模块即退出设置页，并记录模块记忆 */
const select = (id: AppModuleId): void => {
  showSettings.value = false
  active.value = id
  void window.api.market.setLastPage(id)
}

const openSettings = (): void => {
  showSettings.value = true
}

const toggleCollapsed = (): void => {
  collapsed.value = !collapsed.value
}

onMounted(async () => {
  // 先订阅自动检查提醒，避免启动首检结果在挂载前丢失
  unsubscribeUpdate = window.api.update.onAvailable((next) => {
    showResult(next)
  })
  const state = await window.api.market.getState()
  active.value = state.settings.lastPage
  unsubscribeNavigate = window.api.market.onNavigate((id) => {
    showSettings.value = false
    active.value = id
  })
})

onUnmounted(() => {
  unsubscribeNavigate?.()
  unsubscribeUpdate?.()
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex h-full">
      <AppSidebar
        :active="active"
        :collapsed="collapsed"
        :settings-active="showSettings"
        @select="select"
        @settings="openSettings"
        @toggle="toggleCollapsed"
      />

      <div class="flex min-w-0 flex-1 flex-col">
        <header
          class="border-border/60 bg-background/80 flex h-14 shrink-0 items-center gap-3 border-b px-6 backdrop-blur"
        >
          <div
            class="bg-muted text-foreground ring-foreground/5 shadow-soft flex size-9 shrink-0 items-center justify-center rounded-lg ring-1"
          >
            <component :is="headerIcon" class="size-4" />
          </div>
          <div class="flex flex-col">
            <h1 class="text-lg leading-tight font-semibold tracking-tight">
              {{ pageTitle }}
            </h1>
            <p class="text-muted-foreground text-xs">{{ pageDescription }}</p>
          </div>
        </header>

        <div class="app-canvas flex-1 overflow-hidden">
          <SettingsPanel v-if="showSettings" class="animate-fade-in" />
          <template v-for="module in MODULES" :key="module.id">
            <Transition name="page">
              <component
                :is="module.component"
                v-show="!showSettings && active === module.id"
                class="h-full"
              />
            </Transition>
          </template>
        </div>
      </div>
    </div>

    <!-- 全局更新提示：任意模块页面均可弹出 -->
    <UpdateCheckDialog
      v-model:open="updateOpen"
      :checking="updateChecking"
      :result="updateResult"
    />

    <!-- 下载中关闭弹窗后仍可看到进度，点击重新打开弹窗 -->
    <button
      v-if="updateDownloading && !updateOpen"
      type="button"
      class="bg-background animate-slide-up shadow-lift fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-lg"
      @click="updateOpen = true"
    >
      <Loader2 class="size-4 animate-spin" />
      正在下载更新 {{ updateDownloadProgress?.percent ?? 0 }}%
    </button>
  </TooltipProvider>
</template>
