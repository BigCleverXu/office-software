<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import { Bell, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-vue-next'
import type { AppModuleId } from '@shared/navigation'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { MODULES } from '@/lib/modules'

const props = defineProps<{
  active: AppModuleId
  collapsed: boolean
  settingsActive: boolean
}>()

const emit = defineEmits<{
  select: [id: AppModuleId]
  settings: []
  toggle: []
}>()

interface NavItem {
  id: AppModuleId
  label: string
  icon: Component
  /** 是否为当前选中项 */
  active: boolean
  /** 选中 / 未选中态对应的类名 */
  itemClass: string
}

/** 侧边栏导航项：预计算选中态类名，避免在模板中调用方法 */
const navItems = computed<NavItem[]>(() =>
  MODULES.map((module) => ({
    id: module.id,
    label: module.label,
    icon: module.icon,
    active: module.id === props.active,
    itemClass:
      module.id === props.active
        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-soft'
        : [
            'text-sidebar-foreground/70',
            'hover:bg-sidebar-accent/60',
            'hover:text-sidebar-accent-foreground'
          ].join(' ')
  }))
)

/** 设置入口的选中 / 未选中态类名 */
const settingsItemClass = computed(() =>
  props.settingsActive
    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-soft'
    : [
        'text-sidebar-foreground/70',
        'hover:bg-sidebar-accent/60',
        'hover:text-sidebar-accent-foreground'
      ].join(' ')
)
</script>

<template>
  <aside
    class="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full flex-col border-r transition-[width] duration-200"
    :class="collapsed ? 'w-16' : 'w-56'"
  >
    <div
      class="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border px-3"
    >
      <div
        class="from-foreground to-foreground/75 text-background ring-foreground/10 shadow-soft flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ring-1"
      >
        <Bell class="size-4" />
      </div>
      <span
        v-if="!collapsed"
        class="animate-fade-in truncate text-sm font-semibold"
      >
        定时提醒
      </span>
    </div>

    <nav class="flex flex-1 flex-col gap-1 p-2">
      <template v-for="item in navItems" :key="item.id">
        <Tooltip v-if="collapsed">
          <TooltipTrigger as-child>
            <button
              type="button"
              :aria-label="item.label"
              :title="item.label"
              class="relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200"
              :class="item.itemClass"
              @click="emit('select', item.id)"
            >
              <span
                v-if="item.active"
                class="bg-sidebar-primary absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full"
              />
              <component :is="item.icon" class="size-4 shrink-0" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ item.label }}</TooltipContent>
        </Tooltip>

        <button
          v-else
          type="button"
          class="relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200"
          :class="item.itemClass"
          @click="emit('select', item.id)"
        >
          <span
            v-if="item.active"
            class="bg-sidebar-primary absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full"
          />
          <component :is="item.icon" class="size-4 shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </button>
      </template>
    </nav>

    <div class="border-sidebar-border flex flex-col gap-1 border-t p-2">
      <Tooltip v-if="collapsed">
        <TooltipTrigger as-child>
          <button
            type="button"
            aria-label="设置"
            title="设置"
            class="relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200"
            :class="settingsItemClass"
            @click="emit('settings')"
          >
            <span
              v-if="settingsActive"
              class="bg-sidebar-primary absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full"
            />
            <Settings class="size-4 shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">设置</TooltipContent>
      </Tooltip>

      <button
        v-else
        type="button"
        class="relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200"
        :class="settingsItemClass"
        @click="emit('settings')"
      >
        <span
          v-if="settingsActive"
          class="bg-sidebar-primary absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full"
        />
        <Settings class="size-4 shrink-0" />
        <span class="truncate">设置</span>
      </button>

      <button
        type="button"
        class="text-muted-foreground hover:bg-sidebar-accent flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 hover:text-sidebar-accent-foreground"
        @click="emit('toggle')"
      >
        <PanelLeftClose v-if="!collapsed" class="size-4 shrink-0" />
        <PanelLeftOpen v-else class="size-4 shrink-0" />
        <span v-if="!collapsed" class="truncate">收起侧边栏</span>
      </button>
    </div>
  </aside>
</template>
