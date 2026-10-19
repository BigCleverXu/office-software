<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import { Bell, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import type { AppModuleId } from '@shared/navigation'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { MODULES } from '@/lib/modules'
import UpdateCheckEntry from './UpdateCheckEntry.vue'

const props = defineProps<{ active: AppModuleId; collapsed: boolean }>()

const emit = defineEmits<{
  select: [id: AppModuleId]
  toggle: []
}>()

interface NavItem {
  id: AppModuleId
  label: string
  icon: Component
  /** 选中 / 未选中态对应的类名 */
  itemClass: string
}

/** 侧边栏导航项：预计算选中态类名，避免在模板中调用方法 */
const navItems = computed<NavItem[]>(() =>
  MODULES.map((module) => ({
    id: module.id,
    label: module.label,
    icon: module.icon,
    itemClass:
      module.id === props.active
        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
        : [
            'text-sidebar-foreground/70',
            'hover:bg-sidebar-accent/60',
            'hover:text-sidebar-accent-foreground'
          ].join(' ')
  }))
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
        class="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
      >
        <Bell class="size-4" />
      </div>
      <span v-if="!collapsed" class="truncate text-sm font-semibold">
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
              class="flex items-center gap-3 rounded-md px-3 py-2 text-sm"
              :class="item.itemClass"
              @click="emit('select', item.id)"
            >
              <component :is="item.icon" class="size-4 shrink-0" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ item.label }}</TooltipContent>
        </Tooltip>

        <button
          v-else
          type="button"
          class="flex items-center gap-3 rounded-md px-3 py-2 text-sm"
          :class="item.itemClass"
          @click="emit('select', item.id)"
        >
          <component :is="item.icon" class="size-4 shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </button>
      </template>
    </nav>

    <div class="border-sidebar-border flex flex-col gap-1 border-t p-2">
      <UpdateCheckEntry :collapsed="collapsed" />
      <button
        type="button"
        class="text-muted-foreground hover:bg-sidebar-accent flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:text-sidebar-accent-foreground"
        @click="emit('toggle')"
      >
        <PanelLeftClose v-if="!collapsed" class="size-4 shrink-0" />
        <PanelLeftOpen v-else class="size-4 shrink-0" />
        <span v-if="!collapsed" class="truncate">收起侧边栏</span>
      </button>
    </div>
  </aside>
</template>
