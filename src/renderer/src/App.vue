<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import type { AppModuleId } from '@shared/navigation'
import { DEFAULT_MODULE } from '@shared/navigation'
import AppSidebar from '@/components/AppSidebar.vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MODULES, moduleById } from '@/lib/modules'

const active = ref<AppModuleId>(DEFAULT_MODULE)
const collapsed = useLocalStorage('reminder:sidebar-collapsed', false)

const currentModule = computed(() => moduleById(active.value))

let unsubscribeNavigate: (() => void) | null = null

const select = (id: AppModuleId): void => {
  active.value = id
  void window.api.market.setLastPage(id)
}

const toggleCollapsed = (): void => {
  collapsed.value = !collapsed.value
}

onMounted(async () => {
  const state = await window.api.market.getState()
  active.value = state.settings.lastPage
  unsubscribeNavigate = window.api.market.onNavigate((id) => {
    active.value = id
  })
})

onUnmounted(() => {
  unsubscribeNavigate?.()
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex h-full">
      <AppSidebar
        :active="active"
        :collapsed="collapsed"
        @select="select"
        @toggle="toggleCollapsed"
      />

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-14 shrink-0 items-center border-b px-6">
          <div class="flex flex-col">
            <h1 class="text-base leading-tight font-semibold">
              {{ currentModule.label }}
            </h1>
            <p class="text-muted-foreground text-xs">
              {{ currentModule.description }}
            </p>
          </div>
        </header>

        <div class="flex-1 overflow-hidden">
          <component
            :is="module.component"
            v-for="module in MODULES"
            v-show="active === module.id"
            :key="module.id"
            class="h-full"
          />
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>
