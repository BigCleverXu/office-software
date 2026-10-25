<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Component, ComponentPublicInstance } from 'vue'
import { useEventListener } from '@vueuse/core'
import { CalendarDays, Plus } from 'lucide-vue-next'

/** 菜单宽度估算值（px），用于收拢到视口内 */
const MENU_WIDTH = 160
/** 菜单高度估算值（px），用于收拢到视口内 */
const MENU_HEIGHT = 88
/** 与视口边缘保留的间距（px） */
const VIEWPORT_GAP = 8

const props = defineProps<{
  open: boolean
  x: number
  y: number
  date: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  create: []
  detail: []
}>()

type MenuAction = 'create' | 'detail'

interface MenuItem {
  action: MenuAction
  label: string
  icon: Component
}

/** 菜单项顺序固定 */
const MENU_ITEMS: MenuItem[] = [
  { action: 'create', label: '新增倒计日', icon: Plus },
  { action: 'detail', label: '日期详情', icon: CalendarDays }
]

/** 菜单项样式：静态类名映射，避免运行时拼接 */
const MENU_ITEM_CLASS = [
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5',
  'text-left text-sm outline-hidden select-none',
  'hover:bg-accent hover:text-accent-foreground',
  'focus-visible:bg-accent focus-visible:text-accent-foreground'
]

const menuRef = ref<HTMLElement | null>(null)
const itemRefs = ref<HTMLButtonElement[]>([])
const activeIndex = ref(0)

/** 水平位置收拢：右侧越界时向左贴边 */
const clampedX = computed(() => {
  const maxX = window.innerWidth - MENU_WIDTH - VIEWPORT_GAP
  const upperBound = Math.max(maxX, VIEWPORT_GAP)
  return Math.min(Math.max(props.x, VIEWPORT_GAP), upperBound)
})

/** 垂直位置收拢：下方越界时向上贴边 */
const clampedY = computed(() => {
  const maxY = window.innerHeight - MENU_HEIGHT - VIEWPORT_GAP
  const upperBound = Math.max(maxY, VIEWPORT_GAP)
  return Math.min(Math.max(props.y, VIEWPORT_GAP), upperBound)
})

/** 关闭菜单：统一走 v-model 语义，不直接改 prop */
function close(): void {
  if (!props.open) return
  emit('update:open', false)
}

/** 执行菜单项：先关闭菜单再通知父组件 */
function trigger(action: MenuAction): void {
  close()
  if (action === 'create') {
    emit('create')
    return
  }
  emit('detail')
}

/** 记录菜单项元素，供键盘导航聚焦 */
function setItemRef(
  el: Element | ComponentPublicInstance | null,
  index: number
): void {
  if (el instanceof HTMLButtonElement) {
    itemRefs.value[index] = el
  }
}

/** 上下方向键在两项之间循环切换并同步焦点 */
function moveActive(step: number): void {
  const count = MENU_ITEMS.length
  activeIndex.value = (activeIndex.value + step + count) % count
  itemRefs.value[activeIndex.value]?.focus()
}

/** 点击菜单外部关闭 */
function onPointerDown(event: PointerEvent): void {
  if (!props.open) return
  const target = event.target
  if (target instanceof Node && menuRef.value?.contains(target)) return
  close()
}

/** 键盘操作：Esc 关闭、方向键切换、回车空格触发、Tab 关闭 */
function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      close()
      break
    case 'ArrowDown':
      event.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveActive(-1)
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      trigger(MENU_ITEMS[activeIndex.value].action)
      break
    case 'Tab':
      close()
      break
    default:
      break
  }
}

useEventListener(window, 'pointerdown', onPointerDown, { capture: true })
useEventListener(window, 'keydown', onKeydown)
useEventListener(window, 'scroll', close, { capture: true })
useEventListener(window, 'resize', close)
useEventListener(window, 'blur', close)

/** 打开时重置高亮并聚焦第一项 */
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    activeIndex.value = 0
    await nextTick()
    itemRefs.value[0]?.focus()
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuRef"
      role="menu"
      aria-label="日期操作"
      tabindex="-1"
      class="bg-popover text-popover-foreground fixed z-50 min-w-[10rem] rounded-md border p-1 shadow-md outline-hidden"
      :style="{ top: `${clampedY}px`, left: `${clampedX}px` }"
    >
      <div class="text-muted-foreground px-2 py-1 text-xs">
        {{ date }}
      </div>

      <button
        v-for="(item, index) in MENU_ITEMS"
        :key="item.action"
        :ref="(el) => setItemRef(el, index)"
        role="menuitem"
        tabindex="-1"
        type="button"
        :class="[
          MENU_ITEM_CLASS,
          activeIndex === index ? 'bg-accent text-accent-foreground' : ''
        ]"
        @click="trigger(item.action)"
      >
        <component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ item.label }}</span>
      </button>
    </div>
  </Teleport>
</template>
