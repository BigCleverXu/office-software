<script setup lang="ts">
import { computed } from 'vue'
import { Layers } from 'lucide-vue-next'
import type { QuickSiteGroup } from '@shared/quick-sites'
import { siteAccent } from '@/lib/site-visuals'
import QuickSiteCardShell from '@/components/QuickSiteCardShell.vue'

const props = withDefaults(
  defineProps<{
    group: QuickSiteGroup
    siteCount: number
    opening?: boolean
  }>(),
  { opening: false }
)

const emit = defineEmits<{
  open: []
  edit: []
  remove: []
}>()

const accent = computed(() => siteAccent(props.group.name))

const ariaLabel = computed(
  () => `打开编组 ${props.group.name}（${props.siteCount} 个网站）`
)

const handleOpen = (): void => {
  if (props.opening) {
    return
  }
  emit('open')
}
</script>

<template>
  <QuickSiteCardShell
    :aria-label="ariaLabel"
    :opening="opening"
    edit-label="编辑编组"
    remove-label="删除编组"
    @open="handleOpen"
    @edit="emit('edit')"
    @remove="emit('remove')"
  >
    <div class="flex items-start gap-3 pr-14">
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-lg"
        :class="accent"
        aria-hidden="true"
      >
        <Layers class="size-4" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 class="truncate text-sm font-medium">{{ group.name }}</h3>
        <p class="text-muted-foreground truncate text-[11px]">
          {{ siteCount }} 个网站
        </p>
      </div>
    </div>

    <template #footer>
      <span
        class="bg-foreground/5 inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10px] leading-none"
      >
        <Layers class="size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span class="truncate">一键打开</span>
      </span>
    </template>
  </QuickSiteCardShell>
</template>
