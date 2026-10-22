<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLocalStorage, usePreferredDark } from '@vueuse/core'
import type { AppModuleId } from '@shared/navigation'
import { DEFAULT_MODULE } from '@shared/navigation'
import type { AppTheme } from '@shared/settings'
import AppSidebar from '@/components/AppSidebar.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import UpdateCheckDialog from '@/components/UpdateCheckDialog.vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { applyTheme, useSettings } from '@/composables/useSettings'
import { useUpdateCheck } from '@/composables/useUpdateCheck'
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
const preferredDark = usePreferredDark()

const currentModule = computed(() => moduleById(active.value))

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
        <header class="flex h-14 shrink-0 items-center border-b px-6">
          <div class="flex flex-col">
            <h1 class="text-base leading-tight font-semibold">
              {{ pageTitle }}
            </h1>
            <p class="text-muted-foreground text-xs">{{ pageDescription }}</p>
          </div>
        </header>

        <div class="flex-1 overflow-hidden">
          <SettingsPanel v-if="showSettings" />
          <component
            :is="module.component"
            v-for="module in MODULES"
            v-show="!showSettings && active === module.id"
            :key="module.id"
            class="h-full"
          />
        </div>
      </div>
    </div>

    <!-- 全局更新提示：任意模块页面均可弹出 -->
    <UpdateCheckDialog
      v-model:open="updateOpen"
      :checking="updateChecking"
      :result="updateResult"
    />
  </TooltipProvider>
</template>
